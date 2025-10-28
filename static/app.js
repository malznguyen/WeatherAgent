const API_BASE = "/api";
const DEFAULT_COORDS = { lat: 21.0278, lon: 105.8342 };
const HOURLY_LIMIT = 12;
const DAILY_LIMIT = 7;
const AI_COOLDOWN_MS = 8000;

const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const locationBtn = document.getElementById("location-btn");
const locationLabel = document.getElementById("location-label");
const toastEl = document.getElementById("toast");

const aiInsightsCard = document.getElementById("ai-insights-card");
const aiAlertsCard = document.getElementById("ai-alerts-card");
const aiInsightsBody = document.getElementById("ai-insights-body");
const aiAlertsBody = document.getElementById("ai-alerts-body");
const refreshInsightsBtn = document.getElementById("refresh-insights");
const refreshAlertsBtn = document.getElementById("refresh-alerts");

const aiDock = document.getElementById("ai-dock");
const aiDockHandle = document.getElementById("ai-dock-handle");
const aiResizer = document.getElementById("ai-resizer");
const aiBackdrop = document.getElementById("ai-backdrop");
const aiToggle = document.getElementById("ai-toggle");
const aiClose = document.getElementById("ai-close");
const aiDockTabs = document.querySelectorAll("[data-ai-tab]");
const aiDockPanels = document.querySelectorAll(".ai-dock-panel");
const aiDockInsights = document.getElementById("ai-dock-insights");
const aiDockAlerts = document.getElementById("ai-dock-alerts");
const aiContent = document.getElementById("ai-content");
const aiInput = document.getElementById("ai-input");
const aiChatForm = document.getElementById("ai-chat-form");
const btnAsk = document.getElementById("btn-ask");
const openInsightsDockBtn = document.getElementById("open-insights-dock");
const openAlertsDockBtn = document.getElementById("open-alerts-dock");

const DOCK_TABS = new Set(["insights", "alerts", "chat"]);

const currentTempEl = document.getElementById("current-temp");
const currentDescEl = document.getElementById("current-description");
const currentFeelsEl = document.getElementById("current-feels");
const currentWindEl = document.getElementById("current-wind");
const currentHumidityEl = document.getElementById("current-humidity");
const currentUviEl = document.getElementById("current-uvi");
const currentIconEl = document.getElementById("current-icon");
const hourlyContainer = document.getElementById("hourly-forecast");
const dailyTableBody = document.querySelector("#daily-forecast tbody");

const state = {
  map: null,
  marker: null,
  lastLatLon: null,
  loading: false,
  ai: {
    insights: { loading: false, lastLoaded: 0, visible: false, dirty: true, data: null },
    alerts: { loading: false, lastLoaded: 0, visible: false, dirty: true, data: null },
  },
  dock: {
    open: false,
    dragging: false,
    resizing: false,
    offset: { x: 0, y: 0 },
    position: null,
    size: null,
    resizeStart: null,
    activeTab: "chat",
  },
  aiLoading: false,
};

function init() {
  initMap();
  bindEvents();
  setDockTab(state.dock.activeTab);
  handleDockResize();
  setupObservers();
  setLastLatLon(DEFAULT_COORDS.lat, DEFAULT_COORDS.lon);
  fetchWeather(DEFAULT_COORDS.lat, DEFAULT_COORDS.lon, { label: "Hanoi, VN" });
}

