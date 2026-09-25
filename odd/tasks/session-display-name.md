# Feature: session-display-name

Locator: `odd/tasks/session-display-name.md` · Engram mirror: `odd/session-display-name/tasks`
(project `livecap`)

## Objective
Let the stage operator give a session a human-readable name (for example "Sala Principal")
in addition to its id, so the audience viewer shows the name instead of the raw id.

## Problem / evidence (2026-09-25)
- `SessionInfo` already has `name` and the viewer already renders it (`public/viewer.js:154`).
- Nobody sets it: `SessionRegistry.ensure(id, name = id)` is only called with the id
  (`src/captions/infrastructure/http-server.ts:104`), so `name === id` always.

## Decision (accepted by user)
- The name comes from the stage (not from config).
- Transport: optional `name` query param on the ingest WebSocket, `/ingest/:session?name=...`.
- Server: trim; cap at 80 chars; empty or missing keeps the current name (default: the id).
  A non-empty name renames the session (last ingest wins).

## Scope / constraints
- In scope: registry rename, ingest query param, stage "Session name" input (stored in
  localStorage, disabled while live), README note.
- Out of scope: config-based names, auth on renaming, viewer changes beyond what already exists.
- Artifacts in English.

## TDD
Mode: strict (source: session "Strict TDD Mode: enabled"). Runner: `npm test` (vitest),
`npm run typecheck`.

## Route
- T1 + T2: delegated direct, one writer (writer trigger: registry, http-server, stage-core,
  stage.js, stage.html and tests are 2+ non-trivial files).

## Delivery
- Strategy: ask-on-risk. Forecast: ~150 authored changed lines (under budget, single PR).
- RDD: off (decided by global) -> disabled/unmanaged.

## Tasks
- [x] T1 Server: `SessionRegistry` accepts a name (sanitized, non-empty renames); ingest reads
  `?name=`. Tests first (registry + http-server).
- [x] T2 Stage: "Session name" input, persisted, sent as `?name=` on ingest; pure URL builder in
  `stage-core.js` with tests; README note.

## Acceptance criteria
- Connecting `/ingest/room-a?name=Sala%20A` makes `/api/sessions` report `name: "Sala A"`.
- Missing/blank name keeps the id (or a previous name).
- `npm test` and `npm run typecheck` pass.

## Progress / evidence
- T1 `4f6e861` feat(sessions): accept a display name on ingest. RED: registry "blank or missing
  name keeps the current name" (`expected 'main-stage' to be 'Main Stage'`) and 3 http-server tests
  (`expected 'room-a' to be 'Sala A'`). GREEN 138/138, typecheck clean.
- T2 `14deb7e` feat(stage): let the operator name the session. RED: 4 `ingestPath` tests
  (`TypeError: ingestPath is not a function`). GREEN 142/142, typecheck clean.
- Parent spot check after both commits: `npm test` 142/142, `npm run typecheck` clean.
- Authored lines: 167+ / 8- (single PR, under budget). RDD: disabled/unmanaged.

## Next step
- User decision: push + PR.
