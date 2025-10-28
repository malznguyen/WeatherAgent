from __future__ import annotations

import logging
import os
import sys
import time
from typing import Any, Callable, Dict, Optional, Tuple

import flask
import requests
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, render_template, request
from flask_cors import CORS

from services import ai as AI
from services import weather as W

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("weather-agent")

OPENWEATHER_API_KEY = (os.getenv("OPENWEATHER_API_KEY") or "").strip()
OPENAI_API_KEY = (os.getenv("OPENAI_API_KEY") or "").strip()
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "https://api.deepseek.com").strip()


def mask_key(value: str) -> str:
    if not value:
        return "(not set)"
    trimmed = value.strip()
    if len(trimmed) <= 4:
        return "****"
    return f"****{trimmed[-4:]}"


logger.info(
    "Starting Weather Forecast Agent | Flask=%s | Requests=%s",
    flask.__version__,
    requests.__version__,
)
try:
    import openai  # type: ignore
except Exception as exc:  # pragma: no cover - optional dependency
    openai = None  # type: ignore
    OPENAI_SDK_VERSION = "not-installed"
    OPENAI_IMPORT_ERROR: Optional[Exception] = exc
else:  # pragma: no cover - runtime only
    OPENAI_SDK_VERSION = getattr(openai, "__version__", "unknown")
    try:
        from openai import OpenAI as _OpenAIProbe  # type: ignore

        OPENAI_IMPORT_ERROR = None
    except Exception as exc:  # pragma: no cover - optional dependency
        OPENAI_IMPORT_ERROR = exc

logger.info("OpenWeather API key: %s", mask_key(OPENWEATHER_API_KEY))
logger.info("OpenAI API key: %s", mask_key(OPENAI_API_KEY))
logger.info("OpenAI base URL: %s", OPENAI_BASE_URL or "(default)")
logger.info("OpenAI SDK version: %s", OPENAI_SDK_VERSION)

if OPENAI_API_KEY and "\n" in OPENAI_API_KEY:
    logger.warning("OPENAI_API_KEY appears to contain newline characters. Ensure it is on a single line in the .env file.")

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app, resources={r"/api/*": {"origins": "*"}})
W.configure(OPENWEATHER_API_KEY, logger=logger)


@app.before_request
def start_timer() -> None:
    if request.path.startswith("/api/"):
        g.request_started = time.perf_counter()


@app.after_request
def log_request(response: Response) -> Response:
    if request.path.startswith("/api/"):
        started = getattr(g, "request_started", None)
        latency_ms = (time.perf_counter() - started) * 1000 if started else 0.0
        query_string = request.query_string.decode("utf-8", "ignore")
        query_display = f"?{query_string}" if query_string else ""
        logger.info(
            "API request %s %s%s -> %s (%.2f ms)",
            request.method,
            request.path,
            query_display,
            response.status_code,
            latency_ms,
        )
    return response


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/healthz")
def healthz() -> Response:
    return jsonify({"status": "ok"})


@app.route("/api/geocode")
def api_geocode() -> Response:
    query = (request.args.get("query") or "").strip()
    if not query:
        return _error_response(400, "INVALID_QUERY", hint="Parameter 'query' is required.")

    if not OPENWEATHER_API_KEY:
        return _missing_key_response()

    try:
        result = W.geocode(query)
    except W.MissingApiKeyError:
        return _missing_key_response()
    except W.UpstreamTimeoutError:
        return _error_response(502, "UPSTREAM_TIMEOUT", hint="OpenWeather geocoding request timed out.")
    except W.UpstreamServiceError as exc:
        logger.error("OpenWeather geocode error (%s): %s", exc.status_code, exc)
        status = 503 if exc.status_code >= 500 else 502
        return _error_response(status, "UPSTREAM_ERROR", hint="OpenWeather geocoding failed. Please try again later.")

    if not result:
        return _error_response(404, "LOCATION_NOT_FOUND", hint="Unable to find that location.")

    return jsonify(result)


