# Feature: load-bench

Locator: `odd/tasks/load-bench.md` · Engram mirror: `odd/load-bench/tasks` (PENDING: engram
returned `ambiguous_project`; awaiting user project choice)

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
- [ ] T3 Bench: `scripts/bench-stats.ts` (pure: percentiles p50/p95/max, per-session drift =
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

## Next step
T3 (bench-stats.ts, bench.ts, npm run bench, README section), then smoke checks.
