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

SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events.readonly",
]

TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def google_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def build_auth_url() -> str:
    from urllib.parse import urlencode

    return AUTH_URL + "?" + urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
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


def list_gmail_messages(user: dict, max_results: int = 25, query: str = "") -> list:
    params = {"maxResults": min(max_results, 50)}
    if query:
        params["q"] = query
    data, _ = authed_get(user, "https://gmail.googleapis.com/gmail/v1/users/me/messages", params=params)

    out = []
    for msg in data.get("messages", []):
        meta, _ = authed_get(
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
    return out


def read_gmail_message(user: dict, message_id: str) -> dict:
    data, _ = authed_get(
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
    }


# ---------- Google Drive ----------

def list_drive_files(user: dict, query: str = "", max_results: int = 100) -> list:
    params = {
        "pageSize": min(max_results, 1000),
        "fields": "files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink)",
    }
    if query:
        params["q"] = query
    data, _ = authed_get(user, "https://www.googleapis.com/drive/v3/files", params=params)
    return data.get("files", [])


# ---------- Google Sheets (list via Drive API) ----------

def list_google_sheets(user: dict, max_results: int = 100) -> list:
    return list_drive_files(user, "mimeType='application/vnd.google-apps.spreadsheet'", max_results)


# ---------- Google Calendar ----------

def list_calendar_events(user: dict, max_results: int = 20) -> list:
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
    data, _ = authed_get(user, "https://www.googleapis.com/calendar/v3/calendars/primary/events", params=params)
    return data.get("items", [])
