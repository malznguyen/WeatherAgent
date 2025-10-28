"""Simple in-memory cache with TTL support."""
from __future__ import annotations

import threading
import time
from typing import Any, Optional

_LOCK = threading.Lock()
_STORE: dict[str, tuple[float, Any]] = {}


def get(key: str) -> Optional[Any]:
    """Retrieve a cached value if it has not expired."""
    now = time.time()
    with _LOCK:
        entry = _STORE.get(key)
        if not entry:
            return None
        expire_ts, value = entry
        if expire_ts <= now:
            del _STORE[key]
            return None
        return value


def set(key: str, value: Any, ttl_sec: float) -> None:
    """Store a value with the specified TTL (in seconds)."""
    expire_ts = time.time() + max(ttl_sec, 0)
    with _LOCK:
        _STORE[key] = (expire_ts, value)
