// Operator page logic: capture the microphone, downsample it to 16 kHz
// mono PCM16 via an AudioWorklet, and stream it over WebSocket to
// /ingest/:session. Also shows a level meter and a live caption preview
// by subscribing to /captions/:session.

const sessionInput = document.getElementById("sessionInput");
const knownSessions = document.getElementById("knownSessions");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const statusBadge = document.getElementById("statusBadge");
const levelFill = document.getElementById("levelFill");
const captionPreview = document.getElementById("captionPreview");

let audioContext = null;
let mediaStream = null;
let workletNode = null;
let analyserNode = null;
let ingestSocket = null;
let captionsSocket = null;
let levelAnimationFrame = null;

function readStoredSession() {
  try {
    return localStorage.getItem("livecap.stage.session") ?? "";
  } catch {
    return "";
  }
}

function storeSession(session) {
  try {
    localStorage.setItem("livecap.stage.session", session);
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.).
  }
}

sessionInput.value = readStoredSession() || "main-stage";

async function loadKnownSessions() {
  try {
    const response = await fetch("/api/sessions");
    const sessions = await response.json();
    knownSessions.innerHTML = "";
    for (const session of sessions) {
      const option = document.createElement("option");
      option.value = session.id;
      knownSessions.appendChild(option);
    }
  } catch {
    // The picker is a convenience; failing to load it is not fatal.
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

function connectCaptionsPreview(sessionId) {
  captionsSocket?.close();
  captionsSocket = new WebSocket(wsUrl(`/captions/${encodeURIComponent(sessionId)}`));
  captionsSocket.addEventListener("message", (event) => {
    try {
      const caption = JSON.parse(event.data);
      captionPreview.textContent = caption.text;
    } catch {
      // Ignore malformed frames.
    }
  });
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
  levelFill.style.width = `${Math.min(100, Math.round(rms * 220))}%`;
  levelAnimationFrame = requestAnimationFrame(updateLevelMeter);
}

async function startMic() {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) {
    alert("Enter a session id first.");
    return;
  }
  storeSession(sessionId);

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule("/pcm-worklet.js");

  const source = audioContext.createMediaStreamSource(mediaStream);

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 1024;
  source.connect(analyserNode);

  workletNode = new AudioWorkletNode(audioContext, "pcm-worklet");
  source.connect(workletNode);

  ingestSocket = new WebSocket(wsUrl(`/ingest/${encodeURIComponent(sessionId)}`));
  ingestSocket.binaryType = "arraybuffer";

  workletNode.port.onmessage = (event) => {
    if (ingestSocket.readyState === WebSocket.OPEN) {
      ingestSocket.send(event.data);
    }
  };

  connectCaptionsPreview(sessionId);

  setStatus("live", true);
  startButton.disabled = true;
  stopButton.disabled = false;
  sessionInput.disabled = true;

  updateLevelMeter();
}

function stopMic() {
  cancelAnimationFrame(levelAnimationFrame);
  levelFill.style.width = "0%";

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

  setStatus("idle", false);
  startButton.disabled = false;
  stopButton.disabled = true;
  sessionInput.disabled = false;
}

startButton.addEventListener("click", () => {
  startMic().catch((error) => {
    console.error("Failed to start microphone capture", error);
    alert(`Could not start the microphone: ${error.message}`);
    setStatus("error", false);
  });
});

stopButton.addEventListener("click", stopMic);

loadKnownSessions();
