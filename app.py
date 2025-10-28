from __future__ import annotations

import logging
import os
import sys
import time
from typing import Any, Dict

import flask
import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, g
from flask_cors import CORS

from services import weather as weather_service

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
logger.info("OpenWeather API key: %s", mask_key(OPENWEATHER_API_KEY))
logger.info("OpenAI API key: %s", mask_key(OPENAI_API_KEY))

if OPENAI_API_KEY and "\n" in OPENAI_API_KEY:
    logger.warning("OPENAI_API_KEY appears to contain newline characters. Ensure it is on a single line in the .env file.")

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app, resources={r"/api/*": {"origins": "*"}})
weather_service.configure(OPENWEATHER_API_KEY, logger=logger)


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
        result = weather_service.geocode(query)
    except weather_service.MissingApiKeyError:
        return _missing_key_response()
    except weather_service.UpstreamTimeoutError:
        return _error_response(502, "UPSTREAM_TIMEOUT", "OpenWeather geocoding request timed out.")
    except weather_service.UpstreamServiceError as exc:
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
        data = weather_service.get_weather(lat_f, lon_f)
    except weather_service.MissingApiKeyError:
        return _missing_key_response()
    except weather_service.UpstreamTimeoutError:
        return _error_response(502, "UPSTREAM_TIMEOUT", "OpenWeather weather request timed out.")
    except weather_service.UpstreamServiceError as exc:
        logger.error("OpenWeather weather error (%s): %s", exc.status_code, exc)
        status = 503 if exc.status_code >= 500 else 502
        return _error_response(status, "UPSTREAM_ERROR", "OpenWeather weather service is unavailable. Please try again later.")

    return jsonify(data)


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


if __name__ == "__main__":
    app.run(debug=True)