function initMap() {
  state.map = L.map("map").setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lon], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  }).addTo(state.map);

  state.marker = L.marker([DEFAULT_COORDS.lat, DEFAULT_COORDS.lon]).addTo(state.map);
  state.map.on("click", (event) => {
    const { lat, lng } = event.latlng;
    setLastLatLon(lat, lng);
    fetchWeather(lat, lng, { label: formatCoordinateLabel(lat, lng) });
  });
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
          setLastLatLon(latitude, longitude);
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

  if (refreshInsightsBtn) {
    refreshInsightsBtn.addEventListener("click", () => loadInsights({ force: true, allowHidden: true }));
  }

  if (refreshAlertsBtn) {
    refreshAlertsBtn.addEventListener("click", () => loadAlerts({ force: true, allowHidden: true }));
  }

  if (aiToggle) {
    aiToggle.addEventListener("click", () => toggleAiDock());
  }

  if (aiClose) {
    aiClose.addEventListener("pointerdown", (event) => event.stopPropagation());
    aiClose.addEventListener("click", () => closeAiDock({ focusToggle: true }));
  }

  if (aiBackdrop) {
    aiBackdrop.addEventListener("click", () => closeAiDock({ focusToggle: true }));
  }

  if (openInsightsDockBtn) {
    openInsightsDockBtn.addEventListener("click", () => openAiDock({ tab: "insights" }));
  }

  if (openAlertsDockBtn) {
    openAlertsDockBtn.addEventListener("click", () => openAiDock({ tab: "alerts" }));
  }

  if (aiChatForm) {
    aiChatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      doAsk();
    });
  }

  aiDockTabs.forEach((tabButton) => {
    tabButton.addEventListener("click", () => {
      const tabName = tabButton.dataset.aiTab;
      setDockTab(tabName);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.dock.open) {
      closeAiDock({ focusToggle: true });
    }
  });

  if (aiDockHandle) {
    aiDockHandle.addEventListener("pointerdown", startDockDrag);
  }
  if (aiResizer) {
    aiResizer.addEventListener("pointerdown", startDockResize);
  }
  document.addEventListener("pointermove", onDockDrag);
  document.addEventListener("pointerup", endDockDrag);
  document.addEventListener("pointercancel", endDockDrag);
  document.addEventListener("pointermove", onDockResize);
  document.addEventListener("pointerup", endDockResize);
  document.addEventListener("pointercancel", endDockResize);
  window.addEventListener("resize", handleDockResize);
}

function setupObservers() {
  if (!("IntersectionObserver" in window)) {
    state.ai.insights.visible = true;
    state.ai.alerts.visible = true;
    loadInsights({ force: true });
    loadAlerts({ force: true });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.target === aiInsightsCard) {
          state.ai.insights.visible = entry.isIntersecting;
          if (entry.isIntersecting && (state.ai.insights.dirty || !state.ai.insights.lastLoaded)) {
            loadInsights({ force: true });
          }
        }
        if (entry.target === aiAlertsCard) {
          state.ai.alerts.visible = entry.isIntersecting;
          if (entry.isIntersecting && (state.ai.alerts.dirty || !state.ai.alerts.lastLoaded)) {
            loadAlerts({ force: true });
          }
        }
      });
    },
    { threshold: 0.25 }
  );

  if (aiInsightsCard) {
    observer.observe(aiInsightsCard);
  }
  if (aiAlertsCard) {
    observer.observe(aiAlertsCard);
  }
}

function startDockDrag(event) {
  if (!aiDock || !isDockDraggable()) return;
  if (state.dock.resizing) return;
  if (typeof event.button === "number" && event.button !== 0) return;
  if (event.target instanceof HTMLElement) {
    if (event.target.closest(".ai-dock-resizer")) {
      return;
    }
    if (event.target.closest("button")) {
      return;
    }
  }

  state.dock.dragging = true;
  const rect = aiDock.getBoundingClientRect();
  state.dock.offset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  aiDock.classList.add("dragging");
  aiDock.style.right = "auto";
  aiDock.style.bottom = "auto";
  state.dock.position = { x: rect.left, y: rect.top };
  if (typeof event.preventDefault === "function") {
    event.preventDefault();
  }
  try {
    aiDockHandle?.setPointerCapture(event.pointerId);
  } catch (err) {
    // Ignore capture errors (e.g. unsupported browsers)
  }
}

function onDockDrag(event) {
  if (state.dock.resizing) return;
  if (!state.dock.dragging || !aiDock || !isDockDraggable()) return;
  const width = aiDock.offsetWidth;
  const height = aiDock.offsetHeight;
  let x = event.clientX - state.dock.offset.x;
  let y = event.clientY - state.dock.offset.y;
  x = Math.max(12, Math.min(x, window.innerWidth - width - 12));
  y = Math.max(12, Math.min(y, window.innerHeight - height - 12));
  aiDock.style.left = `${x}px`;
  aiDock.style.top = `${y}px`;
  state.dock.position = { x, y };
}

