// Audience viewer: pick a session and a language, and show the last few
// captions for that session with the newest one emphasized. Reconnects
// automatically if the WebSocket drops, and remembers the last choices.

const MAX_VISIBLE_LINES = 4;

const sessionSelect = document.getElementById("sessionSelect");
const langSelect = document.getElementById("langSelect");
const statusBadge = document.getElementById("statusBadge");
const projectorButton = document.getElementById("projectorButton");
const captionsEl = document.getElementById("captions");

let socket = null;
let reconnectTimer = null;
let currentSession = null;
let lines = [];

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.).
  }
}

function paramsFromUrl() {
  return new URLSearchParams(location.search);
}

function updateUrl(sessionId, lang) {
  const params = new URLSearchParams(location.search);
  params.set("session", sessionId);
  params.set("lang", lang);
  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function textForLang(caption, lang) {
  if (lang === "es") return caption.translations?.es ?? "";
  if (lang === "en") return caption.translations?.en ?? "";
  return caption.text;
}

function renderLines() {
  captionsEl.innerHTML = "";
  for (const line of lines) {
    const div = document.createElement("div");
    div.className = "caption-line";
    div.textContent = line;
    captionsEl.appendChild(div);
  }
}

function pushCaption(caption, lang) {
  const text = textForLang(caption, lang);
  if (!text) return;
  lines.push(text);
  if (lines.length > MAX_VISIBLE_LINES) {
    lines = lines.slice(lines.length - MAX_VISIBLE_LINES);
  }
  renderLines();
}

function setStatus(text, isLive) {
  statusBadge.textContent = text;
  statusBadge.classList.toggle("live", Boolean(isLive));
}

function wsUrl(path) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${path}`;
}

function connect(sessionId) {
  clearTimeout(reconnectTimer);
  socket?.close();
  lines = [];
  renderLines();
  setStatus("connecting…", false);

  socket = new WebSocket(wsUrl(`/captions/${encodeURIComponent(sessionId)}`));

  socket.addEventListener("open", () => setStatus("live", true));

  socket.addEventListener("message", (event) => {
    try {
      const caption = JSON.parse(event.data);
      pushCaption(caption, langSelect.value);
    } catch {
      // Ignore malformed frames.
    }
  });

  socket.addEventListener("close", () => {
    setStatus("reconnecting…", false);
    reconnectTimer = setTimeout(() => connect(sessionId), 1500);
  });

  socket.addEventListener("error", () => socket.close());
}

function selectSession(sessionId) {
  if (sessionId === currentSession) return;
  currentSession = sessionId;
  writeStorage("livecap.viewer.session", sessionId);
  updateUrl(sessionId, langSelect.value);
  connect(sessionId);
}

async function refreshSessions() {
  let sessions = [];
  try {
    const response = await fetch("/api/sessions");
    sessions = await response.json();
  } catch {
    return;
  }

  const previouslySelected = sessionSelect.value;
  sessionSelect.innerHTML = "";
  for (const session of sessions) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent = session.live ? `${session.name} (live)` : session.name;
    sessionSelect.appendChild(option);
  }

  if (sessions.length === 0) return;

  const stillExists = sessions.some((s) => s.id === previouslySelected);
  const wanted = paramsFromUrl().get("session") ?? readStorage("livecap.viewer.session");
  const wantedExists = sessions.some((s) => s.id === wanted);

  if (!currentSession) {
    sessionSelect.value = wantedExists ? wanted : sessions[0].id;
    selectSession(sessionSelect.value);
  } else if (stillExists) {
    sessionSelect.value = previouslySelected;
  }
}

langSelect.value = paramsFromUrl().get("lang") ?? readStorage("livecap.viewer.lang") ?? "original";

sessionSelect.addEventListener("change", () => selectSession(sessionSelect.value));

langSelect.addEventListener("change", () => {
  writeStorage("livecap.viewer.lang", langSelect.value);
  if (currentSession) updateUrl(currentSession, langSelect.value);
});

projectorButton.addEventListener("click", () => {
  document.body.classList.toggle("projector");
  if (document.body.classList.contains("projector")) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
});

refreshSessions();
setInterval(refreshSessions, 5000);
