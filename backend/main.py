import threading
import time
import json
import secrets
from datetime import datetime, timedelta

from dotenv import load_dotenv
import os

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import pandas as pd
from fastapi import FastAPI, Depends, HTTPException, Query, Header
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
    RegisterRequest, LoginRequest, EmailSettings, AutomationSettings,
    GoogleTaskCreate, GoogleTaskUpdate, GoogleCalendarEventCreate,
)
import google_integration as gi
from notify import send_smtp, send_smtp_test
from rate_limit import rate_limit

app = FastAPI(title="MyLife Productivity Dashboard API")
CRON_SECRET = os.environ.get("CRON_SECRET", "")


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


OAUTH_STATE_TTL_SECONDS = 10 * 60


def _enabled_google_products(user: dict) -> list:
    try:
        selected = json.loads(user.get("google_products") or "[]")
    except (TypeError, json.JSONDecodeError):
        selected = []
    return [product_id for product_id in selected if product_id in gi.GOOGLE_PRODUCTS]


def _create_oauth_state(purpose: str, user_id: int = None, product_id: str = None) -> str:
    """Create a single-use, server-side OAuth state record to prevent callback CSRF."""
    state = secrets.token_urlsafe(32)
    now = int(time.time())
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM oauth_states WHERE expires_at < ?", (now,))
    c.execute(
        "INSERT INTO oauth_states (state, user_id, purpose, product_id, expires_at) VALUES (?, ?, ?, ?, ?)",
        (state, user_id, purpose, product_id, now + OAUTH_STATE_TTL_SECONDS),
    )
    conn.commit()
    conn.close()
    return state


def _consume_oauth_state(state: str) -> dict:
    if not state:
        raise HTTPException(400, "Missing OAuth state. Start the Google connection again.")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM oauth_states WHERE state = ?", (state,))
    row = c.fetchone()
    c.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
    conn.commit()
    conn.close()
    if not row or row["expires_at"] < int(time.time()):
        raise HTTPException(400, "This Google connection link expired. Please try again.")
    return dict(row)


def _require_google_product(user: dict, product_id: str):
    if product_id not in _enabled_google_products(user):
        label = gi.GOOGLE_PRODUCTS.get(product_id, {}).get("label", product_id.title())
        raise HTTPException(403, f"Enable {label} in My Google before using it.")


@app.get("/auth/google/url")
def google_auth_url(_=Depends(rate_limit(limit=30, window=60))):
    if not gi.google_configured():
        raise HTTPException(
            400,
            "Google is not configured yet. Add GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET to the backend environment.",
        )
    return {"url": gi.build_auth_url(gi.IDENTITY_SCOPES, _create_oauth_state("sign_in"))}


@app.get("/auth/google/callback")
def google_callback(code: str = "", state: str = "", error: str = None, _=Depends(rate_limit(limit=10, window=60))):
    oauth_state = _consume_oauth_state(state)
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

    if oauth_state["purpose"] == "connect_product":
        product_id = oauth_state.get("product_id")
        user_id = oauth_state.get("user_id")
        if product_id not in gi.GOOGLE_PRODUCTS or not user_id:
            conn.close()
            raise HTTPException(400, "Invalid Google product connection.")
        c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = c.fetchone()
        if not user:
            conn.close()
            raise HTTPException(401, "Your MyLife session is no longer available. Please sign in again.")
        user = dict(user)
        if user.get("google_sub") and user["google_sub"] != sub:
            conn.close()
            raise HTTPException(409, "Connect products using the same Google account already linked to MyLife.")
        c.execute("SELECT id FROM users WHERE google_sub = ? AND id != ?", (sub, user_id))
        if c.fetchone():
            conn.close()
            raise HTTPException(409, "This Google account is already linked to another MyLife account.")

        products = sorted(set(_enabled_google_products(user) + [product_id]))
        refresh_token = tokens.get("refresh_token") or user.get("google_refresh_token")
        scopes = tokens.get("scope") or user.get("google_scopes") or ""
        c.execute(
            "UPDATE users SET google_sub=?, google_access_token=?, google_refresh_token=?, google_email=?, google_scopes=?, google_products=? WHERE id=?",
            (sub, tokens.get("access_token"), refresh_token, gmail, scopes, json.dumps(products), user_id),
        )
        conn.commit()
        conn.close()
        redirect = f"{gi.FRONTEND_URL.rstrip('/')}/?google_connected=1&google_product={product_id}"
        return RedirectResponse(url=redirect, status_code=303)

    if oauth_state["purpose"] != "sign_in":
        conn.close()
        raise HTTPException(400, "Invalid Google OAuth request.")

    # Sign-in receives identity-only permissions. Workspace tokens are stored
    # only after a user explicitly enables a product from My Google.
    c.execute("SELECT * FROM users WHERE google_sub = ?", (sub,))
    user = c.fetchone()
    if not user:
        c.execute("SELECT * FROM users WHERE email = ?", (gmail,))
        user = c.fetchone()
        if user:
            c.execute("UPDATE users SET google_sub=?, google_email=? WHERE id=?", (sub, gmail, user["id"]))
        else:
            c.execute(
                "INSERT INTO users (name, email, google_sub, google_email) VALUES (?, ?, ?, ?)",
                (name, gmail, sub, gmail),
            )
    else:
        c.execute("UPDATE users SET google_email=? WHERE id=?", (gmail, user["id"]))

    conn.commit()
    c.execute("SELECT * FROM users WHERE google_sub = ?", (sub,))
    user = dict(c.fetchone())
    conn.close()
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
    _queue_todo_google_sync(user, result, "upsert")
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
    _queue_todo_google_sync(user, result, "upsert")
    return result


