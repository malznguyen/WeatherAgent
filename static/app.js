const API_BASE = "/api";
const DEFAULT_COORDS = { lat: 21.0278, lon: 105.8342 };
const HOURLY_LIMIT = 12;
const DAILY_LIMIT = 7;

const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const locationBtn = document.getElementById("location-btn");
const locationLabel = document.getElementById("location-label");
const toastEl = document.getElementById("toast");

const currentTempEl = document.getElementById("current-temp");
const currentDescEl = document.getElementById("current-description");
const currentFeelsEl = document.getElementById("current-feels");
const currentWindEl = document.getElementById("current-wind");
const currentHumidityEl = document.getElementById("current-humidity");
const currentUviEl = document.getElementById("current-uvi");
const currentIconEl = document.getElementById("current-icon");
const hourlyContainer = document.getElementById("hourly-forecast");
const dailyTableBody = document.querySelector("#daily-forecast tbody");

let map;
let marker;

function initMap() {
  map = L.map("map").setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lon], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  }).addTo(map);

  marker = L.marker([DEFAULT_COORDS.lat, DEFAULT_COORDS.lon]).addTo(map);
  map.on("click", (event) => {
    const { lat, lng } = event.latlng;
    fetchWeather(lat, lng, { label: formatCoordinateLabel(lat, lng) });
  });

  // Initial weather fetch for default location
  fetchWeather(DEFAULT_COORDS.lat, DEFAULT_COORDS.lon, { label: "Hanoi, VN" });
}

function setLoading(isLoading) {
  document.body.classList.toggle("loading", isLoading);
  searchBtn.disabled = isLoading;
  locationBtn.disabled = isLoading;
  if (isLoading) {
    searchBtn.dataset.label = searchBtn.textContent;
    searchBtn.textContent = "Loading…";
  } else if (searchBtn.dataset.label) {
    searchBtn.textContent = searchBtn.dataset.label;
    delete searchBtn.dataset.label;
  }
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  setTimeout(() => toastEl.classList.remove("visible"), 3500);
}

function handleError(error, fallbackMessage = "Something went wrong") {
  console.error(error);
  const message = typeof error === "string" ? error : error?.message || fallbackMessage;
  showToast(message);
}

async function fetchJson(url, description) {
  setLoading(true);
  try {
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) {
      const errorBody = await safeJson(response);
      const detail = errorBody?.message || errorBody?.error || response.statusText || description;
      throw new Error(detail);
    }
    return await response.json();
  } finally {
    setLoading(false);
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

async function searchLocation() {
  const query = (searchInput?.value || "").trim();
  if (!query) {
    showToast("Please enter a city or address");
    return;
  }

  try {
    const data = await fetchJson(`${API_BASE}/geocode?query=${encodeURIComponent(query)}`, "Failed to fetch location");
    if (!data) {
      showToast("Location not found");
      return;
    }
    const { lat, lon, name } = data;
    updateMap(lat, lon);
    fetchWeather(lat, lon, { label: name || query });
  } catch (error) {
    handleError(error, "Unable to locate that place");
  }
}

async function fetchWeather(lat, lon, options = {}) {
  if (lat == null || lon == null) {
    showToast("Invalid coordinates");
    return;
  }

  const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString() });
  const label = options.label || formatCoordinateLabel(lat, lon);

  try {
    const data = await fetchJson(`${API_BASE}/weather?${params.toString()}`, "Failed to fetch weather");
    if (!data || !data.location) {
      throw new Error("Invalid weather response");
    }
    updateMap(data.location.lat, data.location.lon);
    updateLocationLabel(label, data.location);
    renderCurrent(data.current);
    renderHourly(data.hourly || []);
    renderDaily(data.daily || []);
  } catch (error) {
    handleError(error, "Unable to fetch weather data");
  }
}

function updateMap(lat, lon) {
  if (!map) return;
  map.setView([lat, lon], map.getZoom());
  if (marker) {
    marker.setLatLng([lat, lon]);
  } else {
    marker = L.marker([lat, lon]).addTo(map);
  }
}

function updateLocationLabel(label, location = {}) {
  if (!locationLabel) return;
  const lat = typeof location.lat === "number" ? location.lat.toFixed(2) : "—";
  const lon = typeof location.lon === "number" ? location.lon.toFixed(2) : "—";
  const coords = `(${lat}, ${lon})`;
  locationLabel.textContent = `${label} ${coords}`.trim();
}

