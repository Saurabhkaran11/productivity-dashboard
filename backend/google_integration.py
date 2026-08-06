import os
import base64
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import requests

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback"
)
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

# Identity is intentionally separate from Workspace products.  Signing in with
# Google should never silently grant access to a user's inbox, files, or calendar.
IDENTITY_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

# The dashboard only requests access to a product after the user explicitly
# enables it.  Keep this catalog in one place so UI, OAuth, and API checks agree.
GOOGLE_PRODUCTS = {
    "gmail": {
        "label": "Gmail",
        "icon": "gmail",
        "api_name": "Gmail API",
        "category": "Email",
        "description": "Read your inbox and send dashboard reports.",
        "scopes": [
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.send",
        ],
    },
    "calendar": {
        "label": "Google Calendar",
        "icon": "calendar",
        "api_name": "Google Calendar API",
        "category": "Planning",
        "description": "View and add events from your productivity dashboard.",
        "scopes": ["https://www.googleapis.com/auth/calendar.events"],
    },
    "drive": {
        "label": "Google Drive",
        "icon": "drive",
        "api_name": "Google Drive API",
        "category": "Files",
        "description": "Browse file metadata and save dashboard backups.",
        "scopes": [
            "https://www.googleapis.com/auth/drive.metadata.readonly",
            "https://www.googleapis.com/auth/drive.file",
        ],
    },
    "sheets": {
        "label": "Google Sheets",
        "icon": "sheets",
        "api_name": "Google Sheets API",
        "category": "Reports",
        "description": "Create and export productivity reports as spreadsheets.",
        "scopes": [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
    },
    "tasks": {
        "label": "Google Tasks",
        "icon": "tasks",
        "api_name": "Google Tasks API",
        "category": "Tasks",
        "description": "See, add, and complete tasks without leaving MyLife.",
        "scopes": ["https://www.googleapis.com/auth/tasks"],
    },
}

TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def google_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def build_auth_url(scopes=None, state: str = "") -> str:
    from urllib.parse import urlencode

    requested_scopes = scopes or IDENTITY_SCOPES
    return AUTH_URL + "?" + urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(requested_scopes),
        "state": state,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
    })


