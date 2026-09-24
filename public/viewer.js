// Audience viewer: pick a session and a language, and show the last few
// captions for that session with the newest one emphasized. Reconnects
// automatically if the WebSocket drops, and remembers the last choices.
//
// The reconnect state machine and the caption buffer live in viewer-core.js
// (DOM-free, unit-tested) so switching sessions never fights its own old
// socket, and a reconnect after a genuine drop replays history into the
// buffer's dedupe instead of visibly blanking/reflowing the screen.

import { createCaptionBuffer, createCaptionConnection, createProjectorMode } from "./viewer-core.js";

const MAX_VISIBLE_LINES = 4;

const sessionSelect = document.getElementById("sessionSelect");
const langSelect = document.getElementById("langSelect");
const statusBadge = document.getElementById("statusBadge");
const projectorButton = document.getElementById("projectorButton");
const projectorExitButton = document.getElementById("projectorExitButton");
const captionsEl = document.getElementById("captions");

let currentSession = null;
const buffer = createCaptionBuffer(MAX_VISIBLE_LINES);

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

function renderLines() {
  captionsEl.innerHTML = "";
  for (const line of buffer.lines(langSelect.value)) {
    const div = document.createElement("div");
    div.className = "caption-line";
    div.textContent = line;
    captionsEl.appendChild(div);
  }
}

function setStatus(text, isLive) {
  statusBadge.textContent = text;
  statusBadge.classList.toggle("live", Boolean(isLive));
}

function wsUrl(path) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${path}`;
}

const connection = createCaptionConnection({
  createSocket: (sessionId) => new WebSocket(wsUrl(`/captions/${encodeURIComponent(sessionId)}`)),
  onCaption: (caption) => {
    if (buffer.add(caption)) renderLines();
  },
  onStatus: setStatus
});

function selectSession(sessionId) {
  if (sessionId === currentSession) return;
  currentSession = sessionId;
  writeStorage("captearla.viewer.session", sessionId);
  updateUrl(sessionId, langSelect.value);
  buffer.reset();
  renderLines();
  connection.connect(sessionId);
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
  const wanted = paramsFromUrl().get("session") ?? readStorage("captearla.viewer.session");
  const wantedExists = sessions.some((s) => s.id === wanted);

  if (!currentSession) {
    sessionSelect.value = wantedExists ? wanted : sessions[0].id;
    selectSession(sessionSelect.value);
  } else if (stillExists) {
    sessionSelect.value = previouslySelected;
  }
}

langSelect.value = paramsFromUrl().get("lang") ?? readStorage("captearla.viewer.lang") ?? "original";

sessionSelect.addEventListener("change", () => selectSession(sessionSelect.value));

langSelect.addEventListener("change", () => {
  writeStorage("captearla.viewer.lang", langSelect.value);
  if (currentSession) updateUrl(currentSession, langSelect.value);
  renderLines();
});

const projector = createProjectorMode({
  onChange: (active) => document.body.classList.toggle("projector", active),
  requestFullscreen: () => document.documentElement.requestFullscreen?.().catch(() => {}),
  exitFullscreen: () => document.exitFullscreen?.().catch(() => {}),
  isFullscreen: () => Boolean(document.fullscreenElement)
});

projectorButton.addEventListener("click", () => projector.toggle());
projectorExitButton.addEventListener("click", () => projector.exit());
captionsEl.addEventListener("dblclick", () => projector.exit());
document.addEventListener("fullscreenchange", () => projector.onFullscreenChange());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") projector.exit();
});

refreshSessions();
setInterval(refreshSessions, 5000);
