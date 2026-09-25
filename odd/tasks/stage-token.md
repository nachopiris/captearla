# Feature: stage-token

Branch: `feat/stage-token` · Locator: `odd/tasks/stage-token.md` · Engram mirror: `odd/stage-token/tasks`

## Objective
Only operators holding a shared secret can push audio into a session.

## Problem / Why
The `/ingest/:session` WebSocket upgrade (`src/captions/infrastructure/http-server.ts`) accepts anyone. With the public URL, anyone can inject captions into any session, auto-create sessions, rename them via `?name=`, and burn Gemini quota. Hiding `stage.html` does not help: the WebSocket is the real entry point.

## Scope
- Server: optional `STAGE_TOKEN` config; when set, the ingest upgrade requires `?token=<STAGE_TOKEN>` (timing-safe compare) and otherwise answers `401` and destroys the socket before any session is created or renamed.
- When `STAGE_TOKEN` is unset, ingest stays open (local quick start keeps working) and the server logs a startup warning.
- Stage client: "Stage token" input, remembered in localStorage (try/catch), sent as `token` query param by `ingestPath()`; a 401 / closed socket shows a clear error.
- Viewer, `/api/*` and caption WebSocket stay public (read-only).
- Docs: README + `.env.example`, `fly secrets set STAGE_TOKEN=...`.

## Constraints
- TDD: strict, on (source: session config "Strict TDD Mode: enabled"); runner `npm test` (vitest run) + `npm run typecheck`.
- Artifacts in English. RDD: off (global) → delivery `disabled/unmanaged`.
- Delivery strategy: ask-on-risk; forecast ~250 authored lines (under budget, single PR).

## Tasks
- [x] T1 Server gate: config `stageToken` + ingest upgrade 401 on missing/wrong token; tests in config.test + http-server.test. Route: delegated (writer trigger: config.ts + http-server.ts + 2 test files).
- [x] T2 Stage client: token input + persisted value + `ingestPath` token param + 401 feedback; tests for pure core. Route: delegated (writer trigger: stage.html, stage.js, stage-core.js).
- [x] T3 Docs: README auth section, `.env.example`, Fly secret. Route: delegated (same writer as T2).

## Acceptance criteria
- With `STAGE_TOKEN` set: ingest without/with wrong token → 401, no session created/renamed; correct token → works.
- Without `STAGE_TOKEN`: behavior unchanged, warning logged.
- `npm test` and `npm run typecheck` green.

## Progress / Evidence
- T1 done. RED observed: `config.test.ts` "parses a STAGE_TOKEN..." failed (undefined vs "secret-token"); 3 new `http-server.test.ts` STAGE_TOKEN tests timed out waiting for rejection (handshake opened instead). GREEN after implementing `parseStageToken` in `config.ts`, `hasValidStageToken` + 401 gate in `http-server.ts` upgrade handler, and wiring in `main.ts`. `npm test`: 162/162 passed. `npm run typecheck`: clean. Commit: 9642109 `feat(ingest): require STAGE_TOKEN for audio ingest when configured`.
- T2 done. RED observed: added 5 tests to `tests/stage/stage-core.test.ts` for `ingestPath`'s new `token` argument (append+encode, blank-omit, combined with `name`) — `npm test -- tests/stage/stage-core.test.ts` showed 3 of the 5 failing (2 coincided with pre-existing no-op behavior) with `expected '/ingest/main-stage' to be '/ingest/main-stage?token=...'`. GREEN after `ingestPath(sessionId, name, token)` builds params via `encodeURIComponent` (not `URLSearchParams`, to keep `%20` spacing matching existing `name` tests instead of `+`). Wired `stage.html`/`stage.js`: "Stage token" `type=password` field, `captearla.stage.token` localStorage key (same try/catch pattern), passed into `ingestPath()` at socket creation. Rejection UX: track `ingestOpened`/`ingestClosingIntentionally` flags around the ingest socket's `open`/`error`/`close` listeners — a `close` before `open`, not caused by a deliberate `stopMic()`, calls `stopMic()` then shows "Connection rejected — check the stage token" (overrides the "Idle" status stopMic sets, since JS is synchronous between the two calls). Manual stop before the socket opens is guarded so it no longer misreports rejection. `npm test`: 167/167 passed. `npm run typecheck`: clean. Commit: 680346b `feat(stage): send stage token on audio ingest`.
- T3 done. README: new "Protecting audio ingest (STAGE_TOKEN)" section before "Deploying to Fly.io" (what it protects, unset/set behavior, stage-page UX), Fly deploy snippet gained `fly secrets set STAGE_TOKEN=$(openssl rand -hex 24)`, the stale "no authentication" sentence updated, and the Docker env-var list now mentions `STAGE_TOKEN`. `.env.example` gained a commented `STAGE_TOKEN=`. `docker-compose.yml` gained `STAGE_TOKEN: ${STAGE_TOKEN:-}` (matching its existing explicit env list style). `npm test`: 167/167 passed. `npm run typecheck`: clean. Commit: (recorded below after commit).

## Next step
None — T1, T2, T3 all done. Acceptance criteria met: server 401s missing/wrong token before session creation, works unchanged with correct token or unset `STAGE_TOKEN` (with warning), stage client sends/persists the token and surfaces a rejection message, docs cover config and Fly deploy. `npm test` and `npm run typecheck` green throughout. Delivery: RDD off (global) → `disabled/unmanaged`; forecast ~250 lines, actual is under budget (single PR, no chaining needed). No push/PR made — delivery remains the user's decision.
