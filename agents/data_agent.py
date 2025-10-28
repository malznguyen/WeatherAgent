"""Data agent for retrieving weather forecast data from OpenWeatherMap."""

from __future__ import annotations

from typing import Optional, Dict, Any

import requests

BASE_URL = "http://api.openweathermap.org/data/2.5/forecast"


class DataAgent:
    """Agent responsible for fetching weather data from the OpenWeatherMap API."""

    def __init__(self, api_key: str) -> None:
        """Initialize the data agent with the required API key.

        Args:
            api_key: OpenWeatherMap API key used for authentication.
        """
        self.api_key = api_key

    def fetch_forecast(self, city_name: str) -> Optional[Dict[str, Any]]:
        """Fetch the weather forecast for the given city.

        Args:
            city_name: Name of the city to retrieve the forecast for.

        Returns:
            The raw forecast data as a dictionary if the request is successful,
            otherwise ``None``.
        """
        params = {
            "q": city_name,
            "appid": self.api_key,
            "units": "metric",
            "lang": "vi",
        }

        try:
            response = requests.get(BASE_URL, params=params, timeout=10)
            response.raise_for_status()
        except requests.RequestException:
            return None

        try:
            return response.json()
        except ValueError:
            return None