@app.delete("/todos/{todo_id}")
def delete_todo(todo_id: int, user: dict = Depends(get_current_user)):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM todos WHERE id = ? AND user_id = ?", (todo_id, user["id"]))
    todo = c.fetchone()
    if not todo:
        conn.close()
        raise HTTPException(404, "Todo not found")
    todo = dict(todo)
    c.execute("DELETE FROM todos WHERE id = ? AND user_id = ?", (todo_id, user["id"]))
    conn.commit()
    affected = c.rowcount
    conn.close()
    if affected == 0:
        raise HTTPException(404, "Todo not found")
    _queue_todo_google_sync(user, todo, "delete")
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
        "google_account_linked": bool(user.get("google_sub")),
        "google_email": user.get("google_email"),
        "google_configured_server": gi.google_configured(),
        "products": _enabled_google_products(user),
    }


@app.get("/google/products")
def google_products(user: dict = Depends(get_current_user)):
    enabled = set(_enabled_google_products(user))
    return {
        "google_account_linked": bool(user.get("google_sub")),
        "google_email": user.get("google_email"),
        "configured": gi.google_configured(),
        "products": [
            {
                "id": product_id,
                "label": product["label"],
                "icon": product.get("icon", product_id),
                "api_name": product.get("api_name", "Google API"),
                "category": product.get("category", "Google Workspace"),
                "description": product["description"],
                "enabled": product_id in enabled,
            }
            for product_id, product in gi.GOOGLE_PRODUCTS.items()
        ],
    }


@app.post("/google/products/{product_id}/connect")
def connect_google_product(product_id: str, user: dict = Depends(get_current_user), _=Depends(rate_limit(limit=20, window=60))):
    if not gi.google_configured():
        raise HTTPException(400, "Google is not configured on the server. Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.")
    product = gi.GOOGLE_PRODUCTS.get(product_id)
    if not product:
        raise HTTPException(404, "Unknown Google product.")
    state = _create_oauth_state("connect_product", user["id"], product_id)
    return {"url": gi.build_auth_url(gi.IDENTITY_SCOPES + product["scopes"], state)}


@app.delete("/google/products/{product_id}")
def remove_google_product(product_id: str, user: dict = Depends(get_current_user)):
    enabled = _enabled_google_products(user)
    if product_id not in enabled:
        raise HTTPException(404, "That Google product is not connected.")
    remaining = [item for item in enabled if item != product_id]
    revoke_token = None
    conn = get_db()
    c = conn.cursor()
    if remaining:
        c.execute("UPDATE users SET google_products=? WHERE id=?", (json.dumps(remaining), user["id"]))
    else:
        # Once no Workspace product remains, discard credentials locally and
        # revoke the grant. The Google identity link is retained for sign-in.
        revoke_token = user.get("google_refresh_token") or user.get("google_access_token")
        c.execute(
            "UPDATE users SET google_access_token=NULL, google_refresh_token=NULL, google_scopes='', google_products='[]' WHERE id=?",
            (user["id"],),
        )
    conn.commit()
    conn.close()
    if revoke_token:
        try:
            gi.revoke_token(revoke_token)
        except Exception:
            pass
    return {"status": "ok", "products": remaining}


