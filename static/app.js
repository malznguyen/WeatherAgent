const API_BASE = "/api";
const DEFAULT_COORDS = { lat: 21.0278, lon: 105.8342 };
const HOURLY_LIMIT = 12;
const DAILY_LIMIT = 7;

const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const locationBtn = document.getElementById("location-btn");
const locationLabel = document.getElementById("location-label");
const toastEl = document.getElementById("toast");

const aiDock = document.getElementById("ai-dock");
const aiContent = document.getElementById("ai-content");
const aiInput = document.getElementById("ai-input");
const aiToggle = document.getElementById("ai-toggle");
const aiClose = document.getElementById("ai-close");
const aiTabs = Array.from(document.querySelectorAll(".ai-tab"));
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

let map;
let marker;
let lastLatLon = null;
let aiLoading = false;
const aiFetchTracker = { insights: 0, alerts: 0 };
const aiState = { activeTab: "insights", open: false };

function setLastLatLon(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return;
  const prev = lastLatLon;
  const changed = !prev || prev.lat !== lat || prev.lon !== lon;
  lastLatLon = { lat, lon };
  if (changed) {
    aiFetchTracker.insights = 0;
    aiFetchTracker.alerts = 0;
  }
}

function toggleAiDock(targetTab) {
  if (aiState.open) {
    closeAiDock();
  } else {
    openAiDock(targetTab || aiState.activeTab);
  }
}

function openAiDock(targetTab) {
  if (!aiDock) return;
  aiState.open = true;
  aiDock.classList.add("open");
  aiDock.setAttribute("aria-hidden", "false");
  if (aiToggle) {
    aiToggle.classList.add("hidden");
  }
  if (typeof targetTab === "string") {
    selectAiTab(targetTab, { fetch: true });
  } else {
    selectAiTab(aiState.activeTab, { fetch: true });
  }
}

function closeAiDock() {
  if (!aiDock) return;
  aiState.open = false;
  aiDock.classList.remove("open");
  aiDock.setAttribute("aria-hidden", "true");
  if (aiToggle) {
    aiToggle.classList.remove("hidden");
  }
  syncChatAvailability();
}

function selectAiTab(tabName, options = {}) {
  const validTabs = ["insights", "alerts", "chat"];
  const requested = validTabs.includes(tabName) ? tabName : "insights";
  aiState.activeTab = requested;
  aiTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === requested;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  syncChatAvailability();

  if (options.fetch && aiState.open) {
    if (requested === "insights") {
      doInsights({ force: options.force === true });
    } else if (requested === "alerts") {
      doAlerts({ force: options.force === true });
    } else if (requested === "chat" && aiInput) {
      aiInput.focus();
    }
  }
}

function syncChatAvailability() {
  if (!aiChatForm) return;
  const chatActive = aiState.activeTab === "chat" && aiState.open;
  aiChatForm.classList.toggle("chat-disabled", !chatActive);
  aiChatForm.setAttribute("aria-hidden", chatActive ? "false" : "true");
  if (aiInput) {
    aiInput.disabled = aiLoading || !chatActive;
    aiInput.placeholder = chatActive
      ? "Hỏi AI về thời tiết hoặc kế hoạch..."
      : "Chuyển sang tab Chat để đặt câu hỏi";
  }
  if (btnAsk) {
    btnAsk.disabled = aiLoading || !chatActive;
  }
}

function initMap() {
  map = L.map("map").setView([DEFAULT_COORDS.lat, DEFAULT_COORDS.lon], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
  }).addTo(map);

  marker = L.marker([DEFAULT_COORDS.lat, DEFAULT_COORDS.lon]).addTo(map);
  map.on("click", (event) => {
    const { lat, lng } = event.latlng;
    setLastLatLon(lat, lng);
    fetchWeather(lat, lng, { label: formatCoordinateLabel(lat, lng) });
  });

  // Initial weather fetch for default location
  setLastLatLon(DEFAULT_COORDS.lat, DEFAULT_COORDS.lon);
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

function setAiLoading(isLoading) {
  aiLoading = isLoading;
  if (!aiDock) return;
  aiDock.classList.toggle("loading", isLoading);
  syncChatAvailability();
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

  const metaEl = renderAiMeta(meta);
  if (metaEl) {
    block.appendChild(metaEl);
  }

  aiContent.appendChild(block);
  scrollAiContent();
  return block;
}