@app.route("/api/weather")
def api_weather() -> Response:
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if lat is None or lon is None:
        return _error_response(400, "INVALID_COORDINATES", hint="Parameters 'lat' and 'lon' are required.")

    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except ValueError:
        return _error_response(400, "INVALID_COORDINATES", hint="Parameters 'lat' and 'lon' must be numbers.")

    units = (request.args.get("units") or "metric").strip().lower() or "metric"
    allowed_units = {"standard", "metric", "imperial"}
    if units not in allowed_units:
        return _error_response(
            400,
            "INVALID_UNITS",
            hint="Parameter 'units' must be one of standard|metric|imperial.",
        )

    if not OPENWEATHER_API_KEY:
        return _missing_key_response()

    try:
        data = W.get_weather(lat_f, lon_f, units=units)
    except W.MissingApiKeyError:
        return _missing_key_response()
    except W.UpstreamTimeoutError:
        return _error_response(502, "UPSTREAM_TIMEOUT", hint="OpenWeather weather request timed out.")
    except W.UpstreamServiceError as exc:
        logger.error("OpenWeather weather error (%s): %s", exc.status_code, exc)
        status = 503 if exc.status_code >= 500 else 502
        return _error_response(status, "UPSTREAM_ERROR", hint="OpenWeather weather service is unavailable. Please try again later.")

    return jsonify(data)


@app.route("/api/ai/insights")
def api_ai_insights() -> Response:
    started = time.perf_counter()
    lat, lon, error_response, error_code = _parse_coordinates_from_query()
    if error_response is not None:
        _log_ai_request(lat, lon, error_response.status_code, started, error_code)
        return error_response

    response, ai_error = _execute_ai_pipeline(lat, lon, AI.summarize, label="insights")
    _log_ai_request(lat, lon, response.status_code, started, ai_error)
    return response


@app.route("/api/ai/alerts")
def api_ai_alerts() -> Response:
    started = time.perf_counter()
    lat, lon, error_response, error_code = _parse_coordinates_from_query()
    if error_response is not None:
        _log_ai_request(lat, lon, error_response.status_code, started, error_code)
        return error_response

    response, ai_error = _execute_ai_pipeline(lat, lon, AI.alerts, label="alerts")
    _log_ai_request(lat, lon, response.status_code, started, ai_error)
    return response


@app.route("/api/ai/selftest")
def api_ai_selftest() -> Response:
    started = time.perf_counter()
    payload = _perform_openai_selftest()
    payload["took_ms"] = int((time.perf_counter() - started) * 1000)
    response = jsonify(payload)
    response.status_code = 200
    return response


@app.route("/api/ai/ask", methods=["POST"])
def api_ai_ask() -> Response:
    started = time.perf_counter()
    payload = request.get_json(silent=True) or {}

    question = (payload.get("question") or "").strip() if isinstance(payload, dict) else ""
    lat_raw = payload.get("lat") if isinstance(payload, dict) else None
    lon_raw = payload.get("lon") if isinstance(payload, dict) else None

    lat: Optional[float] = None
    lon: Optional[float] = None

    if not question or lat_raw is None or lon_raw is None:
        response = _ai_error_response(400, "BAD_REQUEST", hint="Body phải gồm 'question', 'lat', 'lon'.")
        _log_ai_request(lat, lon, response.status_code, started, _extract_error_code(response))
        return response

    try:
        lat = float(lat_raw)
        lon = float(lon_raw)
    except (TypeError, ValueError):
        response = _ai_error_response(400, "BAD_REQUEST", hint="Giá trị 'lat' và 'lon' phải là số.")
        _log_ai_request(lat, lon, response.status_code, started, _extract_error_code(response))
        return response

    error_code: Optional[str] = None

    try:
        context = _get_ctx(lat, lon)
        ai_payload = AI.chat(question, context)
        response = jsonify(ai_payload)
        response.status_code = 200
    except AI.AiDisabled:
        response = _ai_simple_error(400, "OPENAI_DISABLED")
        error_code = "OPENAI_DISABLED"
    except AI.AiSdkIncompatible as exc:
        response = _ai_simple_error(400, "OPENAI_SDK_INCOMPATIBLE", detail=str(exc)[:200])
        error_code = "OPENAI_SDK_INCOMPATIBLE"
    except AI.AiTimeout:
        response = _ai_simple_error(504, "AI_TIMEOUT")
        error_code = "AI_TIMEOUT"
    except AI.AiServiceError as exc:
        logger.exception("AI chat error: %s", exc)
        response = _ai_simple_error(500, "AI_INTERNAL", detail=str(exc)[:200])
        error_code = "AI_INTERNAL"
    except W.MissingApiKeyError:
        response = _ai_error_response(400, "MISSING_WEATHER_KEY", hint="OpenWeather API key is missing.")
        error_code = _extract_error_code(response)
    except W.UpstreamTimeoutError:
        response = _ai_error_response(502, "UPSTREAM_TIMEOUT", hint="OpenWeather request timed out.")
        error_code = _extract_error_code(response)
    except W.UpstreamServiceError as exc:
        logger.error("Weather service error (%s) while handling AI chat: %s", exc.status_code, exc)
        response = _ai_error_response(502, "UPSTREAM_ERROR", hint="Không thể lấy dữ liệu thời tiết từ OpenWeather.")
        error_code = _extract_error_code(response)
    except Exception as exc:  # pragma: no cover
        logger.exception("Unexpected AI chat error: %s", exc)
        response = _ai_simple_error(500, "AI_INTERNAL", detail="Không thể trả lời câu hỏi ngay lúc này.")
        error_code = "AI_INTERNAL"

    _log_ai_request(lat, lon, response.status_code, started, error_code)
    return response