@app.post("/google/disconnect")
def disconnect_google(user: dict = Depends(get_current_user)):
    revoke_token = user.get("google_refresh_token") or user.get("google_access_token")
    conn = get_db()
    c = conn.cursor()
    c.execute(
        "UPDATE users SET google_sub=NULL, google_access_token=NULL, google_refresh_token=NULL, google_email=NULL, google_scopes='', google_products='[]' WHERE id=?",
        (user["id"],),
    )
    conn.commit()
    conn.close()
    if revoke_token:
        try:
            gi.revoke_token(revoke_token)
        except Exception:
            pass
    return {"status": "ok"}


def _sync_sheets_for_user(user: dict, data_type: str = "all", period: str = "monthly") -> dict:
    if not gi.google_configured():
        raise ValueError("Google is not configured on the server. Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.")
    _require_google_product(user, "sheets")
    try:
        access = gi._authed_access(user)
    except Exception as e:
        raise ValueError(f"Google account not connected or token invalid: {e}") from e

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
        raise RuntimeError(f"Google Sheets sync failed: {e}") from e

    return {"status": "ok", "spreadsheet_url": spreadsheet_url, "spreadsheet_title": title}


@app.post("/sync/sheets")
def sync_sheets(
    data_type: str = "all",
    period: str = "monthly",
    user: dict = Depends(get_current_user),
):
    try:
        return _sync_sheets_for_user(user, data_type, period)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


def _backup_drive_for_user(user: dict, period: str = "monthly") -> dict:
    if not gi.google_configured():
        raise ValueError("Google is not configured on the server.")
    _require_google_product(user, "drive")
    try:
        access = gi._authed_access(user)
    except Exception as e:
        raise ValueError(f"Google account not connected or token invalid: {e}") from e

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
        raise RuntimeError(f"Google Drive backup failed: {e}") from e

    return {
        "status": "ok",
        "folder_id": folder_id,
        "excel_link": excel_file.get("webViewLink"),
        "pdf_link": pdf_file.get("webViewLink"),
    }


@app.post("/sync/drive")
def sync_drive(period: str = "monthly", user: dict = Depends(get_current_user)):
    try:
        return _backup_drive_for_user(user, period)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


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
    _require_google_product(user, "gmail")
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
    _require_google_product(user, "gmail")
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
    _require_google_product(user, "drive")
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
    _require_google_product(user, "sheets")
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
    _require_google_product(user, "calendar")
    try:
        events, access = gi.list_calendar_events(user, max)
        _persist_google_token(user, access)
        return {"events": events}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.post("/google/calendar/events")
def google_calendar_create(item: GoogleCalendarEventCreate, user: dict = Depends(get_current_user)):
    _require_google_configured()
    _require_google_product(user, "calendar")
    try:
        event, access = gi.create_calendar_event(user, item.title, item.start, item.end, item.description or "")
        _persist_google_token(user, access)
        return event
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.get("/google/tasks")
def google_tasks_list(max: int = Query(100, ge=1, le=100), user: dict = Depends(get_current_user), _=Depends(rate_limit(limit=60, window=60))):
    _require_google_configured()
    _require_google_product(user, "tasks")
    try:
        tasks, access = gi.list_google_tasks(user, max)
        _persist_google_token(user, access)
        return {"tasks": tasks}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.post("/google/tasks")
def google_tasks_create(item: GoogleTaskCreate, user: dict = Depends(get_current_user)):
    _require_google_configured()
    _require_google_product(user, "tasks")
    if not item.title.strip():
        raise HTTPException(400, "Task title is required.")
    try:
        task, access = gi.create_google_task(user, item.title.strip(), item.notes or "", item.due)
        _persist_google_token(user, access)
        return task
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