function endDockDrag(event) {
  if (!state.dock.dragging || !aiDock) return;
  state.dock.dragging = false;
  aiDock.classList.remove("dragging");
  try {
    aiDockHandle?.releasePointerCapture(event.pointerId);
  } catch (err) {
    // Ignore
  }
}

function startDockResize(event) {
  if (!aiDock || !isDockDraggable()) return;
  if (state.dock.dragging) return;
  if (typeof event.button === "number" && event.button !== 0) return;

  const rect = aiDock.getBoundingClientRect();
  state.dock.resizing = true;
  state.dock.resizeStart = {
    pointerId: event.pointerId,
    width: rect.width,
    height: rect.height,
    x: event.clientX,
    y: event.clientY,
  };
  aiDock.classList.add("resizing");
  event.preventDefault?.();
  try {
    aiResizer?.setPointerCapture(event.pointerId);
  } catch (err) {
    // Ignore capture errors
  }
}

function onDockResize(event) {
  if (!state.dock.resizing || !aiDock || !isDockDraggable()) return;
  const start = state.dock.resizeStart;
  if (!start) return;

  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;

  const minWidth = 360;
  const minHeight = 280;
  const maxWidth = Math.min(window.innerWidth - 24, 720);
  const maxHeight = Math.min(window.innerHeight - 24, 720);

  let width = start.width + deltaX;
  let height = start.height + deltaY;

  width = Math.max(minWidth, Math.min(width, maxWidth));
  height = Math.max(minHeight, Math.min(height, maxHeight));

  aiDock.style.width = `${width}px`;
  aiDock.style.height = `${height}px`;
  state.dock.size = { width, height };
}

function endDockResize(event) {
  if (!state.dock.resizing || !aiDock) return;
  state.dock.resizing = false;
  state.dock.resizeStart = null;
  aiDock.classList.remove("resizing");
  try {
    aiResizer?.releasePointerCapture(event.pointerId);
  } catch (err) {
    // Ignore
  }
}

function isDockDraggable() {
  return window.matchMedia("(min-width: 768px)").matches;
}

function resetDockPosition() {
  if (!aiDock) return;
  aiDock.style.left = "";
  aiDock.style.top = "";
  aiDock.style.right = "";
  aiDock.style.bottom = "";
}

function resetDockSize({ preserveState = true } = {}) {
  if (!aiDock) return;
  aiDock.style.width = "";
  aiDock.style.height = "";
  if (!preserveState) {
    state.dock.size = null;
  }
}

function applyStoredDockPosition() {
  if (!aiDock) return;
  if (isDockDraggable() && state.dock.position) {
    aiDock.style.left = `${state.dock.position.x}px`;
    aiDock.style.top = `${state.dock.position.y}px`;
    aiDock.style.right = "auto";
    aiDock.style.bottom = "auto";
  } else {
    resetDockPosition();
  }
}

function applyStoredDockSize() {
  if (!aiDock) return;
  if (isDockDraggable() && state.dock.size) {
    aiDock.style.width = `${state.dock.size.width}px`;
    aiDock.style.height = `${state.dock.size.height}px`;
  } else if (!state.dock.resizing) {
    resetDockSize();
  }
}

function handleDockResize() {
  if (!aiDock) return;
  if (!isDockDraggable()) {
    state.dock.dragging = false;
    state.dock.resizing = false;
    state.dock.resizeStart = null;
    aiDock.classList.remove("dragging", "resizing");
    resetDockPosition();
    resetDockSize();
  } else {
    applyStoredDockPosition();
    applyStoredDockSize();
  }
}

function toggleDockTabDataState(tabName, hasData) {
  aiDockTabs.forEach((button) => {
    if (button.dataset.aiTab === tabName) {
      button.classList.toggle("has-data", Boolean(hasData));
    }
  });
}

