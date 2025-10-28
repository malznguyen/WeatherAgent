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
const aiToggle = document.getElementById("ai-toggle");
const aiClose = document.getElementById("ai-close");
const aiContent = document.getElementById("ai-content");
const aiInput = document.getElementById("ai-input");
const aiChatForm = document.getElementById("ai-chat-form");
const btnAsk = document.getElementById("btn-ask");

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
    insights: { loading: false, lastLoaded: 0, visible: false, dirty: true },
    alerts: { loading: false, lastLoaded: 0, visible: false, dirty: true },
  },
  dock: {
    open: false,
    dragging: false,
    offset: { x: 0, y: 0 },
    position: null,
  },
  aiLoading: false,
};

function init() {
  initMap();
  bindEvents();
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
    aiClose.addEventListener("click", () => closeAiDock());
  }

  if (aiChatForm) {
    aiChatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      doAsk();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.dock.open) {
      closeAiDock();
      aiToggle?.focus();
    }
  });

  if (aiDockHandle) {
    aiDockHandle.addEventListener("pointerdown", startDockDrag);
  }
  document.addEventListener("pointermove", onDockDrag);
  document.addEventListener("pointerup", endDockDrag);
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
  if (!aiDock) return;
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
  try {
    aiDockHandle.setPointerCapture(event.pointerId);
  } catch (err) {
    // Ignore capture errors (e.g. unsupported browsers)
  }
}

function onDockDrag(event) {
  if (!state.dock.dragging || !aiDock) return;
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
    aiDockHandle.releasePointerCapture(event.pointerId);
  } catch (err) {
    // Ignore
  }
}

function toggleAiDock() {
  if (state.dock.open) {
    closeAiDock();
  } else {
    openAiDock();
  }
}

function openAiDock() {
  if (!aiDock) return;
  state.dock.open = true;
  aiDock.classList.add("open");
  aiDock.setAttribute("aria-hidden", "false");
  aiToggle?.classList.add("hidden");
  if (state.dock.position) {
    aiDock.style.left = `${state.dock.position.x}px`;
    aiDock.style.top = `${state.dock.position.y}px`;
    aiDock.style.right = "auto";
    aiDock.style.bottom = "auto";
  } else {
    aiDock.style.left = "";
    aiDock.style.top = "";
    aiDock.style.right = "1.5rem";
    aiDock.style.bottom = "1.5rem";
  }
  if (aiInput && !aiInput.disabled) {
    aiInput.focus();
  }
}

