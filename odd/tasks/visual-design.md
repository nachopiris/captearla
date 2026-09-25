# Feature: visual-design

Locator: `odd/tasks/visual-design.md` · Engram mirror: `odd/visual-design/tasks`

## Objective
Apply one sober, consistent visual design to the two screens (audience viewer and stage), as agreed
on the design canvas https://claude.ai/artifact/Sbc5kanUh9zgznfBaJVAox (boards: Viewer desktop,
Viewer phone, Projector, Stage on air).

## Why
The prototype UI is functional but generic; the demo needs a polished, legible, coherent look.

## Scope / constraints
- Vanilla HTML/CSS/JS in `public/`, no framework, no build step. Keep every existing behavior
  (reconnect, dedupe, projector exit, deep links, localStorage) intact.
- Design tokens as CSS custom properties in `public/styles.css`:
  bg `#111110`, surface `#1A1917`, surface-2 `#242320`, line `#2A2826`, border `#2E2C2A`,
  text `#F2EFE9`, text-2 `#C9C4BC`, muted `#A29D95`, faint `#7D7870`, accent `#E9B44C`
  (on-accent `#1A1406`), live `#FF5A4E` (live text `#FF8177`, live bg `#2A1413`),
  projector bg `#0A0A09`.
- Fonts: Atkinson Hyperlegible Next (UI + captions), IBM Plex Mono (labels, meta, ids) via Google
  Fonts, with system fallbacks.
- Touch targets >= 44px; AA contrast; icons are inline stroke SVG, no emoji.
- UI copy stays English.

## TDD
Mode: strict (source: user global CLAUDE.md). Runner: `npm test` (vitest). DOM glue in `public/`
stays exempt from unit tests (as in live-captions-prototype T5); any new pure logic (e.g.
audience-link building, meter segment count) is extracted and test-first.

## Route
Delegated direct: writer trigger fired (styles.css, index.html, viewer.js, stage.html, stage.js).

## Delivery
Strategy: `ask-on-risk`. Forecast ~450 authored lines. RDD: not enabled -> `disabled/unmanaged`.
Branch: `feat/live-captions-prototype` (existing feature branch).

## Tasks
- [x] T1 Design tokens + shared components in `styles.css` (topbar, brand mark, segmented control,
      select with chevron, badges incl. live, buttons, panels, footer, fonts)
- [x] T2 Viewer: `index.html` + `viewer.js` — segmented language control (aria-pressed) replacing
      the select, live badge, projector button with icon, meta line (session · language · machine
      translated), caption hierarchy (older faint, current large), footer disclaimer, phone layout,
      projector mode per canvas
- [x] T3 Stage: `stage.html` + `stage.js` — Stage tag, On air badge, two-column layout (session +
      audience link with Copy, microphone start/stop + segmented level meter; live preview panel)

## Acceptance criteria
- `npm test` green, `npm run typecheck` clean, `node --check` on public JS.
- Viewer and stage render per the canvas at desktop and 390px width; existing behaviors intact.

