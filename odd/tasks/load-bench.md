# Feature: load-bench

Locator: `odd/tasks/load-bench.md` · Engram mirror: `odd/load-bench/tasks` (project `livecap`)

## Objective
Measure caption latency under many parallel sessions, reproducibly and without spending on Gemini,
so we know how many rooms one process sustains and where it breaks.

## Why
`scripts/simulate.ts` streams audio into N sessions but measures nothing, and `MockTranscriber`
answers instantly, so any load test against it proves nothing. The per-session pipeline serializes
transcription calls; if model latency exceeds chunk duration, captions fall progressively behind.
That drift is the failure mode we need to see.

## Scope / constraints
- In scope: realistic mock latency (T1), a server-side chunk timestamp on captions (T2), a
  `bench` script with a latency report (T3), README docs.
- Out of scope: real-Gemini load runs (user runs those manually), changing pipeline concurrency.
- Keep hexagonal layout: timing/stats logic pure and unit-tested; I/O stays in scripts/infra.
- `chunkTs` is optional on `Caption` so existing clients and history are unaffected.
- Artifacts (code, comments, docs) in English.

## TDD
Mode: strict (source: session "Strict TDD Mode: enabled" + user global CLAUDE.md).
Runner: `npm test` (vitest). RED observed before GREEN for every behavior change.
CLI/WebSocket glue in `scripts/bench.ts` stays exempt, as `simulate.ts` is; its pure stats logic
is extracted and test-first.

## Route
Delegated direct, one writer: writer trigger fired (mock-transcriber, config, main, caption,
transcription-pipeline, bench script, stats module, tests, README).

## Delivery
Strategy: `ask-on-risk`. Forecast ~400 authored lines. RDD: off (global) -> `disabled/unmanaged`.
Branch: `feat/load-bench` (from `main`).

## Tasks
- [x] T1 Mock latency: `MockTranscriber` accepts `{ latencyMs, jitterMs }` plus injectable
      `random`/`sleep` for deterministic tests; config reads `MOCK_LATENCY_MS` and
      `MOCK_LATENCY_JITTER_MS` (default 0, invalid -> 0); `main.ts` wires them.
- [x] T2 Chunk timestamp: `Caption.chunkTs?: number`, set by `TranscriptionPipeline` to `now()` at
      `enqueue` time (when the chunk was cut), so `receivedAt - chunkTs` = queue wait + model
      latency + delivery.
- [x] T3 Bench: `scripts/bench-stats.ts` (pure: percentiles p50/p95/max, per-session drift =
      least-squares slope of latency over elapsed time, pass/fail vs threshold) with tests;
      `scripts/bench.ts` streams a WAV into `--sessions N` (or a list) for `--duration`, subscribes
      to `/captions/:session`, prints a per-session + overall report, exits non-zero when drift
      indicates backlog; `npm run bench`; README "Load testing" section.

## Acceptance criteria
- `npm test` green, `npm run typecheck` clean.
- With `TRANSCRIBER=mock MOCK_LATENCY_MS=1500`, `npm run bench` against many sessions prints
  per-session p50/p95/max/drift; with latency above chunk duration it reports growing backlog.

## Progress / evidence

### T1 Mock latency
- RED: `npx vitest run tests/captions/infrastructure/mock-transcriber.test.ts
  tests/captions/infrastructure/config.test.ts` — 3 new mock-transcriber tests and 3 new config
  tests failed first (e.g. `awaits the injected sleep with the fixed latency when jitter is zero`:
  "expected 'spy' to be called 1 times, but got 0 times"; `parses MOCK_LATENCY_MS and
  MOCK_LATENCY_JITTER_MS as numbers`: "expected undefined to be 1500").
- GREEN: implemented `MockTranscriberOptions` (`latencyMs`, `jitterMs`, `random`, `sleep`) with
  delay `max(0, latencyMs + (random()*2-1)*jitterMs)`, skipped entirely when both are 0; added
  `mockLatencyMs`/`mockLatencyJitterMs` to `Config`/`loadConfig`; wired into `main.ts` with a log
  line when non-zero.
- `npm test`: 83/83 passed. `npm run typecheck`: clean.
- Commit: `313a5e2` feat(mock): simulate transcription latency.

