from __future__ import annotations

import logging
import os
import sys
import time
import uuid
from typing import Any, Dict, Optional, Tuple

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

    OPENAI_SDK_VERSION = getattr(openai, "__version__", "unknown")
except Exception:  # pragma: no cover - optional dependency
    OPENAI_SDK_VERSION = "not-installed"

logger.info("OpenWeather API key: %s", mask_key(OPENWEATHER_API_KEY))
logger.info("OpenAI API key: %s", mask_key(OPENAI_API_KEY))
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
        return _error_response(400, "INVALID_QUERY", "Parameter 'query' is required.")

    if not OPENWEATHER_API_KEY:
        return _missing_key_response()

    try:
        result = W.geocode(query)
    except W.MissingApiKeyError:
        return _missing_key_response()
    except W.UpstreamTimeoutError:
        return _error_response(502, "UPSTREAM_TIMEOUT", "OpenWeather geocoding request timed out.")
    except W.UpstreamServiceError as exc:
        logger.error("OpenWeather geocode error (%s): %s", exc.status_code, exc)
        status = 503 if exc.status_code >= 500 else 502
        return _error_response(status, "UPSTREAM_ERROR", "OpenWeather geocoding failed. Please try again later.")

    if not result:
        return _error_response(404, "LOCATION_NOT_FOUND", "Unable to find that location.")

    return jsonify(result)


@app.route("/api/weather")
def api_weather() -> Response:
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if lat is None or lon is None:
        return _error_response(400, "INVALID_COORDINATES", "Parameters 'lat' and 'lon' are required.")

    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except ValueError:
        return _error_response(400, "INVALID_COORDINATES", "Parameters 'lat' and 'lon' must be numbers.")

    if not OPENWEATHER_API_KEY:
        return _missing_key_response()

    try:
        data = W.get_weather(lat_f, lon_f)
    except W.MissingApiKeyError:
        return _missing_key_response()
    except W.UpstreamTimeoutError:
        return _error_response(502, "UPSTREAM_TIMEOUT", "OpenWeather weather request timed out.")
    except W.UpstreamServiceError as exc:
        logger.error("OpenWeather weather error (%s): %s", exc.status_code, exc)
        status = 503 if exc.status_code >= 500 else 502
        return _error_response(status, "UPSTREAM_ERROR", "OpenWeather weather service is unavailable. Please try again later.")

    return jsonify(data)


@app.route("/api/ai/insights")
def api_ai_insights() -> Response:
    started = time.perf_counter()
    lat, lon, error_response = _parse_coordinates_from_query()
    if error_response is not None:
        _log_ai_request(lat, lon, error_response.status_code, started)
        return error_response

    try:
        context = _get_ctx(lat, lon)
        payload = AI.summarize(context)
        response = jsonify(payload)
        response.status_code = 200
    except AI.AiDisabled:
        response = _openai_disabled_response()
    except AI.AiServiceError as exc:
        logger.exception("AI insights error: %s", exc)
        response = _ai_error_response(502, "AI_SERVICE_ERROR", str(exc))
    except W.MissingApiKeyError:
        response = _ai_error_response(400, "MISSING_WEATHER_KEY", "OpenWeather API key is missing.")
    except W.UpstreamTimeoutError:
        response = _ai_error_response(502, "UPSTREAM_TIMEOUT", "OpenWeather request timed out.")
    except W.UpstreamServiceError as exc:
        logger.error("Weather service error (%s) while building AI insights: %s", exc.status_code, exc)
        response = _ai_error_response(502, "UPSTREAM_ERROR", "Không thể lấy dữ liệu thời tiết từ OpenWeather.")
    except Exception as exc:  # pragma: no cover - defensive branch
        logger.exception("Unexpected AI insights error: %s", exc)
        response = _ai_error_response(500, "AI_INTERNAL_ERROR", "Không thể tạo nội dung AI ngay lúc này.")

    _log_ai_request(lat, lon, response.status_code, started)
    return response