function setDockTab(tabName) {
  const target = DOCK_TABS.has(tabName) ? tabName : "chat";
  state.dock.activeTab = target;
  aiDockTabs.forEach((button) => {
    const isActive = button.dataset.aiTab === target;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.setAttribute("tabindex", isActive ? "0" : "-1");
  });
  aiDockPanels.forEach((panel) => {
    const matches = panel.dataset.aiPanel === target;
    panel.classList.toggle("active", matches);
    panel.setAttribute("aria-hidden", String(!matches));
  });
  if (state.dock.open && target === "chat" && aiInput && !aiInput.disabled) {
    setTimeout(() => aiInput?.focus(), 0);
  }
}

function toggleAiDock(tabName) {
  if (state.dock.open) {
    closeAiDock({ focusToggle: true });
  } else {
    openAiDock({ tab: tabName });
  }
}

function openAiDock(options = {}) {
  if (!aiDock) return;
  const tab = options.tab || state.dock.activeTab;
  setDockTab(tab);
  state.dock.open = true;
  aiDock.classList.add("open");
  aiDock.setAttribute("aria-hidden", "false");
  aiToggle?.classList.add("hidden");
  aiBackdrop?.classList.add("open");
  aiBackdrop?.setAttribute("aria-hidden", "false");
  applyStoredDockPosition();
  applyStoredDockSize();
  if (tab === "chat" && aiInput && !aiInput.disabled) {
    aiInput.focus();
  }
}

function closeAiDock(options = {}) {
  if (!aiDock) return;
  const { focusToggle = false } = options;
  state.dock.open = false;
  state.dock.dragging = false;
  state.dock.resizing = false;
  state.dock.resizeStart = null;
  aiDock.classList.remove("open", "dragging");
  aiDock.classList.remove("resizing");
  aiDock.setAttribute("aria-hidden", "true");
  aiToggle?.classList.remove("hidden");
  aiBackdrop?.classList.remove("open");
  aiBackdrop?.setAttribute("aria-hidden", "true");
  if (focusToggle) {
    aiToggle?.focus();
  }
}

function setLastLatLon(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return;
  const prev = state.lastLatLon;
  const changed = !prev || prev.lat !== lat || prev.lon !== lon;
  state.lastLatLon = { lat, lon };
  if (changed) {
    state.ai.insights.dirty = true;
    state.ai.alerts.dirty = true;
    state.ai.insights.lastLoaded = 0;
    state.ai.alerts.lastLoaded = 0;
    if (state.ai.insights.visible) {
      loadInsights({ force: true });
    }
    if (state.ai.alerts.visible) {
      loadAlerts({ force: true });
    }
  }
}

function updateMap(lat, lon) {
  if (!state.map) return;
  state.map.setView([lat, lon], state.map.getZoom());
  if (state.marker) {
    state.marker.setLatLng([lat, lon]);
  } else {
    state.marker = L.marker([lat, lon]).addTo(state.map);
  }
}

function searchLocation() {
  const query = (searchInput?.value || "").trim();
  if (!query) {
    showToast("Please enter a city or address");
    return;
  }

  setLoading(true);
  fetchJson(`${API_BASE}/geocode?query=${encodeURIComponent(query)}`, "Failed to fetch location")
    .then((data) => {
      if (!data) {
        showToast("Location not found");
        return;
      }
      const { lat, lon, name } = data;
      setLastLatLon(lat, lon);
      updateMap(lat, lon);
      fetchWeather(lat, lon, { label: name || query });
    })
    .catch((error) => {
      handleError(error, "Unable to locate that place");
    });
}

async function fetchWeather(lat, lon, options = {}) {
  if (lat == null || lon == null) {
    showToast("Invalid coordinates");
    return;
  }

  const params = new URLSearchParams({ lat: lat.toString(), lon: lon.toString() });
  const label = options.label || formatCoordinateLabel(lat, lon);

  try {
    setLoading(true);
    const data = await fetchJson(`${API_BASE}/weather?${params.toString()}`, "Failed to fetch weather");
    if (!data || !data.location) {
      throw new Error("Invalid weather response");
    }
    updateMap(data.location.lat, data.location.lon);
    updateLocationLabel(label, data.location);
    renderCurrent(data.current);
    renderHourly(data.hourly || []);
    renderDaily(data.daily || []);
    if (typeof data.location?.lat === "number" && typeof data.location?.lon === "number") {
      setLastLatLon(data.location.lat, data.location.lon);
    }
  } catch (error) {
    handleError(error, "Unable to fetch weather data");
  } finally {
    setLoading(false);
  }
}