def _missing_key_response() -> Response:
    return _error_response(
        400,
        "MISSING_API_KEY",
        hint="OpenWeather API key is missing. Set OPENWEATHER_API_KEY in your .env file.",
    )


def _error_response(
    status_code: int,
    error_code: str,
    *,
    hint: Optional[str] = None,
    detail: Optional[str] = None,
) -> Response:
    payload: Dict[str, Any] = {"error": error_code, "code": status_code}
    if hint:
        payload["hint"] = hint
    if detail:
        payload["detail"] = detail
    response = jsonify(payload)
    response.status_code = status_code
    return response


def _ai_error_response(
    status_code: int,
    error_code: str,
    *,
    hint: Optional[str] = None,
    detail: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> Response:
    payload: Dict[str, Any] = {"error": error_code}
    if hint:
        payload["hint"] = hint
    if detail:
        payload["detail"] = detail
    if trace_id:
        payload["trace_id"] = trace_id
    response = jsonify(payload)
    response.status_code = status_code
    return response


def _ai_simple_error(status: int, error_code: str, *, detail: Optional[str] = None) -> Response:
    payload: Dict[str, Any] = {"error": error_code}
    if detail:
        payload["detail"] = detail
    response = jsonify(payload)
    response.status_code = status
    return response


def _parse_coordinates_from_query() -> Tuple[Optional[float], Optional[float], Optional[Response], Optional[str]]:
    lat_str = request.args.get("lat")
    lon_str = request.args.get("lon")
    if lat_str is None or lon_str is None:
        response = _ai_error_response(400, "BAD_REQUEST", hint="Thiếu tham số ?lat=..&lon=..")
        return None, None, response, "BAD_REQUEST"

    try:
        lat = float(lat_str)
        lon = float(lon_str)
    except ValueError:
        response = _ai_error_response(400, "BAD_REQUEST", hint="lat/lon phải là số hợp lệ")
        return None, None, response, "BAD_REQUEST"

    return lat, lon, None, None


def _get_ctx(lat: float, lon: float) -> Dict[str, Any]:
    return W.get_weather(lat, lon)


def _extract_error_code(response: Response) -> Optional[str]:
    try:
        payload = response.get_json()
    except Exception:  # pragma: no cover - defensive
        return None
    if isinstance(payload, dict):
        return payload.get("error")
    return None


def _log_ai_request(
    lat: Optional[float],
    lon: Optional[float],
    status: int,
    started: float,
    error: Optional[str],
) -> None:
    elapsed_ms = (time.perf_counter() - started) * 1000
    lat_repr = f"{lat:.4f}" if isinstance(lat, (int, float)) else "?"
    lon_repr = f"{lon:.4f}" if isinstance(lon, (int, float)) else "?"
    logger.info(
        "AI request %s %s lat=%s lon=%s status=%s error=%s took_ms=%.2f",
        request.method,
        request.path,
        lat_repr,
        lon_repr,
        status,
        error or "-",
        elapsed_ms,
    )


def _execute_ai_pipeline(
    lat: float,
    lon: float,
    builder: Callable[[Dict[str, Any]], Dict[str, Any]],
    *,
    label: str,
) -> Tuple[Response, Optional[str]]:
    try:
        context = _get_ctx(lat, lon)
    except W.MissingApiKeyError:
        response = _ai_error_response(400, "MISSING_WEATHER_KEY", hint="OpenWeather API key is missing.")
        return response, _extract_error_code(response)
    except W.UpstreamTimeoutError:
        response = _ai_error_response(502, "UPSTREAM_TIMEOUT", hint="OpenWeather request timed out.")
        return response, _extract_error_code(response)
    except W.UpstreamServiceError as exc:
        logger.error("Weather service error (%s) while building AI %s: %s", exc.status_code, label, exc)
        response = _ai_error_response(502, "UPSTREAM_ERROR", hint="Không thể lấy dữ liệu thời tiết từ OpenWeather.")
        return response, _extract_error_code(response)

    try:
        payload = builder(context)
    except AI.AiDisabled:
        response = _ai_simple_error(400, "OPENAI_DISABLED")
        return response, "OPENAI_DISABLED"
    except AI.AiSdkIncompatible as exc:
        response = _ai_simple_error(400, "OPENAI_SDK_INCOMPATIBLE", detail=str(exc)[:200])
        return response, "OPENAI_SDK_INCOMPATIBLE"
    except AI.AiParseError as exc:
        response = _ai_simple_error(502, "AI_PARSE_FAILED", detail=str(exc)[:200])
        return response, "AI_PARSE_FAILED"
    except AI.AiTimeout:
        response = _ai_simple_error(504, "AI_TIMEOUT")
        return response, "AI_TIMEOUT"
    except AI.AiServiceError as exc:
        logger.exception("AI %s error: %s", label, exc)
        response = _ai_simple_error(500, "AI_INTERNAL", detail=str(exc)[:200])
        return response, "AI_INTERNAL"
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Unexpected AI %s error: %s", label, exc)
        response = _ai_simple_error(500, "AI_INTERNAL", detail=str(exc)[:200])
        return response, "AI_INTERNAL"

    response = jsonify(payload)
    response.status_code = 200
    return response, None


def _perform_openai_selftest() -> Dict[str, Any]:
    # Use the configured chat model from AI module (defaults to DeepSeek)
    model_name = getattr(AI, "CHAT_MODEL", "deepseek-chat")
    sdk_info = AI.sdk_status()
    result: Dict[str, Any] = {
        "openai_ok": False,
        "model": model_name,
        "sdk_version": sdk_info.get("version") or OPENAI_SDK_VERSION,
        "error": None,
    }

    if not sdk_info.get("compatible", False):
        error_message = sdk_info.get("error") or (
            str(OPENAI_IMPORT_ERROR) if OPENAI_IMPORT_ERROR else "OpenAI SDK is not available"
        )
        result["error"] = (error_message or "")[:200]
        return result

    api_key = OPENAI_API_KEY.strip()
    if not api_key:
        result["error"] = "OPENAI_API_KEY missing or blank"
        return result

    try:
        from openai import OpenAI as _SelfTestClient  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency
        result["error"] = f"Cannot import OpenAI client: {exc}"[:200]
        return result

    try:
        # Use base URL to support DeepSeek
        if OPENAI_BASE_URL:
            client = _SelfTestClient(api_key=api_key, base_url=OPENAI_BASE_URL)
        else:
            client = _SelfTestClient(api_key=api_key)
    except Exception as exc:  # pragma: no cover - runtime
        result["error"] = f"Failed to initialize OpenAI client: {exc}"[:200]
        return result

    completions = getattr(client, "chat", None)
    if completions is None or not hasattr(completions, "completions"):
        result["error"] = "OpenAI SDK is incompatible (chat completions missing)"
        return result

    try:
        _ = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": "ping"}],
            timeout=8,
        )
    except Exception as exc:  # pragma: no cover - network path
        result["error"] = str(exc)[:200]
        return result

    result["openai_ok"] = True
    return result


if __name__ == "__main__":
    app.run(debug=True)