function closeAiDock() {
  if (!aiDock) return;
  state.dock.open = false;
  aiDock.classList.remove("open");
  aiDock.setAttribute("aria-hidden", "true");
  aiToggle?.classList.remove("hidden");
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
      searchBtn.textContent = "Loading…";
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
    showToast("Chọn vị trí trước đã");
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

  try {
    const params = new URLSearchParams({ lat: coords.lat.toString(), lon: coords.lon.toString() });
    const data = await callJSON(`${API_BASE}/ai/insights?${params.toString()}`);
    state.ai.insights.lastLoaded = Date.now();
    state.ai.insights.dirty = false;
    renderInsightsCard(data);
  } catch (error) {
    state.ai.insights.dirty = true;
    renderAiCardError(aiInsightsBody, extractAiErrorMessage(error), error?.details);
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

  try {
    const params = new URLSearchParams({ lat: coords.lat.toString(), lon: coords.lon.toString() });
    const data = await callJSON(`${API_BASE}/ai/alerts?${params.toString()}`);
    state.ai.alerts.lastLoaded = Date.now();
    state.ai.alerts.dirty = false;
    renderAlertsCard(data);
  } catch (error) {
    state.ai.alerts.dirty = true;
    renderAiCardError(aiAlertsBody, extractAiErrorMessage(error), error?.details);
    handleCardError(error);
  } finally {
    state.ai.alerts.loading = false;
    setCardLoading(aiAlertsBody, false);
  }
}

function renderInsightsCard(result) {
  aiInsightsBody.innerHTML = "";
  const summary = (result?.summary || "").trim();
  if (summary) {
    summary.split(/\n+/).forEach((paragraph) => {
      const p = document.createElement("p");
      p.textContent = paragraph.trim();
      aiInsightsBody.appendChild(p);
    });
  } else {
    aiInsightsBody.appendChild(createPlaceholder("Không có dữ liệu tóm tắt."));
  }

  const meta = buildAiCardMeta(result);
  if (meta) {
    aiInsightsBody.appendChild(meta);
  }
}

function renderAlertsCard(result) {
  aiAlertsBody.innerHTML = "";
  const analysis = result?.analysis;
  if (!analysis) {
    aiAlertsBody.appendChild(createPlaceholder("Không có cảnh báo nào."));
    return;
  }

  const header = document.createElement("div");
  header.className = "ai-alert-header";

  const headline = document.createElement("strong");
  headline.textContent = analysis.headline || "Cảnh báo thời tiết";
  header.appendChild(headline);

  const severityEl = document.createElement("span");
  severityEl.className = "ai-alert-severity";
  const severity = typeof analysis.severity === "string" ? analysis.severity : "unknown";
  severityEl.textContent = `Mức độ: ${severity.toUpperCase()}`;
  header.appendChild(severityEl);

  aiAlertsBody.appendChild(header);

  if (Array.isArray(analysis.risks) && analysis.risks.length) {
    const risksTitle = document.createElement("strong");
    risksTitle.textContent = "Rủi ro";
    aiAlertsBody.appendChild(risksTitle);

    const riskList = document.createElement("ul");
    riskList.className = "ai-alert-list";
    analysis.risks.forEach((risk) => {
      const li = document.createElement("li");
      const type = String(risk.type || "").toUpperCase();
      const level = risk.level != null ? ` • cấp ${risk.level}` : "";
      const why = risk.why ? `: ${risk.why}` : "";
      li.textContent = `${type}${level}${why}`.trim();
      riskList.appendChild(li);
    });
    aiAlertsBody.appendChild(riskList);
  }

  if (Array.isArray(analysis.advice) && analysis.advice.length) {
    const adviceTitle = document.createElement("strong");
    adviceTitle.textContent = "Lời khuyên";
    aiAlertsBody.appendChild(adviceTitle);

    const adviceList = document.createElement("ul");
    adviceList.className = "ai-alert-list";
    analysis.advice.forEach((tip) => {
      const li = document.createElement("li");
      li.textContent = tip;
      adviceList.appendChild(li);
    });
    aiAlertsBody.appendChild(adviceList);
  }

  const meta = buildAiCardMeta(result);
  if (meta) {
    aiAlertsBody.appendChild(meta);
  }
}

function buildAiCardMeta(data) {
  const parts = metaPartsFromSource(data);
  if (!parts.length) {
    return null;
  }
  const meta = document.createElement("div");
  meta.className = "ai-card-meta";
  meta.textContent = parts.join(" • ");
  return meta;
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
    body.appendChild(createPlaceholder("Loading…"));
  }
}

function renderAiCardError(body, message, details) {
  if (!body) return;
  body.innerHTML = "";
  body.appendChild(createPlaceholder(message || "Không thể tải dữ liệu AI."));
  const meta = buildAiCardMeta(details);
  if (meta) {
    body.appendChild(meta);
  }
}

function extractAiErrorMessage(error) {
  if (!error) return "Không thể tải dữ liệu AI.";
  if (typeof error === "string") return error;
  if (error.details?.hint) return error.details.hint;
  if (error.details?.detail) return error.details.detail;
  if (error.details?.error === "OPENAI_DISABLED") {
    return "AI Weather Agent chưa được bật.";
  }
  if (error.message) return error.message;
  return "Không thể tải dữ liệu AI.";
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
    openAiDock();
  }
  if (state.aiLoading) return;
  const coords = requireLatLon();
  if (!coords) return;

  const question = (aiInput?.value || "").trim();
  if (!question) {
    showToast("Hãy nhập câu hỏi cho AI");
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
  const questionText = question ? `Câu hỏi: ${question}` : "";
  const answer = result?.answer || "Không có câu trả lời";
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
