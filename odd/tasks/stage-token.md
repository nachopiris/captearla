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
- [ ] T2 Stage client: token input + persisted value + `ingestPath` token param + 401 feedback; tests for pure core. Route: delegated (writer trigger: stage.html, stage.js, stage-core.js).
- [ ] T3 Docs: README auth section, `.env.example`, Fly secret. Route: inline or with T2 writer.

## Acceptance criteria
- With `STAGE_TOKEN` set: ingest without/with wrong token → 401, no session created/renamed; correct token → works.
- Without `STAGE_TOKEN`: behavior unchanged, warning logged.
- `npm test` and `npm run typecheck` green.

## Progress / Evidence
- T1 done. RED observed: `config.test.ts` "parses a STAGE_TOKEN..." failed (undefined vs "secret-token"); 3 new `http-server.test.ts` STAGE_TOKEN tests timed out waiting for rejection (handshake opened instead). GREEN after implementing `parseStageToken` in `config.ts`, `hasValidStageToken` + 401 gate in `http-server.ts` upgrade handler, and wiring in `main.ts`. `npm test`: 162/162 passed. `npm run typecheck`: clean. Commit: 9642109 `feat(ingest): require STAGE_TOKEN for audio ingest when configured`.

## Next step
T2 (stage client): send `token` query param via `ingestPath()`, persist in localStorage, surface 401/rejection to the operator. A rejected/unauthenticated ingest WS shows the browser client an `error` event (ws emits `unexpected-response` with no listener attached, which falls back to `error`+close) — there is no distinguishable HTTP status visible client-side, so T2 should treat any handshake error on `/ingest/:session` as "check your stage token".
