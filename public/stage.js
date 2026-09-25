// Operator page logic: capture the microphone, downsample it to 16 kHz
// mono PCM16 via an AudioWorklet, and stream it over WebSocket to
// /ingest/:session. Also shows a level meter and a live caption preview
// by subscribing to /captions/:session.

import { createCaptionBuffer } from "./viewer-core.js";
import { audienceUrl, ingestPath, meterSegments } from "./stage-core.js";

const METER_SEGMENT_COUNT = 28;
const METER_HOT_FROM = 24;
const PREVIEW_LINES = 3;

const sessionInput = document.getElementById("sessionInput");
const sessionNameInput = document.getElementById("sessionNameInput");
const knownSessions = document.getElementById("knownSessions");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const statusBadge = document.getElementById("statusBadge");
const statusLabel = document.getElementById("statusLabel");
const levelMeter = document.getElementById("levelMeter");
const captionPreview = document.getElementById("captionPreview");
const audienceLinkEl = document.getElementById("audienceLink");
const copyLinkButton = document.getElementById("copyLinkButton");
const copyLinkLabel = document.getElementById("copyLinkLabel");

let audioContext = null;
let mediaStream = null;
let workletNode = null;
let analyserNode = null;
let ingestSocket = null;
let captionsSocket = null;
let levelAnimationFrame = null;
let copyResetTimer = null;

const previewBuffer = createCaptionBuffer(PREVIEW_LINES);

// Build the 28 meter segment elements once; only their classes change.
const meterSegmentEls = [];
for (let i = 0; i < METER_SEGMENT_COUNT; i++) {
  const segment = document.createElement("div");
  segment.className = "level-meter-segment";
  levelMeter.appendChild(segment);
  meterSegmentEls.push(segment);
}

function readStoredSession() {
  try {
    return localStorage.getItem("captearla.stage.session") ?? "";
  } catch {
    return "";
  }
}

function storeSession(session) {
  try {
    localStorage.setItem("captearla.stage.session", session);
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.).
  }
}

function readStoredSessionName() {
  try {
    return localStorage.getItem("captearla.stage.sessionName") ?? "";
  } catch {
    return "";
  }
}

function storeSessionName(name) {
  try {
    localStorage.setItem("captearla.stage.sessionName", name);
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.).
  }
}

function updateAudienceLink() {
  const sessionId = sessionInput.value.trim();
  audienceLinkEl.textContent = audienceUrl(location.origin, sessionId);
}

sessionInput.value = readStoredSession() || "main-stage";
sessionNameInput.value = readStoredSessionName();
updateAudienceLink();

sessionInput.addEventListener("input", updateAudienceLink);

copyLinkButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(audienceLinkEl.textContent ?? "");
    copyLinkLabel.textContent = "Copied";
  } catch {
    return;
  }
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    copyLinkLabel.textContent = "Copy";
  }, 1500);
});

async function loadKnownSessions() {
  try {
    const response = await fetch("/api/sessions");
    const sessions = await response.json();
    knownSessions.innerHTML = "";
    for (const session of sessions) {
      const option = document.createElement("option");
      option.value = session.id;
      if (session.name && session.name !== session.id) option.label = session.name;
      knownSessions.appendChild(option);
    }
  } catch {
    // The picker is a convenience; failing to load it is not fatal.
  }
}

function setStatus(text, isLive) {
  statusBadge.classList.toggle("live", Boolean(isLive));
  statusLabel.textContent = text;
}

function wsUrl(path) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${path}`;
}

function renderPreview() {
  const lines = previewBuffer.lines("original");
  if (lines.length === 0) {
    captionPreview.innerHTML = '<p class="stage-captions-placeholder">No captions yet.</p>';
    return;
  }
  captionPreview.innerHTML = "";
  for (const line of lines) {
    const div = document.createElement("div");
    div.className = "caption-line";
    div.textContent = line;
    captionPreview.appendChild(div);
  }
}

function connectCaptionsPreview(sessionId) {
  captionsSocket?.close();
  previewBuffer.reset();
  renderPreview();
  captionsSocket = new WebSocket(wsUrl(`/captions/${encodeURIComponent(sessionId)}`));
  captionsSocket.addEventListener("message", (event) => {
    let caption;
    try {
      caption = JSON.parse(event.data);
    } catch {
      return;
    }
    if (previewBuffer.add(caption)) renderPreview();
  });
}

function renderLevelMeter(level) {
  const segments = meterSegments(level, METER_SEGMENT_COUNT, METER_HOT_FROM);
  segments.forEach((segment, index) => {
    const el = meterSegmentEls[index];
    el.classList.toggle("lit", segment.lit);
    el.classList.toggle("hot", segment.hot);
  });
  levelMeter.setAttribute("aria-valuenow", String(Math.round(Math.min(1, Math.max(0, level)) * 100)));
}

function updateLevelMeter() {
  if (!analyserNode) return;
  const data = new Uint8Array(analyserNode.fftSize);
  analyserNode.getByteTimeDomainData(data);
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const centered = (data[i] - 128) / 128;
    sumSquares += centered * centered;
  }
  const rms = Math.sqrt(sumSquares / data.length);
  renderLevelMeter(Math.min(1, rms * 2.2));
  levelAnimationFrame = requestAnimationFrame(updateLevelMeter);
}

async function startMic() {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) {
    alert("Enter a session id first.");
    return;
  }
  storeSession(sessionId);
  storeSessionName(sessionNameInput.value);

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule("/pcm-worklet.js");

  const source = audioContext.createMediaStreamSource(mediaStream);

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 1024;
  source.connect(analyserNode);

  workletNode = new AudioWorkletNode(audioContext, "pcm-worklet");
  source.connect(workletNode);

  ingestSocket = new WebSocket(wsUrl(ingestPath(sessionId, sessionNameInput.value)));
  ingestSocket.binaryType = "arraybuffer";

  workletNode.port.onmessage = (event) => {
    if (ingestSocket.readyState === WebSocket.OPEN) {
      ingestSocket.send(event.data);
    }
  };

  connectCaptionsPreview(sessionId);

  setStatus("On air", true);
  startButton.disabled = true;
  stopButton.disabled = false;
  sessionInput.disabled = true;
  sessionNameInput.disabled = true;

  updateLevelMeter();
}

function stopMic() {
  cancelAnimationFrame(levelAnimationFrame);
  renderLevelMeter(0);

  workletNode?.port?.close?.();
  workletNode?.disconnect?.();
  analyserNode?.disconnect?.();
  mediaStream?.getTracks().forEach((track) => track.stop());
  audioContext?.close?.();
  ingestSocket?.close();
  captionsSocket?.close();

  workletNode = null;
  analyserNode = null;
  mediaStream = null;
  audioContext = null;
  ingestSocket = null;
  captionsSocket = null;

  setStatus("Idle", false);
  startButton.disabled = false;
  stopButton.disabled = true;
  sessionInput.disabled = false;
  sessionNameInput.disabled = false;
}

startButton.addEventListener("click", () => {
  startMic().catch((error) => {
    console.error("Failed to start microphone capture", error);
    alert(`Could not start the microphone: ${error.message}`);
    setStatus("Error", false);
  });
});

stopButton.addEventListener("click", stopMic);

loadKnownSessions();
