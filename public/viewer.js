// Audience viewer: pick a session and a language, and show the last few
// captions for that session with the newest one emphasized. Reconnects
// automatically if the WebSocket drops, and remembers the last choices.
//
// The reconnect state machine and the caption buffer live in viewer-core.js
// (DOM-free, unit-tested) so switching sessions never fights its own old
// socket, and a reconnect after a genuine drop replays history into the
// buffer's dedupe instead of visibly blanking/reflowing the screen.

import {
  badgeState,
  createCaptionBuffer,
  createCaptionConnection,
  createProjectorMode,
  visibleSessions
} from "./viewer-core.js";

const MAX_VISIBLE_LINES = 4;
const LANG_NAMES = { original: "Original", es: "Español", en: "English" };
const LANG_CODES = { original: "ORIGINAL", es: "ES", en: "EN" };
const SESSION_STORAGE_KEY = "captearla.viewer.session";
const LANG_STORAGE_KEY = "captearla.viewer.lang";

const sessionSelect = document.getElementById("sessionSelect");
const langSegmented = document.getElementById("langSegmented");
const langButtons = Array.from(langSegmented.querySelectorAll("button[data-lang]"));
const statusBadge = document.getElementById("statusBadge");
const statusLabel = document.getElementById("statusLabel");
const projectorButton = document.getElementById("projectorButton");
const projectorExitButton = document.getElementById("projectorExitButton");
const captionsEl = document.getElementById("captions");
const captionMetaEl = document.getElementById("captionMeta");
const projectorMetaEl = document.getElementById("projectorMeta");

let currentSession = null;
let currentLang = "original";
let sessionsById = new Map();
// Last WebSocket connection state ("connecting" | "reconnecting" | "connected"
// | "none"), tracked separately from whether the selected session is live:
// a connected socket doesn't mean the session is live (speaker stopped or
// never started), so the badge needs both to decide Live vs. Offline.
let connectionState = "none";
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
  for (const line of buffer.lines(currentLang)) {
    const div = document.createElement("div");
    div.className = "caption-line";
    div.textContent = line;
    captionsEl.appendChild(div);
  }
}

function sessionName() {
  const session = sessionsById.get(currentSession);
  return session ? session.name : (currentSession ?? "");
}

function updateMetaLine() {
  const parts = [sessionName(), LANG_NAMES[currentLang] ?? currentLang];
  if (currentLang !== "original") parts.push("Machine translated");
  captionMetaEl.textContent = parts.filter(Boolean).join(" · ");

  projectorMetaEl.textContent = [sessionName(), LANG_CODES[currentLang] ?? currentLang]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();
}

function renderBadge() {
  const session = sessionsById.get(currentSession);
  const { label, live } = badgeState({
    connection: connectionState,
    sessionLive: Boolean(session?.live)
  });
  statusBadge.classList.toggle("live", live);
  statusLabel.textContent = label;
}

function setStatus(text, isLive) {
  connectionState = isLive ? "connected" : text === "reconnecting…" ? "reconnecting" : "connecting";
  renderBadge();
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
  writeStorage(SESSION_STORAGE_KEY, sessionId);
  updateUrl(sessionId, currentLang);
  buffer.reset();
  renderLines();
  updateMetaLine();
  connection.connect(sessionId);
}

function applyLangUI() {
  for (const button of langButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === currentLang));
  }
}

function selectLang(lang) {
  if (lang === currentLang) return;
  currentLang = lang;
  applyLangUI();
  writeStorage(LANG_STORAGE_KEY, currentLang);
  if (currentSession) updateUrl(currentSession, currentLang);
  renderLines();
  updateMetaLine();
}

async function refreshSessions() {
  let sessions = [];
  try {
    const response = await fetch("/api/sessions");
    sessions = await response.json();
  } catch {
    return;
  }

  sessionsById = new Map(sessions.map((session) => [session.id, session]));

  const wanted = paramsFromUrl().get("session") ?? readStorage(SESSION_STORAGE_KEY);
  const wantedExists = sessions.some((s) => s.id === wanted);
  // Once a session is selected, keep offering it (even if it just went
  // offline) so an audience member isn't dropped when the speaker pauses.
  // Before that, only a session the viewer actually asked for earns a slot
  // among the offline ones.
  const keepId = currentSession ?? (wantedExists ? wanted : null);
  const visible = visibleSessions(sessions, keepId);

  sessionSelect.innerHTML = "";

  if (visible.length === 0) {
    const placeholder = document.createElement("option");
    placeholder.textContent = "No live sessions";
    placeholder.disabled = true;
    placeholder.selected = true;
    sessionSelect.appendChild(placeholder);
    updateMetaLine();
    connectionState = "none";
    renderBadge();
    return;
  }

  for (const session of visible) {
    const option = document.createElement("option");
    option.value = session.id;
    option.textContent =
      session.id === keepId && !session.live ? `${session.name} (offline)` : session.name;
    sessionSelect.appendChild(option);
  }

  if (!currentSession) {
    const initial = wantedExists ? wanted : visible[0].id;
    sessionSelect.value = initial;
    selectSession(initial);
  } else if (visible.some((s) => s.id === currentSession)) {
    sessionSelect.value = currentSession;
  }

  updateMetaLine();
  renderBadge();
}

currentLang = paramsFromUrl().get("lang") ?? readStorage(LANG_STORAGE_KEY) ?? "original";
applyLangUI();

sessionSelect.addEventListener("change", () => selectSession(sessionSelect.value));

for (const button of langButtons) {
  button.addEventListener("click", () => selectLang(button.dataset.lang));
}

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
