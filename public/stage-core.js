// Pure, DOM-free stage logic: the audience link URL and the level-meter
// segment state. Kept separate from stage.js so they can be unit-tested
// without a browser.

/**
 * Builds the viewer URL the audience should open for a given session id,
 * from the current page's origin.
 */
export function audienceUrl(origin, sessionId) {
  return `${origin}/?session=${encodeURIComponent(sessionId)}`;
}

/**
 * Builds the ingest WebSocket path for a session, optionally carrying a
 * display name as a `?name=` query param and a stage token as a `?token=`
 * query param. A blank or missing name omits the name param entirely, so
 * the server keeps the session's current name. A blank or missing token
 * omits the token param entirely (the server only requires it when
 * STAGE_TOKEN is configured).
 */
export function ingestPath(sessionId, name, token) {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedToken = typeof token === "string" ? token.trim() : "";

  const params = [];
  if (trimmedName) params.push(`name=${encodeURIComponent(trimmedName)}`);
  if (trimmedToken) params.push(`token=${encodeURIComponent(trimmedToken)}`);

  const base = `/ingest/${encodeURIComponent(sessionId)}`;
  return params.length ? `${base}?${params.join("&")}` : base;
}

/**
 * Maps a 0..1 input level to per-segment lit/hot state for a segmented
 * level meter. `total` segments are lit proportionally to `level`; among
 * the lit segments, those at or past `hotFrom` are marked hot (e.g. to
 * render them in the "clipping" color).
 *
 * @param {number} level - 0..1, clamped; a non-finite value is treated as 0.
 * @param {number} total - number of segments.
 * @param {number} hotFrom - index (0-based) from which a lit segment is hot.
 * @returns {{ lit: boolean, hot: boolean }[]}
 */
export function meterSegments(level, total = 28, hotFrom = 24) {
  const safeLevel = Number.isFinite(level) ? level : 0;
  const clamped = Math.max(0, Math.min(1, safeLevel));
  const litCount = Math.round(clamped * total);

  const segments = [];
  for (let i = 0; i < total; i++) {
    const lit = i < litCount;
    segments.push({ lit, hot: lit && i >= hotFrom });
  }
  return segments;
}