@app.patch("/google/tasks/{task_list_id}/{task_id}")
def google_tasks_update(task_list_id: str, task_id: str, item: GoogleTaskUpdate, user: dict = Depends(get_current_user)):
    _require_google_configured()
    _require_google_product(user, "tasks")
    try:
        task, access = gi.complete_google_task(user, task_list_id, task_id, item.completed)
        _persist_google_token(user, access)
        return task
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        _google_error(e)


def _todo_google_sync_enabled(user_id: int) -> bool:
    """Treat sync as enabled by default; it only runs after Tasks is connected."""
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT todo_google_sync FROM user_settings WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return not row or bool(row["todo_google_sync"])


def _google_task_due(due_date: str = None) -> str:
    if not due_date:
        return None
    # Local to-dos use a calendar date. Google Tasks expects RFC 3339.
    return due_date if "T" in due_date else f"{due_date}T00:00:00.000Z"


def _todo_google_task_notes(todo: dict) -> str:
    parts = ["Synced from MyLife Productivity Dashboard.", f"Priority: {todo.get('priority') or 'medium'}"]
    if todo.get("description"):
        parts.append(str(todo["description"]))
    return "\n\n".join(parts)


def _sync_local_todo_to_google(user: dict, todo: dict, action: str = "upsert") -> str:
    """Best-effort one-way mirror from the local to-do list to Google Tasks."""
    if not gi.google_configured() or "tasks" not in _enabled_google_products(user):
        return "skipped"

    task_id = todo.get("google_task_id")
    task_list_id = todo.get("google_task_list_id")
    try:
        if action == "delete":
            if task_id and task_list_id:
                _, access = gi.delete_google_task(user, task_list_id, task_id)
                _persist_google_token(user, access)
                return "deleted"
            return "skipped"

        due = _google_task_due(todo.get("due_date"))
        notes = _todo_google_task_notes(todo)
        if task_id and task_list_id:
            _, access = gi.update_google_task(
                user, task_list_id, task_id, todo["title"], notes, due, bool(todo.get("completed")),
            )
            _persist_google_token(user, access)
            return "updated"

        task, access = gi.create_google_task(user, todo["title"], notes, due)
        _persist_google_token(user, access)
        conn = get_db()
        c = conn.cursor()
        c.execute(
            "UPDATE todos SET google_task_id = ?, google_task_list_id = ? WHERE id = ? AND user_id = ?",
            (task.get("id"), task.get("task_list_id"), todo["id"], user["id"]),
        )
        conn.commit()
        conn.close()
        return "created"
    except Exception:
        # A Google outage must never prevent someone from saving a local to-do.
        return "failed"


def _queue_todo_google_sync(user: dict, todo: dict, action: str) -> None:
    if "tasks" not in _enabled_google_products(user) or not _todo_google_sync_enabled(user["id"]):
        return
    threading.Thread(
        target=_sync_local_todo_to_google,
        args=(dict(user), dict(todo), action),
        daemon=True,
    ).start()


def _sync_all_local_todos_to_google(user: dict) -> dict:
    if not gi.google_configured():
        raise ValueError("Google is not configured on the server.")
    _require_google_product(user, "tasks")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM todos WHERE user_id = ? ORDER BY id", (user["id"],))
    todos = [dict(row) for row in c.fetchall()]
    conn.close()

    result = {"created": 0, "updated": 0, "failed": 0, "skipped": 0}
    for todo in todos:
        outcome = _sync_local_todo_to_google(user, todo)
        result[outcome] = result.get(outcome, 0) + 1
    result["total"] = len(todos)
    return result


@app.post("/sync/tasks")
def sync_local_todos_to_google(user: dict = Depends(get_current_user)):
    """Mirror all existing local to-dos after Google Tasks is first enabled."""
    try:
        return {"status": "ok", **_sync_all_local_todos_to_google(user)}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(400, str(e))


# ============================================================
# EMAIL NOTIFICATIONS
# ============================================================

