import threading
import time
from datetime import datetime, timedelta

from dotenv import load_dotenv
import os

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import pandas as pd
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from io import BytesIO

from database import get_db, init_db
from auth import hash_password, verify_password, create_token, get_current_user, public_user, email_allowed
from models import (
    SpendingCreate, SpendingUpdate, SpendingResponse,
    TodoCreate, TodoUpdate, TodoResponse,
    WorkLogCreate, WorkLogUpdate, WorkLogResponse,
    ScheduleCreate, ScheduleUpdate, ScheduleResponse,
    RegisterRequest, LoginRequest, EmailSettings,
)
import google_integration as gi
from notify import send_smtp, send_smtp_test
from rate_limit import rate_limit

app = FastAPI(title="MyLife Productivity Dashboard API")


@app.get("/health")
def health():
    return {"status": "ok"}

# Allow the configured frontend origin(s), or everything in local dev.
_cors_origins = [o.strip() for o in os.environ.get(
    "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173"
).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()
    _start_scheduler()


# ============================================================
# AUTH
# ============================================================

@app.post("/auth/register")
def register(req: RegisterRequest, _: dict = Depends(rate_limit(limit=10, window=60))):
    name = req.name.strip()
    email = req.email.strip().lower()
    password = req.password
    if not name or not email or not password:
        raise HTTPException(400, "Name, email and password are required")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if not email_allowed(email):
        raise HTTPException(403, "This email domain is not allowed. Contact the administrator.")
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute(
            "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
            (name, email, hash_password(password)),
        )
        conn.commit()
        uid = c.lastrowid
    except Exception:
        conn.close()
        raise HTTPException(409, "An account with this email already exists")

    c.execute("SELECT * FROM users WHERE id = ?", (uid,))
    user = dict(c.fetchone())
    conn.close()
    return {"token": create_token(uid), "user": public_user(user)}


@app.post("/auth/login")
def login(req: LoginRequest, _: dict = Depends(rate_limit(limit=15, window=60))):
    email = req.email.strip().lower()
    password = req.password
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE email = ?", (email,))
    row = c.fetchone()
    conn.close()
    if not row or not row["password_hash"]:
        raise HTTPException(401, "Invalid email or password")

    if not verify_password(password, row["password_hash"]):
        raise HTTPException(401, "Invalid email or password")

    return {"token": create_token(row["id"]), "user": public_user(dict(row))}


@app.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@app.get("/auth/google/url")
def google_auth_url(_=Depends(rate_limit(limit=30, window=60))):
    if not gi.google_configured():
        raise HTTPException(
            400,
            "Google is not configured yet. Add GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET to the backend environment.",
        )
    return {"url": gi.build_auth_url()}


@app.get("/auth/google/callback")
def google_callback(code: str, error: str = None, _=Depends(rate_limit(limit=10, window=60))):
    if error:
        raise HTTPException(400, f"Google auth failed: {error}")
    if not gi.google_configured():
        raise HTTPException(400, "Google is not configured.")

    try:
        tokens = gi.exchange_code(code)
        info = gi.get_userinfo(tokens["access_token"])
    except Exception as e:
        raise HTTPException(400, f"Failed to exchange Google code: {e}")

    sub = info.get("sub")
    gmail = (info.get("email") or "").strip().lower()
    name = info.get("name") or gmail.split("@")[0]

    if not email_allowed(gmail):
        raise HTTPException(
            403,
            "This Google account is not allowed. Set ALLOWED_DOMAIN in the backend configuration.",
        )

    conn = get_db()
    c = conn.cursor()

    c.execute("SELECT * FROM users WHERE google_sub = ?", (sub,))
    user = c.fetchone()

    if not user:
        c.execute("SELECT * FROM users WHERE email = ?", (gmail,))
        user = c.fetchone()
        if user:
            c.execute(
                "UPDATE users SET google_sub=?, google_access_token=?, google_refresh_token=?, google_email=? WHERE id=?",
                (sub, tokens.get("access_token"), tokens.get("refresh_token"), gmail, user["id"]),
            )
        else:
            c.execute(
                "INSERT INTO users (name, email, google_sub, google_access_token, google_refresh_token, google_email) VALUES (?, ?, ?, ?, ?, ?)",
                (name, gmail, sub, tokens.get("access_token"), tokens.get("refresh_token"), gmail),
            )
    else:
        c.execute(
            "UPDATE users SET google_access_token=?, google_refresh_token=?, google_email=? WHERE id=?",
            (tokens.get("access_token"), tokens.get("refresh_token"), gmail, user["id"]),
        )

    conn.commit()
    c.execute("SELECT * FROM users WHERE google_sub = ?", (sub,))
    user = dict(c.fetchone())
    conn.close()

    # Redirect back to the frontend so its auth provider can persist the
    # session.  The former success page never delivered the token to the app.
    redirect = f"{gi.FRONTEND_URL.rstrip('/')}/login?google_token={create_token(user['id'])}"
    return RedirectResponse(url=redirect, status_code=303)


# ============================================================
# SPENDING
# ============================================================

@app.get("/spending", response_model=list[SpendingResponse])
def get_spending(
    period: str = Query("daily", pattern="^(daily|weekly|monthly|yearly)$"),
    category: str = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    user: dict = Depends(get_current_user),
):
    conn = get_db()
    c = conn.cursor()
    query = "SELECT * FROM spending WHERE user_id = ?"
    params = [user["id"]]

    if category:
        query += " AND category = ?"
        params.append(category)
    if start_date:
        query += " AND date >= ?"
        params.append(start_date)
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)

    query += " ORDER BY date DESC"
    c.execute(query, params)
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/spending", response_model=SpendingResponse)
def create_spending(item: SpendingCreate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO spending (user_id, amount, category, description, date) VALUES (?, ?, ?, ?, ?)",
        (user["id"], item.amount, item.category, item.description, item.date),
    )
    conn.commit()
    row_id = c.lastrowid
    c.execute("SELECT * FROM spending WHERE id = ?", (row_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.put("/spending/{item_id}", response_model=SpendingResponse)
def update_spending(item_id: int, item: SpendingUpdate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM spending WHERE id = ? AND user_id = ?", (item_id, user["id"]))
    if not c.fetchone():
        conn.close()
        raise HTTPException(404, "Spending entry not found")

    data = item.model_dump(exclude_unset=True)
    if data:
        set_clause = ", ".join(f"{k} = ?" for k in data)
        c.execute(f"UPDATE spending SET {set_clause} WHERE id = ?", list(data.values()) + [item_id])
        conn.commit()

    c.execute("SELECT * FROM spending WHERE id = ?", (item_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.delete("/spending/{item_id}")
def delete_spending(item_id: int, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM spending WHERE id = ? AND user_id = ?", (item_id, user["id"]))
    conn.commit()
    affected = c.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(404, "Spending entry not found")
    return {"detail": "Deleted"}


# ============================================================
# TODOS
# ============================================================

@app.get("/todos", response_model=list[TodoResponse])
def get_todos(completed: bool = Query(None), user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    if completed is not None:
        c.execute(
            "SELECT * FROM todos WHERE user_id = ? AND completed = ? ORDER BY priority DESC, due_date ASC",
            (user["id"], int(completed)),
        )
    else:
        c.execute(
            "SELECT * FROM todos WHERE user_id = ? ORDER BY completed ASC, priority DESC, due_date ASC",
            (user["id"],),
        )
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/todos", response_model=TodoResponse)
def create_todo(item: TodoCreate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO todos (user_id, title, description, priority, due_date) VALUES (?, ?, ?, ?, ?)",
        (user["id"], item.title, item.description, item.priority, item.due_date),
    )
    conn.commit()
    row_id = c.lastrowid
    c.execute("SELECT * FROM todos WHERE id = ?", (row_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.put("/todos/{todo_id}", response_model=TodoResponse)
def update_todo(todo_id: int, item: TodoUpdate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM todos WHERE id = ? AND user_id = ?", (todo_id, user["id"]))
    if not c.fetchone():
        conn.close()
        raise HTTPException(404, "Todo not found")

    data = item.model_dump(exclude_unset=True)
    if "completed" in data:
        data["completed"] = int(data["completed"])
    if data:
        set_clause = ", ".join(f"{k} = ?" for k in data)
        c.execute(f"UPDATE todos SET {set_clause} WHERE id = ?", list(data.values()) + [todo_id])
        conn.commit()

    c.execute("SELECT * FROM todos WHERE id = ?", (todo_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM todos WHERE id = ? AND user_id = ?", (todo_id, user["id"]))
    conn.commit()
    affected = c.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(404, "Todo not found")
    return {"detail": "Deleted"}


# ============================================================
# WORK LOG
# ============================================================

@app.get("/worklog", response_model=list[WorkLogResponse])
def get_worklog(
    project: str = Query(None),
    start_date: str = Query(None),
    end_date: str = Query(None),
    user: dict = Depends(get_current_user),
):
    conn = get_db()
    c = conn.cursor()
    query = "SELECT * FROM work_log WHERE user_id = ?"
    params = [user["id"]]

    if project:
        query += " AND project = ?"
        params.append(project)
    if start_date:
        query += " AND date >= ?"
        params.append(start_date)
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)

    query += " ORDER BY date DESC"
    c.execute(query, params)
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/worklog", response_model=WorkLogResponse)
def create_worklog(item: WorkLogCreate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO work_log (user_id, task, project, hours, date, notes) VALUES (?, ?, ?, ?, ?, ?)",
        (user["id"], item.task, item.project, item.hours, item.date, item.notes),
    )
    conn.commit()
    row_id = c.lastrowid
    c.execute("SELECT * FROM work_log WHERE id = ?", (row_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.put("/worklog/{log_id}", response_model=WorkLogResponse)
def update_worklog(log_id: int, item: WorkLogUpdate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM work_log WHERE id = ? AND user_id = ?", (log_id, user["id"]))
    if not c.fetchone():
        conn.close()
        raise HTTPException(404, "Work log not found")

    data = item.model_dump(exclude_unset=True)
    if data:
        set_clause = ", ".join(f"{k} = ?" for k in data)
        c.execute(f"UPDATE work_log SET {set_clause} WHERE id = ?", list(data.values()) + [log_id])
        conn.commit()

    c.execute("SELECT * FROM work_log WHERE id = ?", (log_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.delete("/worklog/{log_id}")
def delete_worklog(log_id: int, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM work_log WHERE id = ? AND user_id = ?", (log_id, user["id"]))
    conn.commit()
    affected = c.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(404, "Work log not found")
    return {"detail": "Deleted"}


# ============================================================
# SCHEDULE
# ============================================================

@app.get("/schedule", response_model=list[ScheduleResponse])
def get_schedule(date: str = Query(None), user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    if date:
        c.execute(
            "SELECT * FROM schedule WHERE user_id = ? AND date = ? ORDER BY start_time",
            (user["id"], date),
        )
    else:
        c.execute(
            "SELECT * FROM schedule WHERE user_id = ? ORDER BY date, start_time",
            (user["id"],),
        )
    rows = c.fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/schedule", response_model=ScheduleResponse)
def create_schedule(item: ScheduleCreate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "INSERT INTO schedule (user_id, title, start_time, end_time, date, recurring, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user["id"], item.title, item.start_time, item.end_time, item.date, int(item.recurring), item.notes),
    )
    conn.commit()
    row_id = c.lastrowid
    c.execute("SELECT * FROM schedule WHERE id = ?", (row_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.put("/schedule/{sched_id}", response_model=ScheduleResponse)
def update_schedule(sched_id: int, item: ScheduleUpdate, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM schedule WHERE id = ? AND user_id = ?", (sched_id, user["id"]))
    if not c.fetchone():
        conn.close()
        raise HTTPException(404, "Schedule not found")

    data = item.model_dump(exclude_unset=True)
    if "recurring" in data:
        data["recurring"] = int(data["recurring"])
    if data:
        set_clause = ", ".join(f"{k} = ?" for k in data)
        c.execute(f"UPDATE schedule SET {set_clause} WHERE id = ?", list(data.values()) + [sched_id])
        conn.commit()

    c.execute("SELECT * FROM schedule WHERE id = ?", (sched_id,))
    result = dict(c.fetchone())
    conn.close()
    return result


@app.delete("/schedule/{sched_id}")
def delete_schedule(sched_id: int, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM schedule WHERE id = ? AND user_id = ?", (sched_id, user["id"]))
    conn.commit()
    affected = c.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(404, "Schedule not found")
    return {"detail": "Deleted"}


# ============================================================
# ANALYTICS
# ============================================================

@app.get("/analytics/summary")
def get_summary(user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    today = datetime.now().strftime("%Y-%m-%d")

    c.execute("SELECT COALESCE(SUM(amount), 0) FROM spending WHERE user_id = ? AND date = ?", (user["id"], today))
    today_spending = c.fetchone()[0]

    c.execute("SELECT COALESCE(SUM(amount), 0) FROM spending WHERE user_id = ?", (user["id"],))
    total_spending = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM todos WHERE user_id = ? AND completed = 0", (user["id"],))
    pending_todos = c.fetchone()[0]

    c.execute("SELECT COUNT(*) FROM todos WHERE user_id = ? AND completed = 1", (user["id"],))
    completed_todos = c.fetchone()[0]

    c.execute("SELECT COALESCE(SUM(hours), 0) FROM work_log WHERE user_id = ? AND date = ?", (user["id"], today))
    today_hours = c.fetchone()[0]

    c.execute(
        "SELECT * FROM schedule WHERE user_id = ? AND date = ? ORDER BY start_time",
        (user["id"], today),
    )
    today_schedule = [dict(r) for r in c.fetchall()]

    conn.close()
    return {
        "today_spending": round(today_spending, 2),
        "total_spending": round(total_spending, 2),
        "pending_todos": pending_todos,
        "completed_todos": completed_todos,
        "today_work_hours": round(today_hours, 1),
        "today_schedule": today_schedule,
    }


# ============================================================
# REPORT BUILDERS (shared by export / sync / email)
# ============================================================

def _date_range(period: str, today: datetime):
    if period == "daily":
        return today.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")
    elif period == "weekly":
        start = today - timedelta(days=today.weekday())
        return start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")
    elif period == "monthly":
        return today.replace(day=1).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")
    elif period == "yearly":
        return today.replace(month=1, day=1).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")
    return None, None


def _tables_df(user_id: int, start_date, end_date):
    conn = get_db()
    result = {}
    table_columns = {
        "spending": ["id", "user_id", "amount", "category", "description", "date", "created_at"],
        "todos": ["id", "user_id", "title", "description", "completed", "priority", "due_date", "created_at"],
        "work_log": ["id", "user_id", "task", "project", "hours", "date", "notes", "created_at"],
        "schedule": ["id", "user_id", "title", "start_time", "end_time", "date", "recurring", "notes", "created_at"],
    }
    for table in ("spending", "todos", "work_log", "schedule"):
        query = f"SELECT * FROM {table} WHERE user_id = ?"
        params = [user_id]
        if table != "todos" and start_date:
            query += " AND date >= ?"
            params.append(start_date)
            query += " AND date <= ?"
            params.append(end_date)
        cursor = conn.cursor()
        cursor.execute(query, params)
        # Avoid pandas' SQLite-specific query path so Excel/PDF exports work
        # with the PostgreSQL compatibility connection as well.
        result[table] = pd.DataFrame(
            [dict(row) for row in cursor.fetchall()],
            columns=table_columns[table],
        )
    conn.close()
    return result


def build_excel_bytes(user_id: int, start_date, end_date, data_type="all") -> bytes:
    buffer = BytesIO()
    dfs = _tables_df(user_id, start_date, end_date)
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        if data_type in ("spending", "all"):
            dfs["spending"].to_excel(writer, sheet_name="Spending", index=False)
        if data_type in ("todos", "all"):
            dfs["todos"].to_excel(writer, sheet_name="Todos", index=False)
        if data_type in ("worklog", "all"):
            dfs["work_log"].to_excel(writer, sheet_name="Work Log", index=False)
        if data_type in ("schedule", "all"):
            dfs["schedule"].to_excel(writer, sheet_name="Schedule", index=False)
    buffer.seek(0)
    return buffer.getvalue()


def build_pdf_bytes(user_id: int, start_date, end_date, data_type="all") -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=40, bottomMargin=30, leftMargin=40, rightMargin=40)
    styles = getSampleStyleSheet()
    elements = []
    dfs = _tables_df(user_id, start_date, end_date)

    elements.append(Paragraph("MyLife Productivity Report", styles["Title"]))
    elements.append(Paragraph(f"Period: {start_date or 'All'} to {end_date or 'All'}", styles["Normal"]))
    elements.append(Spacer(1, 12))

    def add_table(title, cols, df):
        if df.empty:
            return
        elements.append(Paragraph(title, styles["Heading2"]))
        table_data = [cols] + [[str(r) if r is not None else "" for r in row] for row in df[cols].values.tolist()]
        t = Table(table_data)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.grey),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 12),
            ("BACKGROUND", (0, 1), (-1, -1), colors.beige),
            ("GRID", (0, 0), (-1, -1), 1, colors.black),
        ]))
        elements.append(t)
        elements.append(Spacer(1, 12))

    if data_type in ("spending", "all"):
        add_table("Spending", ["date", "category", "amount", "description"], dfs["spending"])
    if data_type in ("todos", "all"):
        add_table("To-Do List", ["title", "priority", "completed", "due_date"], dfs["todos"])
    if data_type in ("worklog", "all"):
        add_table("Work Log", ["date", "task", "project", "hours"], dfs["work_log"])
    if data_type in ("schedule", "all"):
        add_table("Schedule", ["date", "start_time", "end_time", "title"], dfs["schedule"])

    doc.build(elements)
    buffer.seek(0)
    return buffer.getvalue()


def build_email_html(user_id: int, start_date, end_date, period: str) -> str:
    conn = get_db()
    c = conn.cursor()
    total = c.execute(
        "SELECT COALESCE(SUM(amount),0) FROM spending WHERE user_id = ? AND date BETWEEN ? AND ?",
        (user_id, start_date, end_date),
    ).fetchone()[0]
    hours = c.execute(
        "SELECT COALESCE(SUM(hours),0) FROM work_log WHERE user_id = ? AND date BETWEEN ? AND ?",
        (user_id, start_date, end_date),
    ).fetchone()[0]
    done = c.execute("SELECT COUNT(*) FROM todos WHERE user_id = ? AND completed = 1", (user_id,)).fetchone()[0]
    pending = c.execute("SELECT COUNT(*) FROM todos WHERE user_id = ? AND completed = 0", (user_id,)).fetchone()[0]
    events = c.execute(
        "SELECT COUNT(*) FROM schedule WHERE user_id = ? AND date BETWEEN ? AND ?",
        (user_id, start_date, end_date),
    ).fetchone()[0]
    conn.close()

    return f"""
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
      <div style="background:#0ea5e9;color:#fff;padding:20px;border-radius:10px 10px 0 0">
        <h2 style="margin:0">MyLife Productivity Report</h2>
        <p style="margin:4px 0 0;opacity:.9">Period: {period} ({start_date} to {end_date})</p>
      </div>
      <div style="background:#f8fafc;padding:20px;border:1px solid #e2e8f0;border-radius:0 0 10px 10px">
        <table style="width:100%;border-collapse:collapse;text-align:center">
          <tr>
            <td style="padding:12px"><div style="font-size:26px;font-weight:700;color:#ef4444">${total:.2f}</div><div style="color:#64748b;font-size:12px">Spending</div></td>
            <td style="padding:12px"><div style="font-size:26px;font-weight:700;color:#0ea5e9">{hours:.1f}h</div><div style="color:#64748b;font-size:12px">Work Hours</div></td>
            <td style="padding:12px"><div style="font-size:26px;font-weight:700;color:#22c55e">{done}</div><div style="color:#64748b;font-size:12px">Tasks Done</div></td>
            <td style="padding:12px"><div style="font-size:26px;font-weight:700;color:#f59e0b">{pending}</div><div style="color:#64748b;font-size:12px">Pending</div></td>
          </tr>
        </table>
        <p style="color:#64748b;font-size:14px">Events scheduled: <b>{events}</b></p>
        <p style="color:#94a3b8;font-size:12px">Generated by MyLife Productivity Dashboard. Full data is attached as a spreadsheet.</p>
      </div>
    </div>
    """


# ============================================================
# EXPORT
# ============================================================

@app.get("/export/excel")
def export_excel(
    data_type: str = Query("all", pattern="^(spending|todos|worklog|schedule|all)$"),
    period: str = Query("all", pattern="^(daily|weekly|monthly|yearly|all)$"),
    user: dict = Depends(get_current_user),
):
    start, end = _date_range(period, datetime.now())
    content = build_excel_bytes(user["id"], start, end, data_type)
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=productivity_{data_type}_{period}.xlsx"},
    )


@app.get("/export/pdf")
def export_pdf(
    data_type: str = Query("all", pattern="^(spending|todos|worklog|schedule|all)$"),
    period: str = Query("all", pattern="^(daily|weekly|monthly|yearly|all)$"),
    user: dict = Depends(get_current_user),
):
    start, end = _date_range(period, datetime.now())
    content = build_pdf_bytes(user["id"], start, end, data_type)
    return StreamingResponse(
        BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=productivity_{data_type}_{period}.pdf"},
    )


# ============================================================
# GOOGLE SYNC
# ============================================================

@app.get("/sync/status")
def sync_status(user: dict = Depends(get_current_user)):
    return {
        "google_connected": bool(user.get("google_access_token") or user.get("google_refresh_token")),
        "google_email": user.get("google_email"),
        "google_configured_server": gi.google_configured(),
    }


@app.post("/sync/sheets")
def sync_sheets(
    data_type: str = "all",
    period: str = "monthly",
    user: dict = Depends(get_current_user),
):
    if not gi.google_configured():
        raise HTTPException(400, "Google is not configured on the server. Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.")
    try:
        access = gi._authed_access(user)
    except Exception as e:
        raise HTTPException(400, f"Google account not connected or token invalid: {e}")

    today = datetime.now()
    start, end = _date_range(period, today)
    dfs = _tables_df(user["id"], start, end)

    title = f"MyLife Report {period} {today.strftime('%Y-%m-%d')}"
    try:
        spreadsheet_id, spreadsheet_url = gi.create_spreadsheet(access, title)
        gi.write_sheet_values(access, spreadsheet_id, "Summary!A1", [
            ["MyLife Productivity Report"],
            ["Period", f"{period} ({start} to {end})"],
            ["Generated", today.strftime("%Y-%m-%d %H:%M")],
            ["User", user["email"]],
        ])

        specs = [
            ("spending", "Spending", ["id", "amount", "category", "description", "date"]),
            ("todos", "Todos", ["id", "title", "priority", "completed", "due_date"]),
            ("work_log", "Work Log", ["id", "task", "project", "hours", "date"]),
            ("schedule", "Schedule", ["id", "title", "start_time", "end_time", "date"]),
        ]
        for table, label, cols in specs:
            if data_type not in ("all", label.lower().replace(" ", "")) and not (data_type == "all"):
                continue
            df = dfs[table]
            values = [cols]
            for _, row in df.iterrows():
                values.append([str(row[c]) if row[c] is not None else "" for c in cols])
            if len(values) > 1:
                gi.write_sheet_values(access, spreadsheet_id, f"{label}!A1", values)
    except Exception as e:
        raise HTTPException(500, f"Google Sheets sync failed: {e}")

    return {"status": "ok", "spreadsheet_url": spreadsheet_url, "spreadsheet_title": title}


@app.post("/sync/drive")
def sync_drive(period: str = "monthly", user: dict = Depends(get_current_user)):
    if not gi.google_configured():
        raise HTTPException(400, "Google is not configured on the server.")
    try:
        access = gi._authed_access(user)
    except Exception as e:
        raise HTTPException(400, f"Google account not connected or token invalid: {e}")

    today = datetime.now()
    start, end = _date_range(period, today)
    stamp = today.strftime("%Y-%m-%d")

    try:
        folder_id = gi.create_drive_folder(access, "MyLife Productivity Backups")
        excel_content = build_excel_bytes(user["id"], start, end, "all")
        pdf_content = build_pdf_bytes(user["id"], start, end, "all")

        excel_file = gi.upload_drive_file(
            access, f"report_{period}_{stamp}.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            excel_content, folder_id,
        )
        pdf_file = gi.upload_drive_file(
            access, f"report_{period}_{stamp}.pdf",
            "application/pdf", pdf_content, folder_id,
        )
    except Exception as e:
        raise HTTPException(500, f"Google Drive backup failed: {e}")

    return {
        "status": "ok",
        "folder_id": folder_id,
        "excel_link": excel_file.get("webViewLink"),
        "pdf_link": pdf_file.get("webViewLink"),
    }


# ============================================================
# GOOGLE DATA (view Gmail / Drive / Sheets / Calendar)
# ============================================================

def _persist_google_token(user, access):
    if access and access != user.get("google_access_token"):
        conn = get_db()
        c = conn.cursor()
        c.execute("UPDATE users SET google_access_token=? WHERE id=?", (access, user["id"]))
        conn.commit()
        conn.close()


def _require_google_configured():
    if not gi.google_configured():
        raise HTTPException(400, "Google is not configured on the server. Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.")


def _google_error(e):
    raise HTTPException(400, f"Google request failed: {e}")


@app.get("/google/gmail/list")
def google_gmail_list(q: str = "", max: int = Query(20, ge=1, le=50), user: dict = Depends(get_current_user), _=Depends(rate_limit(limit=60, window=60))):
    _require_google_configured()
    try:
        data, access = gi.list_gmail_messages(user, max, q)
        _persist_google_token(user, access)
        return {"messages": data}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.get("/google/gmail/read/{message_id}")
def google_gmail_read(message_id: str, user: dict = Depends(get_current_user), _=Depends(rate_limit(limit=60, window=60))):
    _require_google_configured()
    try:
        data, access = gi.read_gmail_message(user, message_id)
        _persist_google_token(user, access)
        return data
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.get("/google/drive/list")
def google_drive_list(q: str = "", max: int = Query(100, ge=1, le=1000), user: dict = Depends(get_current_user), _=Depends(rate_limit(limit=60, window=60))):
    _require_google_configured()
    try:
        files, access = gi.list_drive_files(user, q, max)
        _persist_google_token(user, access)
        return {"files": files}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.get("/google/sheets/list")
def google_sheets_list(max: int = Query(100, ge=1, le=1000), user: dict = Depends(get_current_user), _=Depends(rate_limit(limit=60, window=60))):
    _require_google_configured()
    try:
        files, access = gi.list_google_sheets(user, max)
        _persist_google_token(user, access)
        return {"files": files}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.get("/google/calendar/list")
def google_calendar_list(max: int = Query(20, ge=1, le=100), user: dict = Depends(get_current_user), _=Depends(rate_limit(limit=60, window=60))):
    _require_google_configured()
    try:
        events, access = gi.list_calendar_events(user, max)
        _persist_google_token(user, access)
        return {"events": events}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


# ============================================================
# EMAIL NOTIFICATIONS
# ============================================================

@app.post("/notify/report")
def notify_report(period: str = "daily", user: dict = Depends(get_current_user)):
    to = user.get("google_email") or user.get("email")
    today = datetime.now()
    start, end = _date_range(period, today)
    subject = f"MyLife {period.capitalize()} Report - {today.strftime('%Y-%m-%d')}"
    body_html = build_email_html(user["id"], start, end, period)
    excel_bytes = build_excel_bytes(user["id"], start, end, "all")
    attachment = (f"mylife_{period}_{today.strftime('%Y-%m-%d')}.xlsx", excel_bytes,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    if user.get("google_access_token") or user.get("google_refresh_token"):
        try:
            access = gi._authed_access(user)
            gi.send_gmail(access, to, subject, body_html, attachment)
            return {"status": "ok", "sent_to": to, "method": "gmail"}
        except Exception as e:
            raise HTTPException(500, f"Gmail send failed: {e}")

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM user_settings WHERE user_id = ?", (user["id"],))
    settings = c.fetchone()
    conn.close()
    if settings and settings["smtp_host"]:
        try:
            send_smtp(dict(settings), to, subject, body_html, attachment)
            return {"status": "ok", "sent_to": to, "method": "smtp"}
        except Exception as e:
            raise HTTPException(500, f"SMTP send failed: {e}")

    raise HTTPException(400, "No delivery method configured. Connect Google or set SMTP in Settings.")


@app.post("/notify/test")
def notify_test(user: dict = Depends(get_current_user)):
    to = user.get("google_email") or user.get("email")
    if user.get("google_access_token") or user.get("google_refresh_token"):
        try:
            access = gi._authed_access(user)
            gi.send_gmail(
                access, to, "MyLife Dashboard - Test Email",
                "<h2>Test email</h2><p>This is a test email from your <b>MyLife Productivity Dashboard</b>.</p>",
            )
            return {"status": "ok", "sent_to": to, "method": "gmail"}
        except Exception as e:
            raise HTTPException(500, f"Gmail send failed: {e}")

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM user_settings WHERE user_id = ?", (user["id"],))
    settings = c.fetchone()
    conn.close()
    if settings and settings["smtp_host"]:
        try:
            send_smtp_test(dict(settings), to)
            return {"status": "ok", "sent_to": to, "method": "smtp"}
        except Exception as e:
            raise HTTPException(500, f"SMTP send failed: {e}")

    raise HTTPException(400, "No delivery method configured. Connect Google or set SMTP in Settings.")


@app.put("/settings/email")
def update_email_settings(
    settings: EmailSettings,
    user: dict = Depends(get_current_user),
):
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """INSERT INTO user_settings (user_id, smtp_host, smtp_port, smtp_user, smtp_password, daily_report, report_time, recipient)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             smtp_host=excluded.smtp_host, smtp_port=excluded.smtp_port,
             smtp_user=excluded.smtp_user, smtp_password=excluded.smtp_password,
             daily_report=excluded.daily_report, report_time=excluded.report_time,
             recipient=excluded.recipient""",
        (user["id"], settings.smtp_host, settings.smtp_port, settings.smtp_user,
         settings.smtp_password, int(settings.daily_report), settings.report_time, settings.recipient),
    )
    conn.commit()
    conn.close()
    return {"status": "ok"}


@app.get("/settings/email")
def get_email_settings(user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM user_settings WHERE user_id = ?", (user["id"],))
    row = c.fetchone()
    conn.close()
    if not row:
        return {"smtp_host": "", "smtp_port": 587, "smtp_user": "", "daily_report": 0, "report_time": "18:00"}
    return dict(row)


# ============================================================
# DAILY REPORT SCHEDULER
# ============================================================

def _scheduler_loop():
    while True:
        try:
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM user_settings WHERE daily_report = 1")
            rows = c.fetchall()
            conn.close()
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")

            for row in rows:
                s = dict(row)
                try:
                    report_hour, report_min = s["report_time"].split(":")
                    scheduled = today + " " + report_hour + ":" + report_min
                    last = s.get("report_last_sent") or ""
                    if now.strftime("%Y-%m-%d %H:%M") >= scheduled and not last.startswith(today):
                        _send_daily_report(s["user_id"])
                except Exception:
                    continue
        except Exception:
            pass
        time.sleep(60)


def _send_daily_report(user_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = dict(c.fetchone())
    conn.close()

    today = datetime.now()
    start, end = _date_range("daily", today)
    subject = f"MyLife Daily Report - {today.strftime('%Y-%m-%d')}"
    body_html = build_email_html(user_id, start, end, "daily")
    excel_bytes = build_excel_bytes(user_id, start, end, "all")
    attachment = (f"mylife_daily_{today.strftime('%Y-%m-%d')}.xlsx", excel_bytes,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    to = user.get("google_email") or user.get("email")

    try:
        if user.get("google_access_token") or user.get("google_refresh_token"):
            access = gi._authed_access(user)
            gi.send_gmail(access, to, subject, body_html, attachment)
        else:
            conn = get_db()
            c = conn.cursor()
            c.execute("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
            settings = c.fetchone()
            conn.close()
            if not settings or not settings["smtp_host"]:
                return
            send_smtp(dict(settings), to, subject, body_html, attachment)
    except Exception:
        return

    conn = get_db()
    c = conn.cursor()
    c.execute(
        "UPDATE user_settings SET report_last_sent = ? WHERE user_id = ?",
        (datetime.now().strftime("%Y-%m-%d %H:%M"), user_id),
    )
    conn.commit()
    conn.close()


def _start_scheduler():
    t = threading.Thread(target=_scheduler_loop, daemon=True)
    t.start()


# ============================================================
# STATIC FRONTEND (served by the backend in production)
# Build the React app first (cd frontend && npm run build), then
# it is served from ../frontend/dist or FRONTEND_DIST.
# NOTE: the SPA catch-all is defined LAST so it never shadows API routes.
# ============================================================

_FRONTEND_DIST = os.environ.get("FRONTEND_DIST", os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))

if os.path.isdir(_FRONTEND_DIST):
    @app.get("/login", include_in_schema=False)
    def serve_login():
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))

    @app.get("/", include_in_schema=False)
    def serve_index():
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))

    app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa_fallback(path: str):
        candidate = os.path.join(_FRONTEND_DIST, path)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))
