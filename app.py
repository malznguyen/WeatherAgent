"""Flask application entry point for WeatherAgent."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Tuple

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

def _load_required_api_keys() -> Tuple[str, str]:
    """Load the API keys required for the application to operate."""

    load_dotenv()

    openweather_api_key = os.getenv("OPENWEATHER_API_KEY", "").strip()
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()

    missing_keys = [
        name
        for name, value in (
            ("OPENWEATHER_API_KEY", openweather_api_key),
            ("OPENAI_API_KEY", openai_api_key),
        )
        if not value
    ]

    if missing_keys:
        missing_list = ", ".join(missing_keys)
        raise RuntimeError(
            f"Missing required environment variable(s): {missing_list}."
        )

    return openweather_api_key, openai_api_key


# Configure basic logging for the application.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init_data_agent(api_key: str) -> Any:
    """Initialise the DataAgent instance.

    If the concrete implementation is not yet available, a placeholder agent is
    returned that raises ``NotImplementedError`` when used.
    """

    try:
        from agents import data_agent as data_agent_module

        data_agent_cls = getattr(data_agent_module, "DataAgent", None)
        if data_agent_cls is None:
            raise AttributeError("DataAgent class not implemented yet.")
        return data_agent_cls(api_key)
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning("Using placeholder DataAgent due to: %s", exc)

        class _PlaceholderDataAgent:
            def get_forecast(self, city: str) -> Dict[str, Any]:
                raise NotImplementedError("DataAgent.get_forecast is not implemented.")

        return _PlaceholderDataAgent()


def init_analysis_agent(api_key: str) -> Any:
    """Initialise the AnalysisAgent instance.

    Similar to :func:`init_data_agent`, a placeholder implementation is
    provided until the concrete agent is implemented elsewhere in the codebase.
    """

    try:
        from agents import analysis_agent as analysis_agent_module

        analysis_agent_cls = getattr(analysis_agent_module, "AnalysisAgent", None)
        if analysis_agent_cls is None:
            raise AttributeError("AnalysisAgent class not implemented yet.")
        return analysis_agent_cls(api_key)
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning("Using placeholder AnalysisAgent due to: %s", exc)

        class _PlaceholderAnalysisAgent:
            def process_forecast(self, forecast: Dict[str, Any]) -> Dict[str, Any]:
                raise NotImplementedError(
                    "AnalysisAgent.process_forecast is not implemented."
                )

        return _PlaceholderAnalysisAgent()


try:
    OPENWEATHER_API_KEY, OPENAI_API_KEY = _load_required_api_keys()
except RuntimeError as error:
    logger.error("Application configuration error: %s", error)
    raise


app = Flask(__name__)

data_agent = init_data_agent(OPENWEATHER_API_KEY)
analysis_agent = init_analysis_agent(OPENAI_API_KEY)


@app.route("/")
def index() -> str:
    """Render the landing page."""

    return render_template("index.html", weather_api_key=OPENWEATHER_API_KEY)


@app.post("/api/forecast")
def forecast() -> Any:
    """Return processed forecast information for the given city."""

    payload = request.get_json(silent=True) or {}
    city = payload.get("city")

    if not city:
        return jsonify({"error": "Missing 'city' in request payload."}), 400

    try:
        raw_forecast = _fetch_raw_forecast(city)
    except NotImplementedError as exc:
        logger.error("DataAgent is not ready: %s", exc)
        return jsonify({"error": str(exc)}), 501

    if raw_forecast is None:
        logger.error("DataAgent returned no forecast data for city '%s'", city)
        return jsonify({"error": "Unable to retrieve forecast data."}), 502

    try:
        processed_forecast = _process_forecast(raw_forecast)
    except NotImplementedError as exc:
        logger.error("AnalysisAgent is not ready: %s", exc)
        return jsonify({"error": str(exc)}), 501

    return jsonify(processed_forecast)


def _process_forecast(raw_forecast: Dict[str, Any]) -> Dict[str, Any]:
    """Run the forecast data through the analysis agent."""

    if hasattr(analysis_agent, "process_forecast"):
        return analysis_agent.process_forecast(raw_forecast)

    if hasattr(analysis_agent, "generate_summary"):
        return analysis_agent.generate_summary(raw_forecast)

    raise NotImplementedError("AnalysisAgent lacks a recognised processing method.")


def _fetch_raw_forecast(city: str) -> Any:
    """Obtain the forecast from the configured data agent."""

    if hasattr(data_agent, "get_forecast"):
        return data_agent.get_forecast(city)

    if hasattr(data_agent, "fetch_forecast"):
        return data_agent.fetch_forecast(city)

    raise NotImplementedError("DataAgent lacks a recognised forecast retrieval method.")


if __name__ == "__main__":
    logger.info("Starting WeatherAgent Flask application.")
    app.run(debug=True)
