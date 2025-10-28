"""Weather service integration for OpenWeather APIs."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests
from requests import Session
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from . import cache

BASE_URL = "https://api.openweathermap.org"
TIMEOUT = 5
CACHE_TTL_SECONDS = 90

_LOGGER = logging.getLogger(__name__)
_SESSION: Optional[Session] = None
_API_KEY: str = ""


class MissingApiKeyError(RuntimeError):
    """Raised when an operation requires the OpenWeather API key."""


class UpstreamTimeoutError(RuntimeError):
    """Raised when the upstream API times out."""


class UpstreamServiceError(RuntimeError):
    """Raised when the upstream service responds with an error."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


def configure(api_key: str, logger: Optional[logging.Logger] = None) -> None:
    """Configure the module with the provided API key and logger."""
    global _API_KEY, _SESSION, _LOGGER
    _API_KEY = (api_key or "").strip()
    _LOGGER = logger or logging.getLogger(__name__)

    retry = Retry(
        total=2,
        read=2,
        connect=2,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )

    session = requests.Session()
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    _SESSION = session
    _LOGGER.debug("Weather service configured with retry and HTTP session")


def _require_session() -> Session:
    if _SESSION is None:
        configure(_API_KEY)
    assert _SESSION is not None
    return _SESSION


def _ensure_api_key() -> None:
    if not _API_KEY:
        raise MissingApiKeyError("OpenWeather API key is missing")


def geocode(query: str) -> Optional[Dict[str, Any]]:
    """Resolve a textual query into coordinates using the OpenWeather API."""
    _ensure_api_key()
    if not query:
        return None

    cache_key = f"geocode:{query.strip().lower()}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    params = {"q": query, "limit": 1, "appid": _API_KEY}
    url = f"{BASE_URL}/geo/1.0/direct"
    session = _require_session()
    try:
        _LOGGER.debug("Calling OpenWeather geocode for query='%s'", query)
        response = session.get(url, params=params, timeout=TIMEOUT)
    except requests.Timeout as exc:
        raise UpstreamTimeoutError("OpenWeather geocoding timeout") from exc
    except requests.RequestException as exc:
        raise UpstreamServiceError("OpenWeather geocoding request failed", 503) from exc

    if response.status_code != 200:
        raise UpstreamServiceError(
            f"OpenWeather geocoding failed with status {response.status_code}",
            response.status_code,
        )

    results = response.json()
    if not results:
        return None

    top = results[0]
    name_parts = [
        part
        for part in [top.get("name"), top.get("state"), top.get("country")]
        if part
    ]
    lat_value = float(top.get("lat", 0.0))
    lon_value = float(top.get("lon", 0.0))
    location = {
        "name": ", ".join(name_parts) if name_parts else query,
        "lat": lat_value,
        "lon": lon_value,
    }
    cache.set(cache_key, location, CACHE_TTL_SECONDS)
    return location


def get_weather(lat: float, lon: float, units: str = "metric") -> Dict[str, Any]:
    """Fetch weather information for the provided coordinates."""
    _ensure_api_key()

    normalized_units = (units or "metric").lower()
    if normalized_units not in {"metric", "imperial", "standard"}:
        normalized_units = "metric"

    cache_key = f"weather:{normalized_units}:{lat:.4f}:{lon:.4f}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    session = _require_session()
    params = {
        "lat": lat,
        "lon": lon,
        "units": normalized_units,
        "exclude": "minutely,alerts",
        "appid": _API_KEY,
    }

    data = _fetch_weather_payload(session, params)
    normalized = _normalize_weather_response(data, lat, lon, normalized_units)
    cache.set(cache_key, normalized, CACHE_TTL_SECONDS)
    return normalized


def _fetch_weather_payload(session: Session, params: Dict[str, Any]) -> Dict[str, Any]:
    endpoints = ["/data/3.0/onecall", "/data/2.5/onecall"]

    last_error: Optional[Exception] = None
    for path in endpoints:
        url = f"{BASE_URL}{path}"
        try:
            _LOGGER.debug("Requesting weather data from %s", path)
            response = session.get(url, params=params, timeout=TIMEOUT)
        except requests.Timeout as exc:
            last_error = UpstreamTimeoutError("OpenWeather weather timeout")
            _LOGGER.warning("OpenWeather weather request to %s timed out", path)
            continue
        except requests.RequestException as exc:
            last_error = UpstreamServiceError("OpenWeather weather request failed", 503)
            _LOGGER.warning("OpenWeather weather request to %s failed: %s", path, exc)
            continue

        if response.status_code == 200:
            return response.json()

        if response.status_code in {401, 403, 404} and path != endpoints[-1]:
            _LOGGER.info(
                "Weather endpoint %s returned %s, attempting fallback", path, response.status_code
            )
            last_error = UpstreamServiceError("Unauthorized for endpoint", response.status_code)
            continue

        raise UpstreamServiceError(
            f"OpenWeather weather request failed with status {response.status_code}",
            response.status_code,
        )

    if last_error:
        raise last_error
    raise UpstreamServiceError("OpenWeather weather request failed", 503)


def _normalize_weather_response(data: Dict[str, Any], lat: float, lon: float, units: str) -> Dict[str, Any]:
    current = _normalize_current(data.get("current", {}))
    hourly = [_normalize_hourly(item) for item in data.get("hourly", [])[:12]]
    daily = [_normalize_daily(item) for item in data.get("daily", [])[:7]]

    location_name = f"{lat:.2f}, {lon:.2f}"
    return {
        "location": {"name": location_name, "lat": float(lat), "lon": float(lon)},
        "current": current,
        "hourly": hourly,
        "daily": daily,
        "provider": "openweather",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "units": units,
    }


def _normalize_current(entry: Dict[str, Any]) -> Dict[str, Any]:
    weather_info = _extract_weather(entry.get("weather"))
    return {
        "dt": entry.get("dt"),
        "sunrise": entry.get("sunrise"),
        "sunset": entry.get("sunset"),
        "temp": entry.get("temp"),
        "feels_like": entry.get("feels_like"),
        "humidity": entry.get("humidity"),
        "wind_speed": entry.get("wind_speed"),
        "uvi": entry.get("uvi"),
        "pressure": entry.get("pressure"),
        "visibility": entry.get("visibility"),
        "weather": weather_info,
    }


def _normalize_hourly(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "dt": entry.get("dt"),
        "temp": entry.get("temp"),
        "feels_like": entry.get("feels_like"),
        "humidity": entry.get("humidity"),
        "wind_speed": entry.get("wind_speed"),
        "pop": entry.get("pop", 0.0),
        "weather": _extract_weather(entry.get("weather")),
    }


def _normalize_daily(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "dt": entry.get("dt"),
        "temp": entry.get("temp", {}),
        "feels_like": entry.get("feels_like", {}),
        "humidity": entry.get("humidity"),
        "wind_speed": entry.get("wind_speed"),
        "pop": entry.get("pop", 0.0),
        "weather": _extract_weather(entry.get("weather")),
    }


def _extract_weather(items: Any) -> Dict[str, Any]:
    if not items:
        return {"main": None, "description": None, "icon": None}
    first = items[0]
    return {
        "main": first.get("main"),
        "description": first.get("description"),
        "icon": first.get("icon"),
    }
