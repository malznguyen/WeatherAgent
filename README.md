# Weather Forecast Agent

A refreshed Weather Forecast Agent with a Flask backend and a responsive Leaflet-powered frontend.

## Prerequisites

- Python 3.10+
- OpenWeather API key (required)
- (Optional) OpenAI API key if you plan to extend AI features

## Setup

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env  # then add your API keys
```

Create a `.env` file with at least:

```
OPENWEATHER_API_KEY=your_openweather_key
OPENAI_API_KEY=
```

## Running the app

```bash
flask --app app.py --debug run
```

The frontend is served from `/` and communicates with backend routes under `/api/*`.

## Quick checks

```bash
curl http://127.0.0.1:5000/healthz
curl "http://127.0.0.1:5000/api/geocode?query=Hanoi"
curl "http://127.0.0.1:5000/api/weather?lat=21.0278&lon=105.8342"
```

Then open [http://127.0.0.1:5000/](http://127.0.0.1:5000/) in your browser. Search for a city, click on the map, or use your current location to retrieve weather data.

## Notes

- The backend caches geocoding and weather responses for roughly 90 seconds to reduce upstream calls.
- Upstream API errors are surfaced with descriptive messages and standard HTTP status codes.
- Respect OpenWeather's rate limits—excessive requests may be throttled upstream.