function updateLocationLabel(label, location = {}) {
  if (!locationLabel) return;
  const lat = typeof location.lat === "number" ? location.lat.toFixed(2) : "—";
  const lon = typeof location.lon === "number" ? location.lon.toFixed(2) : "—";
  locationLabel.textContent = `${label} (${lat}, ${lon})`;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  document.body.classList.toggle("loading", isLoading);
  if (searchBtn) {
    searchBtn.disabled = isLoading;
    if (isLoading) {
      searchBtn.dataset.label = searchBtn.textContent;
      searchBtn.textContent = "Loading...";
    } else if (searchBtn.dataset.label) {
      searchBtn.textContent = searchBtn.dataset.label;
      delete searchBtn.dataset.label;
    }
  }
  if (locationBtn) {
    locationBtn.disabled = isLoading;
  }
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

function requireLatLon() {
  if (!state.lastLatLon) {
    showToast("Choose a location first.");
    return null;
  }
  return { ...state.lastLatLon };
}

async function loadInsights(options = {}) {
  if (!aiInsightsBody) return;
  const coords = requireLatLon();
  if (!coords) return;

  if (!options.allowHidden && !state.ai.insights.visible) {
    state.ai.insights.dirty = true;
    return;
  }

  if (state.ai.insights.loading) return;
  const now = Date.now();
  if (!options.force && now - state.ai.insights.lastLoaded < AI_COOLDOWN_MS) {
    return;
  }

  state.ai.insights.loading = true;
  setCardLoading(aiInsightsBody, true);
  renderDockInsights(null, { loading: true });

  try {
    const params = new URLSearchParams({ lat: coords.lat.toString(), lon: coords.lon.toString() });
    const data = await callJSON(`${API_BASE}/ai/insights?${params.toString()}`);
    state.ai.insights.lastLoaded = Date.now();
    state.ai.insights.dirty = false;
    renderInsightsCard(data);
  } catch (error) {
    state.ai.insights.dirty = true;
    state.ai.insights.data = null;
    const message = extractAiErrorMessage(error);
    renderAiCardError(aiInsightsBody, message, error?.details);
    renderDockInsights(null, { message, meta: error?.details });
    handleCardError(error);
  } finally {
    state.ai.insights.loading = false;
    setCardLoading(aiInsightsBody, false);
  }
}

async function loadAlerts(options = {}) {
  if (!aiAlertsBody) return;
  const coords = requireLatLon();
  if (!coords) return;

  if (!options.allowHidden && !state.ai.alerts.visible) {
    state.ai.alerts.dirty = true;
    return;
  }

  if (state.ai.alerts.loading) return;
  const now = Date.now();
  if (!options.force && now - state.ai.alerts.lastLoaded < AI_COOLDOWN_MS) {
    return;
  }

  state.ai.alerts.loading = true;
  setCardLoading(aiAlertsBody, true);
  renderDockAlerts(null, { loading: true });

  try {
    const params = new URLSearchParams({ lat: coords.lat.toString(), lon: coords.lon.toString() });
    const data = await callJSON(`${API_BASE}/ai/alerts?${params.toString()}`);
    state.ai.alerts.lastLoaded = Date.now();
    state.ai.alerts.dirty = false;
    renderAlertsCard(data);
  } catch (error) {
    state.ai.alerts.dirty = true;
    state.ai.alerts.data = null;
    const message = extractAiErrorMessage(error);
    renderAiCardError(aiAlertsBody, message, error?.details);
    renderDockAlerts(null, { message, meta: error?.details });
    handleCardError(error);
  } finally {
    state.ai.alerts.loading = false;
    setCardLoading(aiAlertsBody, false);
  }
}

function populateInsightsTarget(target, result, { metaClass, emptyMessage } = {}) {
  if (!target) return;
  target.innerHTML = "";
  const summary = typeof result?.summary === "string" ? result.summary.trim() : "";
  if (summary) {
    summary.split(/\n+/).forEach((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return;
      const p = document.createElement("p");
      p.textContent = trimmed;
      target.appendChild(p);
    });
  } else {
    target.appendChild(createPlaceholder(emptyMessage || "No AI summary available yet."));
  }
  const meta = createMetaElement(result);
  if (meta) {
    if (metaClass) {
      meta.classList.add(metaClass);
    }
    target.appendChild(meta);
  }
}

function renderInsightsCard(result) {
  state.ai.insights.data = result || null;
  populateInsightsTarget(aiInsightsBody, result, {
    metaClass: "ai-card-meta",
    emptyMessage: "No AI summary available yet.",
  });
  renderDockInsights(result);
}

function renderDockInsights(result, options = {}) {
  if (!aiDockInsights) return;
  const { loading = false, message = null, meta = null } = options;
  aiDockInsights.innerHTML = "";
  if (loading) {
    body.appendChild(createPlaceholder("Loading..."));
    toggleDockTabDataState("insights", false);
    return;
  }
  if (!result) {
    aiDockInsights.appendChild(
      createPlaceholder(message || "Select a location to load AI insights.")
    );
    const metaEl = createMetaElement(meta);
    if (metaEl) {
      metaEl.classList.add("ai-dock-meta");
      aiDockInsights.appendChild(metaEl);
    }
    toggleDockTabDataState("insights", false);
    return;
  }
  populateInsightsTarget(aiDockInsights, result, {
    metaClass: "ai-dock-meta",
    emptyMessage: message || "No AI summary available yet.",
  });
  const hasSummary = typeof result.summary === "string" && result.summary.trim().length > 0;
  toggleDockTabDataState("insights", hasSummary);
}

function populateAlertsTarget(target, result, { metaClass, emptyMessage } = {}) {
  if (!target) return;
  target.innerHTML = "";
  const analysis = result?.analysis && typeof result.analysis === "object" ? result.analysis : null;
  if (!analysis) {
    target.appendChild(createPlaceholder(emptyMessage || "No weather alerts right now."));
    const metaEl = createMetaElement(result);
    if (metaEl) {
      if (metaClass) {
        metaEl.classList.add(metaClass);
      }
      target.appendChild(metaEl);
    }
    return;
  }

  const header = document.createElement("div");
  header.className = "ai-alert-header";

  const headline = document.createElement("strong");
  headline.textContent = String(analysis.headline || "Weather alert");
  header.appendChild(headline);

  if (analysis.severity) {
    const severityEl = document.createElement("span");
    severityEl.className = "ai-alert-severity";
    severityEl.textContent = `Severity: ${String(analysis.severity).toUpperCase()}`;
    header.appendChild(severityEl);
  }

  target.appendChild(header);

  if (Array.isArray(analysis.risks) && analysis.risks.length) {
    const risksTitle = document.createElement("strong");
    risksTitle.textContent = "Risks";
    target.appendChild(risksTitle);

    const riskList = document.createElement("ul");
    riskList.className = "ai-alert-list";
    analysis.risks.forEach((risk) => {
      const li = document.createElement("li");
      const type = risk && risk.type ? String(risk.type).toUpperCase() : "RISK";
      const level = Number.isFinite(risk?.level) ? ` - level ${risk.level}` : "";
      const why = risk?.why ? `: ${risk.why}` : "";
      li.textContent = `${type}${level}${why}`.trim();
      riskList.appendChild(li);
    });
    target.appendChild(riskList);
  }

  const adviceItems = Array.isArray(analysis.advice)
    ? analysis.advice
    : analysis.advice
    ? [analysis.advice]
    : [];
  if (adviceItems.length) {
    const adviceTitle = document.createElement("strong");
    adviceTitle.textContent = "Advice";
    target.appendChild(adviceTitle);

    const adviceList = document.createElement("ul");
    adviceList.className = "ai-alert-list";
    adviceItems.forEach((tip) => {
      const text = typeof tip === "string" ? tip.trim() : String(tip || "");
      if (!text) return;
      const li = document.createElement("li");
      li.textContent = text;
      adviceList.appendChild(li);
    });
    target.appendChild(adviceList);
  }

  const metaEl = createMetaElement(result);
  if (metaEl) {
    if (metaClass) {
      metaEl.classList.add(metaClass);
    }
    target.appendChild(metaEl);
  }
}

function renderAlertsCard(result) {
  state.ai.alerts.data = result || null;
  populateAlertsTarget(aiAlertsBody, result, {
    metaClass: "ai-card-meta",
    emptyMessage: "No active AI alerts.",
  });
  renderDockAlerts(result);
}

function renderDockAlerts(result, options = {}) {
  if (!aiDockAlerts) return;
  const { loading = false, message = null, meta = null } = options;
  aiDockAlerts.innerHTML = "";
  if (loading) {
    aiDockAlerts.appendChild(createPlaceholder("Loading..."));
    toggleDockTabDataState("alerts", false);
    return;
  }
  if (!result) {
    aiDockAlerts.appendChild(
      createPlaceholder(message || "Select a location to load AI alerts.")
    );
    const metaEl = createMetaElement(meta);
    if (metaEl) {
      metaEl.classList.add("ai-dock-meta");
      aiDockAlerts.appendChild(metaEl);
    }
    toggleDockTabDataState("alerts", false);
    return;
  }
  populateAlertsTarget(aiDockAlerts, result, {
    metaClass: "ai-dock-meta",
    emptyMessage: message || "No active AI alerts.",
  });
  const analysis = result?.analysis && typeof result.analysis === "object" ? result.analysis : null;
  const hasContent = !!analysis && (
    analysis.headline ||
    (Array.isArray(analysis.advice) && analysis.advice.length > 0) ||
    (Array.isArray(analysis.risks) && analysis.risks.length > 0)
  );
  toggleDockTabDataState("alerts", hasContent);
}

function createPlaceholder(message) {
  const el = document.createElement("p");
  el.className = "placeholder";
  el.textContent = message;
  return el;
}

function setCardLoading(body, isLoading) {
  if (!body) return;
  const card = body.closest(".card");
  if (!card) return;
  card.classList.toggle("loading", isLoading);
  if (isLoading) {
    body.innerHTML = "";
    body.appendChild(createPlaceholder("Loading..."));
  }
}

function renderAiCardError(body, message, details) {
  if (!body) return;
  body.innerHTML = "";
  body.appendChild(createPlaceholder(message || "Unable to load AI data."));
  const meta = createMetaElement(details);
  if (meta) {
    meta.classList.add("ai-card-meta");
    body.appendChild(meta);
  }
}

function extractAiErrorMessage(error) {
  if (!error) return "Unable to load AI data.";
  if (typeof error === "string") return error;
  if (error.details?.hint) return error.details.hint;
  if (error.details?.detail) return error.details.detail;
  if (error.details?.error === "OPENAI_DISABLED") {
    return "AI Weather Agent is disabled.";
  }
  if (error.message) return error.message;
  return "Unable to load AI data.";
}


function handleCardError(error) {
  if (!error) return;
  const message = extractAiErrorMessage(error);
  showToast(message);
  console.error(error);
}

function setAiLoading(isLoading) {
  state.aiLoading = isLoading;
  if (aiDock) {
    aiDock.classList.toggle("loading", isLoading);
  }
  if (aiInput) {
    aiInput.disabled = isLoading;
  }
  if (btnAsk) {
    btnAsk.disabled = isLoading;
  }
}

function appendAiMessage({ title, body, meta, variant = "info" }) {
  if (!aiContent) return null;
  aiContent.querySelectorAll(".ai-hint").forEach((el) => el.remove());
  const block = document.createElement("div");
  block.className = "ai-message";
  if (variant === "error") {
    block.classList.add("error");
  }

  if (title) {
    const heading = document.createElement("h4");
    heading.textContent = title;
    block.appendChild(heading);
  }

  if (typeof body === "string") {
    const bodyEl = document.createElement("div");
    bodyEl.textContent = body;
    block.appendChild(bodyEl);
  } else if (body instanceof HTMLElement) {
    block.appendChild(body);
  }

  const metaEl = createMetaElement(meta);
  if (metaEl) {
    metaEl.classList.add("ai-meta");
    block.appendChild(metaEl);
  }

  aiContent.appendChild(block);
  scrollAiContent();
  return block;
}

function createMetaElement(meta) {
  const parts = metaPartsFromSource(meta);
  if (!parts.length) {
    return null;
  }
  const el = document.createElement("div");
  el.textContent = parts.join(" • ");
  return el;
}

function metaPartsFromSource(source) {
  if (!source || typeof source !== "object") return [];
  const parts = [];
  const model = source.model || source.ai_model;
  if (model) {
    parts.push(model);
  }
  const took =
    typeof source.took_ms === "number"
      ? source.took_ms
      : typeof source.tookMs === "number"
      ? source.tookMs
      : null;
  if (typeof took === "number") {
    parts.push(`${took} ms`);
  }
  const trace = source.trace_id || source.traceId;
  if (trace) {
    parts.push(`trace ${trace}`);
  }
  return parts;
}

function scrollAiContent() {
  if (!aiContent) return;
  requestAnimationFrame(() => {
    aiContent.scrollTop = aiContent.scrollHeight;
  });
}

function pickAiMeta(data) {
  if (!data || typeof data !== "object") return null;
  return {
    model: data.model || data.ai_model || null,
    trace_id: data.trace_id || data.traceId || null,
    took_ms: typeof data.took_ms === "number" ? data.took_ms : data.tookMs,
  };
}

function handleAiError(error) {
  console.error(error);
  const details = error?.details;
  let message = extractAiErrorMessage(error);
  appendAiMessage({
    title: "AI Error",
    body: message,
    meta: pickAiMeta(details),
    variant: "error",
  });
  showToast(message);
}

async function doAsk() {
  if (!state.dock.open) {
    openAiDock({ tab: "chat" });
  } else {
    setDockTab("chat");
  }
  if (state.aiLoading) return;
  const coords = requireLatLon();
  if (!coords) return;

  const question = (aiInput?.value || "").trim();
  if (!question) {
    showToast("Please enter a question for the AI.");
    aiInput?.focus();
    return;
  }

  setAiLoading(true);
  try {
    const data = await callJSON(`${API_BASE}/ai/ask`, {
      method: "POST",
      body: { question, lat: coords.lat, lon: coords.lon },
    });
    renderAiChat(question, data);
    if (aiInput) {
      aiInput.value = "";
    }
  } catch (error) {
    handleAiError(error);
  } finally {
    setAiLoading(false);
  }
}

function renderAiChat(question, result) {
  const questionText = question ? `Question: ${question}` : "";
  const answer = result?.answer || "No response available.";
  const body = questionText ? `${questionText}\n\n${answer}` : answer;
  appendAiMessage({
    title: "Chat",
    body,
    meta: pickAiMeta(result),
  });
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("visible");
  setTimeout(() => toastEl.classList.remove("visible"), 3200);
}

function handleError(error, fallbackMessage = "Something went wrong") {
  console.error(error);
  const message = typeof error === "string" ? error : error?.message || fallbackMessage;
  showToast(message);
}

async function fetchJson(url, description) {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
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

async function callJSON(url, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  const config = { method: options.method || "GET", headers };

  if (options.body !== undefined) {
    if (options.body instanceof FormData || typeof options.body === "string") {
      config.body = options.body;
    } else {
      config.body = JSON.stringify(options.body);
      config.headers["Content-Type"] = "application/json";
    }
  }

  try {
    const response = await fetch(url, config);
    const data = await safeJson(response);
    if (!response.ok) {
      const hint = data?.hint || data?.detail;
      const errorMessage =
        hint || data?.message || data?.error || response.statusText || "Yêu cầu thất bại";
      const error = new Error(errorMessage);
      error.details = data;
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    throw error;
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (err) {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", init);