@app.route("/api/ai/alerts")
def api_ai_alerts() -> Response:
    started = time.perf_counter()
    lat, lon, error_response = _parse_coordinates_from_query()
    if error_response is not None:
        _log_ai_request(lat, lon, error_response.status_code, started)
        return error_response

    try:
        context = _get_ctx(lat, lon)
        payload = AI.alerts(context)
        response = jsonify(payload)
        response.status_code = 200
    except AI.AiDisabled:
        response = _openai_disabled_response()
    except AI.AiServiceError as exc:
        logger.exception("AI alerts error: %s", exc)
        response = _ai_error_response(502, "AI_SERVICE_ERROR", str(exc))
    except W.MissingApiKeyError:
        response = _ai_error_response(400, "MISSING_WEATHER_KEY", "OpenWeather API key is missing.")
    except W.UpstreamTimeoutError:
        response = _ai_error_response(502, "UPSTREAM_TIMEOUT", "OpenWeather request timed out.")
    except W.UpstreamServiceError as exc:
        logger.error("Weather service error (%s) while building AI alerts: %s", exc.status_code, exc)
        response = _ai_error_response(502, "UPSTREAM_ERROR", "Không thể lấy dữ liệu thời tiết từ OpenWeather.")
    except Exception as exc:  # pragma: no cover
        logger.exception("Unexpected AI alerts error: %s", exc)
        response = _ai_error_response(500, "AI_INTERNAL_ERROR", "Không thể tạo cảnh báo AI ngay lúc này.")

    _log_ai_request(lat, lon, response.status_code, started)
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
        response = _ai_error_response(400, "BAD_REQUEST", "Body phải gồm 'question', 'lat', 'lon'.")
        _log_ai_request(lat, lon, response.status_code, started)
        return response

    try:
        lat = float(lat_raw)
        lon = float(lon_raw)
    except (TypeError, ValueError):
        response = _ai_error_response(400, "BAD_REQUEST", "Giá trị 'lat' và 'lon' phải là số.")
        _log_ai_request(lat, lon, response.status_code, started)
        return response

    try:
        context = _get_ctx(lat, lon)
        ai_payload = AI.chat(question, context)
        response = jsonify(ai_payload)
        response.status_code = 200
    except AI.AiDisabled:
        response = _openai_disabled_response()
    except AI.AiServiceError as exc:
        logger.exception("AI chat error: %s", exc)
        response = _ai_error_response(502, "AI_SERVICE_ERROR", str(exc))
    except W.MissingApiKeyError:
        response = _ai_error_response(400, "MISSING_WEATHER_KEY", "OpenWeather API key is missing.")
    except W.UpstreamTimeoutError:
        response = _ai_error_response(502, "UPSTREAM_TIMEOUT", "OpenWeather request timed out.")
    except W.UpstreamServiceError as exc:
        logger.error("Weather service error (%s) while handling AI chat: %s", exc.status_code, exc)
        response = _ai_error_response(502, "UPSTREAM_ERROR", "Không thể lấy dữ liệu thời tiết từ OpenWeather.")
    except Exception as exc:  # pragma: no cover
        logger.exception("Unexpected AI chat error: %s", exc)
        response = _ai_error_response(500, "AI_INTERNAL_ERROR", "Không thể trả lời câu hỏi ngay lúc này.")

    _log_ai_request(lat, lon, response.status_code, started)
    return response


def _missing_key_response() -> Response:
    return _error_response(
        400,
        "MISSING_API_KEY",
        "OpenWeather API key is missing. Set OPENWEATHER_API_KEY in your .env file.",
    )


def _error_response(status_code: int, error_code: str, message: str) -> Response:
    payload: Dict[str, Any] = {"error": error_code, "message": message}
    response = jsonify(payload)
    response.status_code = status_code
    return response


def _openai_disabled_response() -> Response:
    return _ai_error_response(400, "OPENAI_DISABLED")


def _ai_error_response(status_code: int, error_code: str, message: Optional[str] = None) -> Response:
    trace_id = str(uuid.uuid4())
    payload: Dict[str, Any] = {
        "error": error_code,
        "trace_id": trace_id,
        "model": None,
        "took_ms": 0,
    }
    if message:
        payload["message"] = message
    response = jsonify(payload)
    response.status_code = status_code
    return response


def _parse_coordinates_from_query() -> Tuple[Optional[float], Optional[float], Optional[Response]]:
    lat_str = request.args.get("lat")
    lon_str = request.args.get("lon")
    if lat_str is None or lon_str is None:
        return None, None, _ai_error_response(400, "BAD_REQUEST", "?lat=..&lon=..")

    try:
        lat = float(lat_str)
        lon = float(lon_str)
    except ValueError:
        return None, None, _ai_error_response(400, "BAD_REQUEST", "?lat=..&lon=..")

    return lat, lon, None


def _get_ctx(lat: float, lon: float) -> Dict[str, Any]:
    return W.get_weather(lat, lon)


def _log_ai_request(lat: Optional[float], lon: Optional[float], status: int, started: float) -> None:
    elapsed_ms = (time.perf_counter() - started) * 1000
    lat_repr = f"{lat:.4f}" if isinstance(lat, (int, float)) else "?"
    lon_repr = f"{lon:.4f}" if isinstance(lon, (int, float)) else "?"
    logger.info(
        "AI request %s %s lat=%s lon=%s -> %s (%.2f ms)",
        request.method,
        request.path,
        lat_repr,
        lon_repr,
        status,
        elapsed_ms,
    )


if __name__ == "__main__":
    app.run(debug=True)