def exchange_code(code: str):
    resp = requests.post(TOKEN_URL, data={
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


def refresh_access(refresh_token: str) -> str:
    resp = requests.post(TOKEN_URL, data={
        "refresh_token": refresh_token,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "grant_type": "refresh_token",
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()["access_token"]


def get_userinfo(access_token: str) -> dict:
    resp = requests.get(USERINFO_URL, headers={
        "Authorization": f"Bearer {access_token}",
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _authed_access(user: dict) -> str:
    access = user.get("google_access_token")
    refresh = user.get("google_refresh_token")
    if not access and not refresh:
        raise ValueError("Google account is not connected.")
    if access:
        return access
    return refresh_access(refresh)


def authed_get(user: dict, url: str, params: dict = None) -> tuple:
    """GET with refresh-on-401. Returns (json_data, access_token_used)."""
    access = user.get("google_access_token")
    refresh = user.get("google_refresh_token")
    if not access and not refresh:
        raise ValueError("Google account is not connected.")
    if not access:
        access = refresh_access(refresh)

    headers = {"Authorization": f"Bearer {access}"}
    resp = requests.get(url, params=params, headers=headers, timeout=60)
    if resp.status_code == 401 and refresh:
        access = refresh_access(refresh)
        headers["Authorization"] = f"Bearer {access}"
        resp = requests.get(url, params=params, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json(), access


def _authed_mutation(user: dict, method: str, url: str, json_body: dict = None) -> tuple:
    """POST/PATCH with one refresh retry. Returns (json_data, access_token_used)."""
    access = user.get("google_access_token")
    refresh = user.get("google_refresh_token")
    if not access and not refresh:
        raise ValueError("Google account is not connected.")
    if not access:
        access = refresh_access(refresh)

    headers = {"Authorization": f"Bearer {access}", "Content-Type": "application/json"}
    resp = requests.request(method, url, headers=headers, json=json_body, timeout=60)
    if resp.status_code == 401 and refresh:
        access = refresh_access(refresh)
        headers["Authorization"] = f"Bearer {access}"
        resp = requests.request(method, url, headers=headers, json=json_body, timeout=60)
    resp.raise_for_status()
    return resp.json() if resp.content else {}, access


def authed_post(user: dict, url: str, json_body: dict = None) -> tuple:
    return _authed_mutation(user, "POST", url, json_body)


def authed_patch(user: dict, url: str, json_body: dict = None) -> tuple:
    return _authed_mutation(user, "PATCH", url, json_body)


def revoke_token(token: str) -> None:
    if not token:
        return
    resp = requests.post("https://oauth2.googleapis.com/revoke", params={"token": token}, timeout=30)
    # A token can already be revoked; local credentials still must be cleared.
    if resp.status_code not in (200, 400):
        resp.raise_for_status()


# ---------- Google Sheets ----------

def create_spreadsheet(access_token: str, title: str):
    resp = requests.post(
        "https://sheets.googleapis.com/v4/spreadsheets",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={"properties": {"title": title}},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["spreadsheetId"], data["spreadsheetUrl"]


def write_sheet_values(access_token: str, spreadsheet_id: str, range_name: str, values):
    resp = requests.put(
        f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/{range_name}",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        params={"valueInputOption": "USER_ENTERED"},
        json={"values": values},
        timeout=30,
    )
    resp.raise_for_status()


# ---------- Google Drive ----------

def create_drive_folder(access_token: str, name: str):
    resp = requests.post(
        "https://www.googleapis.com/drive/v3/files",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def upload_drive_file(access_token: str, filename: str, mime: str, content: bytes, folder_id=None):
    metadata = {"name": filename, "mimeType": mime}
    if folder_id:
        metadata["parents"] = [folder_id]

    files = {
        "metadata": (None, json.dumps(metadata), "application/json"),
        "file": (filename, content, mime),
    }
    resp = requests.post(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        headers={"Authorization": f"Bearer {access_token}"},
        files=files,
        params={"fields": "id,webViewLink"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


# ---------- Gmail API (send email) ----------

def send_gmail(access_token: str, to: str, subject: str, body_html: str, attachment: tuple = None):
    msg = MIMEMultipart("mixed")
    msg["To"] = to
    msg["Subject"] = subject

    html_part = MIMEText(body_html, "html", "utf-8")
    msg.attach(html_part)

    if attachment:
        filename, content, mime = attachment
        from email.mime.base import MIMEBase
        from email import encoders

        part = MIMEBase("application", "octet-stream")
        part.set_payload(content)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f"attachment; filename={filename}")
        msg.attach(part)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    resp = requests.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        json={"raw": raw},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


# ---------- Gmail (read) ----------

def _message_text(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data).decode("utf-8", "ignore") if data else ""
    parts = payload.get("parts") or []
    for part in parts:
        if part.get("mimeType") == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", "ignore")
    for part in parts:
        text = _message_text(part)
        if text:
            return text
    return ""


def _message_headers(message: dict) -> dict:
    payload = message.get("payload", {})
    return {h["name"]: h["value"] for h in payload.get("headers", []) if h.get("name") and h.get("value")}


def list_gmail_messages(user: dict, max_results: int = 25, query: str = "") -> tuple:
    params = {"maxResults": min(max_results, 50)}
    if query:
        params["q"] = query
    data, access = authed_get(user, "https://gmail.googleapis.com/gmail/v1/users/me/messages", params=params)

    out = []
    for msg in data.get("messages", []):
        meta, access = authed_get(
            user,
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg['id']}",
            params={"format": "metadata", "metadataHeaders": "From,Subject,Date"},
        )
        headers = _message_headers(meta)
        out.append({
            "id": msg["id"],
            "from": headers.get("From", ""),
            "subject": headers.get("Subject", "(no subject)"),
            "date": headers.get("Date", ""),
            "snippet": meta.get("snippet", ""),
            "unread": "UNREAD" in meta.get("labelIds", []),
        })
    return out, access


def read_gmail_message(user: dict, message_id: str) -> tuple:
    data, access = authed_get(
        user,
        f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",
        params={"format": "full"},
    )
    headers = _message_headers(data)
    return {
        "id": message_id,
        "from": headers.get("From", ""),
        "to": headers.get("To", ""),
        "subject": headers.get("Subject", "(no subject)"),
        "date": headers.get("Date", ""),
        "labels": data.get("labelIds", []),
        "unread": "UNREAD" in data.get("labelIds", []),
        "body": _message_text(data.get("payload", {})),
    }, access


# ---------- Google Drive ----------

def list_drive_files(user: dict, query: str = "", max_results: int = 100) -> tuple:
    params = {
        "pageSize": min(max_results, 1000),
        "fields": "files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)",
    }
    if query:
        params["q"] = query
    data, access = authed_get(user, "https://www.googleapis.com/drive/v3/files", params=params)
    return data.get("files", []), access


# ---------- Google Sheets (list via Drive API) ----------

def list_google_sheets(user: dict, max_results: int = 100) -> tuple:
    return list_drive_files(user, "mimeType='application/vnd.google-apps.spreadsheet'", max_results)


# ---------- Google Calendar ----------

def list_calendar_events(user: dict, max_results: int = 20) -> tuple:
    from datetime import datetime

    now = datetime.now().astimezone().isoformat()
    params = {
        "calendarId": "primary",
        "maxResults": min(max_results, 100),
        "orderBy": "startTime",
        "singleEvents": True,
        "timeMin": now,
        "fields": "items(id,summary,start,end,location,description,status)",
    }
    data, access = authed_get(user, "https://www.googleapis.com/calendar/v3/calendars/primary/events", params=params)
    return data.get("items", []), access


def create_calendar_event(user: dict, title: str, start: str, end: str, description: str = "") -> tuple:
    event, access = authed_post(
        user,
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
            "summary": title,
            "description": description,
            "start": {"dateTime": start},
            "end": {"dateTime": end},
        },
    )
    return event, access


# ---------- Google Tasks ----------

def _default_task_list(user: dict) -> tuple:
    lists, access = authed_get(
        user,
        "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
        params={"maxResults": 100},
    )
    items = lists.get("items", [])
    if items:
        return items[0]["id"], access
    created, access = authed_post(
        user,
        "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
        {"title": "My Tasks"},
    )
    return created["id"], access


def list_google_tasks(user: dict, max_results: int = 100) -> tuple:
    task_list_id, _ = _default_task_list(user)
    data, access = authed_get(
        user,
        f"https://tasks.googleapis.com/tasks/v1/lists/{task_list_id}/tasks",
        params={"maxResults": min(max_results, 100), "showCompleted": True},
    )
    tasks = []
    for item in data.get("items", []):
        tasks.append({
            "id": item["id"],
            "task_list_id": task_list_id,
            "title": item.get("title", "Untitled task"),
            "notes": item.get("notes", ""),
            "due": item.get("due"),
            "status": item.get("status", "needsAction"),
            "updated": item.get("updated"),
        })
    return tasks, access


def create_google_task(user: dict, title: str, notes: str = "", due: str = None) -> tuple:
    task_list_id, _ = _default_task_list(user)
    body = {"title": title}
    if notes:
        body["notes"] = notes
    if due:
        body["due"] = due
    task, access = authed_post(
        user,
        f"https://tasks.googleapis.com/tasks/v1/lists/{task_list_id}/tasks",
        body,
    )
    task["task_list_id"] = task_list_id
    return task, access


def complete_google_task(user: dict, task_list_id: str, task_id: str, completed: bool) -> tuple:
    task, access = authed_patch(
        user,
        f"https://tasks.googleapis.com/tasks/v1/lists/{task_list_id}/tasks/{task_id}",
        {"status": "completed" if completed else "needsAction"},
    )
    task["task_list_id"] = task_list_id
    return task, access