def _deliver_report(user: dict, period: str = "daily") -> dict:
    if period not in ("daily", "weekly", "monthly", "yearly"):
        raise ValueError("Unsupported report period.")

    to = user.get("google_email") or user.get("email")
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM user_settings WHERE user_id = ?", (user["id"],))
    settings = c.fetchone()
    conn.close()
    settings = dict(settings) if settings else None
    if settings and settings.get("recipient"):
        to = settings["recipient"]

    today = datetime.now()
    start, end = _date_range(period, today)
    subject = f"MyLife {period.capitalize()} Report - {today.strftime('%Y-%m-%d')}"
    body_html = build_email_html(user["id"], start, end, period)
    excel_bytes = build_excel_bytes(user["id"], start, end, "all")
    attachment = (f"mylife_{period}_{today.strftime('%Y-%m-%d')}.xlsx", excel_bytes,
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    if "gmail" in _enabled_google_products(user):
        access = gi._authed_access(user)
        gi.send_gmail(access, to, subject, body_html, attachment)
        _persist_google_token(user, access)
        return {"status": "ok", "sent_to": to, "method": "gmail"}

    if settings and settings["smtp_host"]:
        send_smtp(settings, to, subject, body_html, attachment)
        return {"status": "ok", "sent_to": to, "method": "smtp"}

    raise ValueError("No delivery method configured. Add Gmail in My Google or set SMTP in Settings.")


@app.post("/notify/report")
def notify_report(period: str = "daily", user: dict = Depends(get_current_user)):
    try:
        return _deliver_report(user, period)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Report send failed: {e}")


@app.post("/notify/test")
def notify_test(user: dict = Depends(get_current_user)):
    to = user.get("google_email") or user.get("email")
    if "gmail" in _enabled_google_products(user):
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


AUTOMATION_DEFAULTS = {
    "weekly_report": 0,
    "weekly_report_day": 0,
    "weekly_report_time": "09:00",
    "auto_sync_sheets": 0,
    "auto_sync_drive": 0,
    "auto_sync_tasks": 0,
    "todo_google_sync": 1,
    "weekly_automation_last_run": None,
}


def _time_parts(value: str) -> tuple:
    """Validate HH:MM values before using them in a background scheduler."""
    try:
        hour, minute = str(value or "").split(":", 1)
        hour, minute = int(hour), int(minute)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except (TypeError, ValueError):
        pass
    raise ValueError("Time must use the HH:MM format.")


def _get_automation_settings(user_id: int) -> dict:
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    settings = dict(AUTOMATION_DEFAULTS)
    if row:
        source = dict(row)
        for key in settings:
            if source.get(key) is not None:
                settings[key] = source[key]
    return settings


@app.get("/settings/automation")
def get_automation_settings(user: dict = Depends(get_current_user)):
    return _get_automation_settings(user["id"])


@app.put("/settings/automation")
def update_automation_settings(
    settings: AutomationSettings,
    user: dict = Depends(get_current_user),
):
    if settings.weekly_report_day not in range(7):
        raise HTTPException(400, "Choose a valid day for the weekly automation.")
    try:
        _time_parts(settings.weekly_report_time)
    except ValueError as e:
        raise HTTPException(400, str(e))

    values = (
        int(bool(settings.weekly_report)),
        settings.weekly_report_day,
        settings.weekly_report_time,
        int(bool(settings.auto_sync_sheets)),
        int(bool(settings.auto_sync_drive)),
        int(bool(settings.auto_sync_tasks)),
        int(bool(settings.todo_google_sync)),
    )
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """INSERT INTO user_settings
           (user_id, weekly_report, weekly_report_day, weekly_report_time,
            auto_sync_sheets, auto_sync_drive, auto_sync_tasks, todo_google_sync)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             weekly_report=excluded.weekly_report,
             weekly_report_day=excluded.weekly_report_day,
             weekly_report_time=excluded.weekly_report_time,
             auto_sync_sheets=excluded.auto_sync_sheets,
             auto_sync_drive=excluded.auto_sync_drive,
             auto_sync_tasks=excluded.auto_sync_tasks,
             todo_google_sync=excluded.todo_google_sync""",
        (user["id"], *values),
    )
    conn.commit()
    conn.close()
    return {"status": "ok", **_get_automation_settings(user["id"])}


def _weekly_automation_is_due(settings: dict, now: datetime) -> bool:
    if now.weekday() != int(settings.get("weekly_report_day") or 0):
        return False
    hour, minute = _time_parts(settings.get("weekly_report_time"))
    if (now.hour, now.minute) < (hour, minute):
        return False
    return not str(settings.get("weekly_automation_last_run") or "").startswith(now.strftime("%Y-%m-%d"))


