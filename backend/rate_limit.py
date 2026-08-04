import os
import threading
import time

from fastapi import Depends, HTTPException, Request

ALLOWED_DOMAIN = os.environ.get("ALLOWED_DOMAIN", "").strip().lower()


def email_allowed(email: str) -> bool:
    """When ALLOWED_DOMAIN is set, only emails at that domain are permitted."""
    if not ALLOWED_DOMAIN:
        return True
    return email.lower().endswith("@" + ALLOWED_DOMAIN)


class RateLimiter:
    """Tiny sliding-window limiter (in-memory, per-process)."""

    def __init__(self):
        self._buckets = {}
        self._lock = threading.Lock()

    def is_allowed(self, key: str, limit: int, window: int) -> tuple:
        now = time.time()
        with self._lock:
            b = self._buckets.get(key)
            if b is None or now - b["start"] >= window:
                b = {"start": now, "count": 1}
                self._buckets[key] = b
                return True, limit - 1
            if b["count"] >= limit:
                return False, 0
            b["count"] += 1
            return True, limit - b["count"]

        # periodic cleanup (best-effort, runs ~every few minutes per bucket churn)


_limiter = RateLimiter()


def rate_limit(limit: int = 20, window: int = 60):
    """FastAPI dependency that caps requests per client IP."""
    def dependency(request: Request):
        key = request.client.host if request.client else "unknown"
        ok, _ = _limiter.is_allowed(f"{key}", limit, window)
        if not ok:
            raise HTTPException(429, "Too many requests. Please wait a moment and try again.")
    return dependency
