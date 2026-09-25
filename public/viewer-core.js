// Pure, DOM-free viewer logic: the caption buffer, the WebSocket reconnect
// state machine, and projector mode state. Kept separate from viewer.js so
// they can be unit-tested without a browser.

/**
 * Keeps the last `max` non-empty captions for a session in arrival order,
 * and renders per-language lines on demand.
 *
 * A caption is rejected (return false) when its id was already seen. This
 * makes replayed WS history a no-op instead of duplicating lines. Seq is not
 * used for dedupe: it restarts at 0 when the server restarts, while ids stay
 * unique, so a seq check would silence open viewers after a restart.
 */
export function createCaptionBuffer(max = 4) {
  let seenIds = new Set();
  let captions = [];

  function add(caption) {
    if (seenIds.has(caption.id)) return false;

    seenIds.add(caption.id);

    if (!caption.text) return true;

    captions.push(caption);
    if (captions.length > max) {
      captions = captions.slice(captions.length - max);
    }
    return true;
  }

  function reset() {
    seenIds = new Set();
    captions = [];
  }

  function textForLang(caption, lang) {
    if (lang === "es") return caption.translations?.es ?? "";
    if (lang === "en") return caption.translations?.en ?? "";
    return caption.text;
  }

  function lines(lang) {
    return captions.map((caption) => textForLang(caption, lang)).filter((text) => text !== "");
  }

  return { add, reset, lines };
}

/**
 * WebSocket connection state machine with sane reconnect semantics.
 *
 * Each socket created by `createSocket` is tagged as "current" until it is
 * replaced. Every listener checks that its socket is still the current one
 * before doing anything, so a stale socket's events (including its own
 * close, triggered by us switching sessions) are ignored instead of
 * driving status/caption callbacks or scheduling a reconnect. A genuine
 * drop of the *current* socket schedules a reconnect to the same session
 * after `retryMs`. Connecting to a (possibly new) session always clears
 * any pending reconnect timer first.
 *
 * @param {{
 *   createSocket: (sessionId: string) => any,
 *   onCaption: (caption: any) => void,
 *   onStatus: (text: string, isLive: boolean) => void,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (id: any) => void,
 *   retryMs?: number
 * }} options
 */
export function createCaptionConnection({
  createSocket,
  onCaption,
  onStatus,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  retryMs = 1500
}) {
  let currentSocket = null;
  let reconnectTimer = null;

  function clearPendingReconnect() {
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function attach(socket, sessionId) {
    socket.addEventListener("open", () => {
      if (socket !== currentSocket) return;
      onStatus("live", true);
    });

    socket.addEventListener("message", (event) => {
      if (socket !== currentSocket) return;
      let caption;
      try {
        caption = JSON.parse(event.data);
      } catch {
        return;
      }
      onCaption(caption);
    });

    socket.addEventListener("close", () => {
      if (socket !== currentSocket) return;
      onStatus("reconnecting…", false);
      reconnectTimer = setTimer(() => connectInternal(sessionId), retryMs);
    });

    socket.addEventListener("error", () => {
      if (socket !== currentSocket) return;
      socket.close();
    });
  }

  function connectInternal(sessionId) {
    clearPendingReconnect();
    const previousSocket = currentSocket;

    onStatus("connecting…", false);
    const socket = createSocket(sessionId);
    currentSocket = socket;
    attach(socket, sessionId);

    // Close the previous socket last: by now `currentSocket` already points
    // to the new one, so the old socket's own close event is recognized as
    // stale and ignored instead of scheduling a reconnect to it.
    previousSocket?.close();
  }

  function close() {
    clearPendingReconnect();
    const socket = currentSocket;
    currentSocket = null;
    socket?.close();
  }

  return { connect: connectInternal, close };
}

/**
 * Derives the status pill's label and live flag from the WebSocket
 * connection state and whether the selected session is actually live.
 *
 * A connected socket alone doesn't mean the session is live: the speaker may
 * have stopped or never started, in which case the pill must read Offline
 * rather than Live even though the caption WebSocket is open.
 *
 * @param {{ connection: "connecting" | "reconnecting" | "connected" | "none", sessionLive: boolean }} state
 * @returns {{ label: string, live: boolean }}
 */
export function badgeState({ connection, sessionLive }) {
  if (connection === "connecting") return { label: "Connecting…", live: false };
  if (connection === "reconnecting") return { label: "Reconnecting…", live: false };
  if (connection === "connected" && sessionLive) return { label: "Live", live: true };
  return { label: "Offline", live: false };
}

/**
 * Which sessions the audience picker should offer: live ones only, plus the
 * currently kept session even when it just went offline (e.g. the speaker
 * paused) so a viewer already on that link or selection isn't kicked out.
 * Preserves input order.
 */
export function visibleSessions(sessions, keepId) {
  return sessions.filter((session) => session.live || session.id === keepId);
}

/**
 * Projector mode state. Kept in sync with the browser's fullscreen state so
 * that leaving fullscreen from the browser (Esc, system gesture) also leaves
 * projector mode; otherwise the hidden top bar would leave no way back.
 * Works without fullscreen support too: exit() only leaves projector mode.
 */
export function createProjectorMode({ onChange, requestFullscreen, exitFullscreen, isFullscreen }) {
  let active = false;

  function set(next) {
    if (next === active) return;
    active = next;
    onChange(active);
    if (active) {
      requestFullscreen();
    } else if (isFullscreen()) {
      exitFullscreen();
    }
  }

  return {
    toggle: () => set(!active),
    exit: () => set(false),
    onFullscreenChange() {
      if (active && !isFullscreen()) set(false);
    },
    isActive: () => active
  };
}