## Progress / evidence
- T1 (`3842d7e`): rewrote `public/styles.css` — tokens (`bg`/`surface`/`surface-2`/`line`/`border`/
  `text`/`text-2`/`muted`/`faint`/`accent`/`on-accent`/`live`/`live-text`/`live-bg`/`projector-bg`
  per the doc, plus `--projector-dim: #8A847C` from the canvas's projector faint-row spec, not in
  the doc's token list but needed for that element) and `--font-ui`/`--font-mono`; shared
  components: `.mono-label`, `.brand`/`.brand-icon`/`.brand-name`/`.divider`, `.select-wrap`
  (chevron svg), `.segmented`/`[aria-pressed]`, `.badge`/`.badge-dot`/`.badge.live`, `.btn`/
  `.btn-primary`/`.btn-danger`/`.btn-copy`, `.panel`, `.site-footer`. `npm test`: 13/13 passed
  (unaffected, CSS-only). `node --check` n/a (no JS touched).
- T2 (`09a2be5`): `public/index.html` — Google Fonts link, restructured topbar (brand, session
  select, language segmented control replacing the old `<select>`, spacer, live badge with dot,
  projector button with corner-bracket icon), added `.projector-bar` (faint top row shown only in
  projector mode: brand + "SESSION · LANG" mono meta + the same `#projectorExitButton`, same click
  behavior, now restyled/repositioned instead of a floating corner button — still reachable via
  click/Esc/fullscreenchange/dblclick, so "corner exit" behavior is preserved functionally though
  its position moved from an absolutely-positioned corner to the top-row's right edge), caption
  meta line, footer disclaimer. `public/viewer.js` — replaced `langSelect.value` reads with a
  `currentLang` variable driven by the segmented buttons (`aria-pressed` toggling), same
  `original|es|en` values, same localStorage key/URL param persistence and dedupe/reconnect/buffer
  logic untouched (still delegates to `viewer-core.js`); added `updateMetaLine()` (session name ·
  language name · "Machine translated" when lang != original) and `sessionsById` map for session
  name lookup. `public/styles.css` — added viewer topbar/projector/captions/phone (`<=640px`)
  rules. Verification: `npm test` 13/13 passed; `node --check` clean on all `public/*.js`.
  Deviation: none in reconnect/dedupe/deep-link/localStorage/projector-entry-exit behavior;
  verified by re-reading `viewer.js` against the pre-change version line by line.

- T3 (`9d7880b`): TDD — wrote `tests/stage/stage-core.test.ts` first (10 tests covering
  `audienceUrl` and `meterSegments`), ran `npx vitest run tests/stage/stage-core.test.ts` and
  observed RED (`Failed to load url ../../public/stage-core.js ... Does the file exist?`, 0
  tests collected). Implemented `public/stage-core.js` (`audienceUrl(origin, sessionId)`,
  `meterSegments(level, total=28, hotFrom=24)`), reran the same command and observed GREEN
  (10/10 passed). `public/stage.html` — Google Fonts link, brand + "Stage" tag, "On air"/"Idle"
  badge, two-column grid (`460px minmax(0,1fr)`, single column `<=900px`), Session panel (id
  input, hint, audience-link row + Copy button), Microphone panel (Start/Stop mic with icons,
  28-segment `role="meter"` level meter), Live preview panel (right-aligned "Original language"
  label, bottom-anchored caption lines, muted "No captions yet." placeholder).
  `public/stage.js` — reused the already-tested `createCaptionBuffer` from `viewer-core.js` to
  give the live-preview panel the older/current line hierarchy the canvas calls for (the original
  stage.js only ever showed the single latest caption with no history; this is a deliberate, low
  risk extension built on tested logic, not a rewrite of tracked behavior); wired `audienceUrl`
  into an input-driven audience-link display and a clipboard Copy button
  (`navigator.clipboard.writeText` in try/catch, "Copied" for 1.5s); replaced the raw
  `rms*220`/`%` width meter with `meterSegments` driving the 28 segment elements, same
  `analyserNode`/RMS math and the same `rms*2.2` sensitivity (`220/100 = 2.2`) so loudness
  response is unchanged; all mic start/stop, ingest WS, AudioWorklet, session id
  localStorage/datalist logic is untouched. `public/styles.css` — added stage grid/panel/meter/
  audience-link/preview rules and the `<=900px` single-column breakpoint.

- T2 fix: viewer header labels (Session, Language) rendered above their controls because the
  shared `.field` is a column; `.topbar-controls .field` is now a row on desktop and stays a
  column at <=640px, per the canvas (route: inline, one mechanical CSS rule).

## Verification
- `npm test`: 13 files / 74 tests passed (10 new in `tests/stage/stage-core.test.ts`, all
  pre-existing suites green, including `tests/viewer/viewer-core.test.ts` 13/13).
- `npm run typecheck`: clean (`tsc --noEmit`, no output/errors). `public/` is excluded from
  `tsconfig.json`'s `include`, so this checks `src`/`scripts`/`tests` only.
- `node --check` on every `public/*.js` (`pcm-worklet.js`, `stage-core.js`, `stage.js`,
  `viewer-core.js`, `viewer.js`): all OK.
- Server smoke test: `TRANSCRIBER=mock PORT=3997 npx tsx src/main.ts`, then curl `/`,
  `/stage.html`, `/styles.css`, `/stage-core.js`, `/viewer.js`, `/viewer-core.js`: all `200`.
  Server killed after.

## Next step
Done — T1, T2, T3 all committed on `feat/live-captions-prototype`. No push performed (not
requested). Open follow-up: no automated visual/pixel check exists for the canvas's exact
spacing; only structural/behavioral verification above was run. A manual look in a browser is
recommended before demoing.
