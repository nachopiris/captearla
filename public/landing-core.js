// Pure, DOM-free landing page logic. Kept separate from landing.js so it can
// be unit-tested without a browser.

/**
 * Backward compatibility for already-shared audience links/QRs, which point
 * at `/?session=<id>` (optionally with `&lang=`). Given the landing page's
 * `location.search`, returns the viewer path to redirect to, preserving the
 * full query string, or `null` when there is no session to redirect for.
 *
 * @param {string} search - `location.search`, e.g. "?session=room-a&lang=es".
 * @returns {string | null}
 */
export function viewerRedirect(search) {
  const params = new URLSearchParams(search);
  const session = params.get("session");
  if (!session) return null;
  return `/viewer.html${search}`;
}
