import hashlib
import hmac
import os
import json
import time
import base64

from fastapi import Depends, Header, HTTPException
from database import get_db

APP_SECRET = os.environ.get("APP_SECRET", "my-life-dashboard-local-secret-change-me")
ALLOWED_DOMAIN = os.environ.get("ALLOWED_DOMAIN", "").strip().lower()


# ---------- Password hashing (PBKDF2, no external deps) ----------

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), 200_000
        )
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


# ---------- Signed tokens (HMAC-SHA256, no external deps) ----------

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def create_token(user_id: int, expires_hours: int = 168) -> str:
    payload = {"uid": user_id, "exp": int(time.time()) + expires_hours * 3600}
    payload_b64 = _b64(json.dumps(payload).encode())
    sig = hmac.new(APP_SECRET.encode(), payload_b64.encode(), hashlib.sha256).digest()
    return f"{payload_b64}.{_b64(sig)}"


def verify_token(token: str):
    try:
        payload_b64, sig_b64 = token.split(".")
        sig = _unb64(sig_b64)
        expected = hmac.new(APP_SECRET.encode(), payload_b64.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_unb64(payload_b64))
        if payload.get("exp", 0) < time.time():
            return None
        return payload.get("uid")
    except Exception:
        return None


# ---------- FastAPI dependency ----------

def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    uid = verify_token(authorization[7:])
    if uid is None:
        raise HTTPException(401, "Invalid or expired token. Please log in again.")

    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (uid,))
    row = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(401, "User not found")
    return dict(row)


def public_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "google_email": user.get("google_email"),
        "google_connected": bool(user.get("google_access_token")),
    }


def email_allowed(email: str) -> bool:
    """When ALLOWED_DOMAIN is set, restrict sign-ups / Google account to one domain."""
    if not ALLOWED_DOMAIN:
        return True
    return email.lower().endswith("@" + ALLOWED_DOMAIN)