function renderAiMeta(meta) {
  if (!meta) return null;
  const parts = [];
  if (meta.model) {
    parts.push(meta.model);
  }
  if (typeof meta.took_ms === "number") {
    parts.push(`${meta.took_ms} ms`);
  }
  if (meta.trace_id) {
    parts.push(`trace ${meta.trace_id}`);
  }

  if (!parts.length) {
    return null;
  }

  const el = document.createElement("div");
  el.className = "ai-meta";
  el.textContent = parts.join(" • ");
  return el;
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
      const errorMessage = hint || data?.message || data?.error || response.statusText || "Yêu cầu thất bại";
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

function requireLatLon() {
  if (!lastLatLon) {
    showToast("Chọn vị trí trước đã");
    return null;
  }
  return { ...lastLatLon };
}

function renderAiInsights(result) {
  if (!result) return;
  appendAiMessage({
    title: "Insights",
    body: result.summary || "Không có dữ liệu tóm tắt",
    meta: pickAiMeta(result),
  });
}

function renderAiAlerts(result) {
  const analysis = result?.analysis;
  if (!analysis) {
    appendAiMessage({
      title: "Alerts",
      body: "Không có dữ liệu cảnh báo",
      meta: pickAiMeta(result),
      variant: "error",
    });
    return;
  }

  const wrapper = document.createElement("div");

  const headlineEl = document.createElement("div");
  headlineEl.className = "ai-alert-headline";
  headlineEl.textContent = analysis.headline || "Cảnh báo thời tiết";
  wrapper.appendChild(headlineEl);

  const severityEl = document.createElement("div");
  severityEl.className = "ai-alert-severity";
  const severityLabel = analysis.severity ? analysis.severity.toString().toUpperCase() : "—";
  severityEl.textContent = `Mức độ: ${severityLabel}`;
  wrapper.appendChild(severityEl);

  if (Array.isArray(analysis.risks) && analysis.risks.length) {
    const risksHeading = document.createElement("h4");
    risksHeading.textContent = "Rủi ro";
    wrapper.appendChild(risksHeading);

    const riskList = document.createElement("ul");
    riskList.className = "ai-alert-advice";
    analysis.risks.forEach((risk) => {
      const li = document.createElement("li");
      const type = String(risk.type || "").toUpperCase();
      const level = risk.level != null ? ` cấp ${risk.level}` : "";
      li.textContent = `${type}${level}: ${risk.why || ""}`.trim();
      riskList.appendChild(li);
    });
    wrapper.appendChild(riskList);
  }

  if (Array.isArray(analysis.advice) && analysis.advice.length) {
    const adviceHeading = document.createElement("h4");
    adviceHeading.textContent = "Khuyến nghị";
    wrapper.appendChild(adviceHeading);

    const adviceList = document.createElement("ul");
    adviceList.className = "ai-alert-advice";
    analysis.advice.forEach((tip) => {
      const li = document.createElement("li");
      li.textContent = tip;
      adviceList.appendChild(li);
    });
    wrapper.appendChild(adviceList);
  }

  appendAiMessage({
    title: "Alerts",
    body: wrapper,
    meta: pickAiMeta(result),
  });
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

function handleAiError(error) {
  console.error(error);
  const details = error?.details;
  let message = error?.message || "Không thể xử lý yêu cầu AI";

  if (details?.error === "OPENAI_DISABLED") {
    message = "AI Weather Agent chưa được bật (thiếu OPENAI_API_KEY).";
  } else if (details?.hint) {
    message = details.hint;
  } else if (details?.detail) {
    message = details.detail;
  }

  showToast(message);
  appendAiMessage({
    title: "AI Error",
    body: message,
    meta: pickAiMeta(details),
    variant: "error",
  });
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
    setLastLatLon(lat, lon);
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
    if (typeof data.location?.lat === "number" && typeof data.location?.lon === "number") {
      setLastLatLon(data.location.lat, data.location.lon);
    } else {
      setLastLatLon(lat, lon);
    }
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

  if (aiToggle) {
    aiToggle.addEventListener("click", () => toggleAiDock());
  }

  if (aiClose) {
    aiClose.addEventListener("click", () => closeAiDock());
  }

  aiTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      const isActive = aiState.activeTab === tabName;
      selectAiTab(tabName, { fetch: true, force: isActive });
    });
  });

  if (aiChatForm) {
    aiChatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (aiState.activeTab !== "chat") {
        openAiDock("chat");
        return;
      }
      doAsk();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && aiState.open) {
      closeAiDock();
      if (aiToggle) {
        aiToggle.focus();
      }
    }
  });

  syncChatAvailability();
}

async function doInsights(options = {}) {
  if (!aiState.open || aiState.activeTab !== "insights") {
    selectAiTab("insights", { fetch: true, force: true });
    return;
  }
  if (aiLoading) return;
  const coords = requireLatLon();
  if (!coords) return;

  const now = Date.now();
  if (!options.force && now - aiFetchTracker.insights < 8000) {
    return;
  }

  setAiLoading(true);
  try {
    const params = new URLSearchParams({ lat: coords.lat.toString(), lon: coords.lon.toString() });
    const data = await callJSON(`${API_BASE}/ai/insights?${params.toString()}`);
    aiFetchTracker.insights = Date.now();
    renderAiInsights(data);
  } catch (error) {
    handleAiError(error);
  } finally {
    setAiLoading(false);
  }
}

async function doAlerts(options = {}) {
  if (!aiState.open || aiState.activeTab !== "alerts") {
    selectAiTab("alerts", { fetch: true, force: true });
    return;
  }
  if (aiLoading) return;
  const coords = requireLatLon();
  if (!coords) return;

  const now = Date.now();
  if (!options.force && now - aiFetchTracker.alerts < 8000) {
    return;
  }

  setAiLoading(true);
  try {
    const params = new URLSearchParams({ lat: coords.lat.toString(), lon: coords.lon.toString() });
    const data = await callJSON(`${API_BASE}/ai/alerts?${params.toString()}`);
    aiFetchTracker.alerts = Date.now();
    renderAiAlerts(data);
  } catch (error) {
    handleAiError(error);
  } finally {
    setAiLoading(false);
  }
}

async function doAsk() {
  if (!aiState.open) {
    openAiDock("chat");
    return;
  }
  if (aiLoading) return;
  const coords = requireLatLon();
  if (!coords) return;

  const question = (aiInput?.value || "").trim();
  if (!question) {
    showToast("Hãy nhập câu hỏi cho AI");
    if (aiInput) aiInput.focus();
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

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  bindEvents();
});