function renderCurrent(current) {
  if (!current) {
    currentTempEl.textContent = "—";
    currentDescEl.textContent = "No data";
    return;
  }

  const { temp, feels_like, weather, wind_speed, humidity, uvi } = current;
  currentTempEl.textContent = temp != null ? `${Math.round(temp)}°C` : "—";
  currentFeelsEl.textContent = feels_like != null ? `${Math.round(feels_like)}°C` : "—";
  currentWindEl.textContent = wind_speed != null ? `${Math.round(wind_speed)} m/s` : "—";
  currentHumidityEl.textContent = humidity != null ? `${Math.round(humidity)}%` : "—";
  currentUviEl.textContent = uvi != null ? `${Math.round(uvi)}` : "—";

  if (weather && weather.description) {
    currentDescEl.textContent = capitalize(weather.description);
  } else if (weather && weather.main) {
    currentDescEl.textContent = weather.main;
  } else {
    currentDescEl.textContent = "—";
  }

  if (weather && weather.icon) {
    currentIconEl.src = `https://openweathermap.org/img/wn/${weather.icon}@2x.png`;
    currentIconEl.alt = weather.description || weather.main || "Weather icon";
    currentIconEl.classList.add("visible");
  } else {
    currentIconEl.removeAttribute("src");
    currentIconEl.alt = "";
    currentIconEl.classList.remove("visible");
  }
}

function renderHourly(hourly) {
  if (!hourlyContainer) return;
  hourlyContainer.innerHTML = "";
  if (!hourly || hourly.length === 0) {
    hourlyContainer.textContent = "No hourly data";
    return;
  }

  hourly.slice(0, HOURLY_LIMIT).forEach((entry) => {
    const item = document.createElement("div");
    item.className = "hourly-item";

    const timeEl = document.createElement("div");
    timeEl.className = "hourly-time";
    timeEl.textContent = formatHour(entry.dt);

    const iconEl = document.createElement("img");
    iconEl.className = "hourly-icon";
    if (entry.weather?.icon) {
      iconEl.src = `https://openweathermap.org/img/wn/${entry.weather.icon}.png`;
      iconEl.alt = entry.weather.description || entry.weather.main || "Hourly icon";
    }

    const tempEl = document.createElement("div");
    tempEl.className = "hourly-temp";
    tempEl.textContent = formatTemp(entry.temp);

    const popEl = document.createElement("div");
    popEl.className = "hourly-pop";
    popEl.textContent = formatPercent(entry.pop);

    item.append(timeEl, iconEl, tempEl, popEl);
    hourlyContainer.appendChild(item);
  });
}

function renderDaily(daily) {
  if (!dailyTableBody) return;
  dailyTableBody.innerHTML = "";
  if (!daily || daily.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No daily data";
    row.appendChild(cell);
    dailyTableBody.appendChild(row);
    return;
  }

  daily.slice(0, DAILY_LIMIT).forEach((entry) => {
    const row = document.createElement("tr");

    const dayCell = document.createElement("td");
    dayCell.textContent = formatDay(entry.dt);

    const condCell = document.createElement("td");
    condCell.textContent = entry.weather?.description
      ? capitalize(entry.weather.description)
      : entry.weather?.main || "—";

    const minCell = document.createElement("td");
    minCell.textContent = formatTemp(entry.temp?.min);

    const maxCell = document.createElement("td");
    maxCell.textContent = formatTemp(entry.temp?.max);

    const popCell = document.createElement("td");
    popCell.textContent = formatPercent(entry.pop);

    const windCell = document.createElement("td");
    windCell.textContent = entry.wind_speed != null ? `${Math.round(entry.wind_speed)} m/s` : "—";

    row.append(dayCell, condCell, minCell, maxCell, popCell, windCell);
    dailyTableBody.appendChild(row);
  });
}

function formatTemp(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value)}°C`;
}

function formatPercent(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  const pct = Math.round(value * 100);
  return `${pct}%`;
}

function formatHour(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDay(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString([], { weekday: "short" });
}

function capitalize(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCoordinateLabel(lat, lon) {
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

function bindEvents() {
  if (searchBtn) {
    searchBtn.addEventListener("click", () => searchLocation());
  }

  if (searchInput) {
    searchInput.addEventListener("keyup", (event) => {
      if (event.key === "Enter") {
        searchLocation();
      }
    });
  }

  if (locationBtn) {
    locationBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        showToast("Geolocation is not supported by your browser");
        return;
      }

      setLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLoading(false);
          const { latitude, longitude } = position.coords;
          updateMap(latitude, longitude);
          fetchWeather(latitude, longitude, { label: "My location" });
        },
        (error) => {
          setLoading(false);
          switch (error.code) {
            case error.PERMISSION_DENIED:
              showToast("Location access denied");
              break;
            case error.POSITION_UNAVAILABLE:
              showToast("Location information unavailable");
              break;
            case error.TIMEOUT:
              showToast("Location request timed out");
              break;
            default:
              showToast("Unable to fetch your location");
          }
        }
      );
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  bindEvents();
});