def _get_user_for_automation(user_id: int) -> dict:
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = c.fetchone()
    conn.close()
    return dict(row) if row else None


def _run_user_weekly_automation(
    user_id: int,
    force: bool = False,
    record_run: bool = True,
    now: datetime = None,
) -> dict:
    now = now or datetime.now()
    settings = _get_automation_settings(user_id)
    selected = [
        key for key in ("weekly_report", "auto_sync_sheets", "auto_sync_drive", "auto_sync_tasks")
        if settings.get(key)
    ]
    if not selected:
        return {"status": "not_configured", "results": {}}
    if not force and not _weekly_automation_is_due(settings, now):
        return {"status": "not_due", "results": {}}

    user = _get_user_for_automation(user_id)
    if not user:
        return {"status": "missing_user", "results": {}}

    enabled_products = _enabled_google_products(user)
    results = {}

    def run_product(key: str, product: str, action):
        if not settings.get(key):
            return
        if product not in enabled_products:
            results[key] = {"status": "skipped", "reason": f"Enable {product} in My Google first."}
            return
        try:
            results[key] = {"status": "ok", "data": action()}
        except Exception as e:
            results[key] = {"status": "failed", "reason": str(e)}

    run_product("auto_sync_sheets", "sheets", lambda: _sync_sheets_for_user(user, "all", "weekly"))
    run_product("auto_sync_drive", "drive", lambda: _backup_drive_for_user(user, "weekly"))
    run_product("auto_sync_tasks", "tasks", lambda: _sync_all_local_todos_to_google(user))

    if settings.get("weekly_report"):
        try:
            results["weekly_report"] = {"status": "ok", "data": _deliver_report(user, "weekly")}
        except Exception as e:
            results["weekly_report"] = {"status": "failed", "reason": str(e)}

    if record_run:
        conn = get_db()
        c = conn.cursor()
        c.execute(
            "UPDATE user_settings SET weekly_automation_last_run = ? WHERE user_id = ?",
            (now.strftime("%Y-%m-%d %H:%M"), user_id),
        )
        conn.commit()
        conn.close()
    return {"status": "ok", "results": results}


def _run_scheduled_weekly_automations(now: datetime = None) -> list:
    conn = get_db()
    c = conn.cursor()
    c.execute(
        """SELECT user_id FROM user_settings
           WHERE weekly_report = 1 OR auto_sync_sheets = 1
              OR auto_sync_drive = 1 OR auto_sync_tasks = 1"""
    )
    user_ids = [row["user_id"] for row in c.fetchall()]
    conn.close()
    return [_run_user_weekly_automation(user_id, now=now) for user_id in user_ids]


@app.post("/automation/run")
def run_weekly_automation_now(user: dict = Depends(get_current_user)):
    result = _run_user_weekly_automation(user["id"], force=True, record_run=False)
    if result["status"] == "not_configured":
        raise HTTPException(400, "Choose at least one weekly automation, then save your settings.")
    return result


# ============================================================
# REPORT & WEEKLY AUTOMATION SCHEDULER
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
                    report_hour, report_min = _time_parts(s["report_time"])
                    scheduled = f"{today} {report_hour:02d}:{report_min:02d}"
                    last = s.get("report_last_sent") or ""
                    if now.strftime("%Y-%m-%d %H:%M") >= scheduled and not last.startswith(today):
                        _send_daily_report(s["user_id"])
                except Exception:
                    continue
            _run_scheduled_weekly_automations(now)
        except Exception:
            pass
        time.sleep(60)


def _send_daily_report(user_id: int):
    user = _get_user_for_automation(user_id)
    if not user:
        return
    try:
        _deliver_report(user, "daily")
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


@app.post("/cron/automations")
def run_scheduled_automations_from_cron(
    x_cron_secret: str = Header(default="", alias="X-Cron-Secret"),
):
    """Protected entry point for a Render Cron Job or another scheduler."""
    if not CRON_SECRET or not secrets.compare_digest(x_cron_secret, CRON_SECRET):
        # Returning 404 avoids exposing a scheduler endpoint to random callers.
        raise HTTPException(404, "Not found")
    runs = _run_scheduled_weekly_automations()
    return {"status": "ok", "runs": runs}


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