### T2 Chunk timestamp
- RED: `npx vitest run tests/captions/application/transcription-pipeline.test.ts` — new test
  `stamps chunkTs with the enqueue-time value of now(), distinct from the later publish-time ts`
  failed first: "expected undefined to be 1000".
- GREEN: `Caption.chunkTs?: number` added (doc comment: epoch ms when the audio chunk was cut and
  enqueued); `TranscriptionPipeline.enqueue` now captures `now()` synchronously before queuing and
  passes it through to `process`, which stamps the published caption's `chunkTs` with that value
  while `ts` keeps using `now()` at publish time.
- `npm test`: 83/83 passed. `npm run typecheck`: clean.
- Commit: `a91fe7e` feat(captions): stamp chunk enqueue time.

### T3 Bench
- RED: `npx vitest run tests/scripts/bench-stats.test.ts` — all 16 tests failed to even collect
  first: "Failed to load url ../../scripts/bench-stats.js ... Does the file exist?" (module did
  not exist yet).
- GREEN: implemented `scripts/bench-stats.ts` (`percentile` via nearest-rank method, documented in
  its doc comment; `summarize` computing count/p50/p95/max plus `driftMsPerMin` as the
  least-squares slope of latency over elapsed time scaled to ms/min, 0 with <2 samples or a
  degenerate/zero-variance elapsed axis; `isBacklogging` with a configurable threshold, default
  `DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN = 500`). `npx vitest run tests/scripts/bench-stats.test.ts`
  -> 16/16 passed.
- Extracted `sliceFrames`/`connectWebSocket`/`sleep` from `simulate.ts` into
  `scripts/stream-helpers.ts` and reused them in `simulate.ts` (behavior unchanged, verified by
  running its usage-error path and the existing exemption from unit tests).
- Implemented `scripts/bench.ts` (CLI/WS glue, exempt from unit tests like `simulate.ts`, verified
  by typecheck and a manual usage-error run): `--sessions N|a,b,c`, `--duration` (default 60s),
  `--host`, `--max-drift`; opens `/captions/:session` before streaming; records
  `latency = Date.now() - chunkTs`, ignoring captions with no/stale `chunkTs` (predating bench
  start, e.g. history sent on connect); after duration, waits a 10s grace period, then prints a
  per-session + overall p50/p95/max/drift table and exits non-zero on backlog.
- Added `"bench": "tsx scripts/bench.ts"` to `package.json` and a README "Load testing" section
  (mock-latency run, bench invocation, how to read `driftMsPerMin`/`BACKLOG`, real-Gemini cost/
  rate-limit note).
- `npm test`: 99/99 passed. `npm run typecheck`: clean.
- Commit: `dd05f44` feat(bench): add multi-session latency bench.

### Smoke checks (5 sessions, 12s tone/silence WAV, mock server)
- `MOCK_LATENCY_MS=1500`, 20s: every session p50 1500 / p95 1501 ms, drift ~0 ms/min -> ok, exit 0.
- `MOCK_LATENCY_MS=8000` (> 6s max chunk), 40s: p50 ~16s / p95 ~24s, drift ~59800 ms/min ->
  BACKLOG, exit 1. Confirms the serialized per-session queue falls behind when model latency
  exceeds chunk duration.
- Orchestrator spot check: `npm test` 99/99, `npm run typecheck` clean.

### Delivery note
Authored diff ~850 lines vs ~400 forecast (tests + helper extraction from `simulate.ts`). User
chose chain strategy `stacked-to-main`, 3 slices (original T3 commit `dd05f44` split in two):
- PR 1 `feat/load-bench-01-mock-latency` -> `main`: `313a5e2`, `a91fe7e`, `b2d1d3f` (244 lines,
  83/83 tests standalone).
- PR 2 `feat/load-bench-02-bench-stats` -> PR 1: `494a5bd` (202 lines).
- PR 3 `feat/load-bench-03-bench-cli` -> PR 2: `9642c3e` + docs (~420 lines incl. this doc;
  slightly over budget because of the ODD doc, code alone ~375).
Final tree of PR 3 verified identical to the pre-split `feat/load-bench` (`f659f30`).

## Next step
Review/merge PRs in order; retarget each child to `main` after its parent merges. Candidate
follow-up: ordered-but-concurrent transcription to remove the backlog (improvement #3).
