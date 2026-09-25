# Feature: bounded-concurrent-transcription

Locator: `odd/tasks/bounded-concurrent-transcription.md` · Engram mirror:
`odd/bounded-concurrent-transcription/tasks` (project `livecap`)

## Objective
Stop per-session caption backlog when model latency exceeds chunk duration, by running up to
`maxInFlight` transcription calls concurrently per session while still publishing captions in
strict chunk order.

## Why
`TranscriptionPipeline` chains every chunk on one promise queue, so chunk N+1 is not sent until
chunk N returns. The load-bench feature proved that with `MOCK_LATENCY_MS=8000` captions drift
~60s per minute of audio. Gemini latency dominates end-to-end latency, so serial calls cap
throughput at one chunk per model round-trip.

## Decision (accepted by user 2026-09-25)
Bounded concurrency, not unbounded and not the Gemini Live API (Live API deferred to a later
time-boxed spike behind a new streaming port).
- `maxInFlight` per session, default 3, configurable; `maxInFlight = 1` reproduces today's
  behavior exactly (free rollback).
- Rolling context for a call = the latest *published* captions at dispatch time. When the model
  keeps up, context is identical to today; under load it lags by up to `maxInFlight - 1` chunks.
  Accepted tradeoff.

## Scope / constraints
- In scope: pipeline concurrency + ordered publish (T1), config/manager/main wiring + README (T2),
  before/after bench measurement (T3).
- Out of scope: Gemini Live API, AudioChunker O(n²) fix, flash-lite model, real-Gemini bench.
- Ordering contract: captions publish in chunk arrival order; a slow earlier chunk blocks later
  publishes until it resolves (success, empty text, or error). Empty/failed chunks release their
  slot and are skipped; `Caption.seq` stays contiguous over published captions only.
- `enqueue()` still returns a promise that settles when that chunk is published or skipped.
- `chunkTs` still captured synchronously at `enqueue` time.
- Hexagonal layout unchanged; `Transcriber` port unchanged.
- Artifacts (code, comments, docs) in English.

## TDD
Mode: strict (source: session "Strict TDD Mode: enabled" + user global CLAUDE.md).
Runner: `npm test` (vitest); `npm run typecheck`. RED observed before GREEN per behavior change.

## Route
- T1: delegated direct, one writer (writer trigger: pipeline + its test are 2 non-trivial files).
- T2: same writer, sequential (config, manager, main, README, tests).
- T3: parent runs the bench (per-action).

## Delivery
Strategy: `ask-on-risk`. Forecast ~250 authored lines (under the ~400 budget -> single PR).
RDD: off (global) -> `disabled/unmanaged`.
Branch: `perf/bounded-concurrent-transcription` (from `main` 99453cc).

## Tasks
- [x] T1 Pipeline: `TranscriptionPipelineDeps.maxInFlight?: number` (default 3). At most
      `maxInFlight` `transcribe` calls in flight; further chunks wait FIFO. Results publish in
      chunk order via a reorder buffer; empty/failed results are skipped without blocking later
      chunks forever. Context at dispatch = latest published captions (`contextSize`). Tests:
      concurrency cap honored, out-of-order completion still publishes in order, error/empty in
      the middle does not stall, `maxInFlight: 1` stays serial with full context, `seq`
      contiguous, `enqueue` promise settles per chunk.
- [x] T2 Wiring: config reads `TRANSCRIBE_MAX_IN_FLIGHT` (positive integer, default 3, invalid ->
      3); `SessionPipelineManager` forwards `maxInFlight`; `main.ts` wires it and logs the value;
      README documents the variable and the context tradeoff. Tests for config + manager.
- [x] T3 Measure: `TRANSCRIBER=mock MOCK_LATENCY_MS=8000 npm start` +
      `npm run bench -- <wav> --sessions 5 --duration 40`, with `TRANSCRIBE_MAX_IN_FLIGHT=1`
      (baseline) and default 3; record p50/p95/max/drift here.

## Acceptance criteria
- `npm test` green, `npm run typecheck` clean.
- Bench at 8s mock latency: drift with maxInFlight=3 materially lower than with 1 (no backlog
  exit), numbers recorded below.

## Progress / evidence

### T1 Pipeline (delegated writer) — dd236e9, e23dedd, 3cde4ea
- RED: `npx vitest run tests/captions/application/transcription-pipeline.test.ts` — `honors the concurrency cap` failed (`expected "spy" to be called 3 times, but got 0 times`) and `dispatches concurrently ... context limited to already-published captions` failed (`expected [] to deeply equal [ '', '', '' ]`). Three other new tests (ordered publish, error/empty skip, maxInFlight:1 serial context) passed on the old serial code, as that code already satisfied them.
- GREEN: FIFO pending queue + `inFlight` counter + reorder buffer (`Map<arrivalIndex, SettledEntry>`) flushed in order; the slot frees when the call settles. The existing strict-order test was pinned to `maxInFlight: 1`.
- Parent review found a regression: `bus.publish` had moved outside try/catch, so a throwing listener became an unhandled rejection (fatal in Node) and left that chunk's `enqueue` promise pending forever. Fixed test-first in e23dedd (RED: test timeout + `Unhandled Rejection: listener boom`). 3cde4ea (parent, inline) logs it as `Publishing caption failed` instead of `Transcription failed` (RED on the message assertion, then GREEN).

### T2 Wiring — 636141c
- RED: 6 config tests (`expected undefined to be 3/5`) and 1 manager test (`expected "spy" to be called 1 times, but got 2 times`).
- GREEN: `TRANSCRIBE_MAX_IN_FLIGHT` (default 3; invalid values `0`, `-2`, `abc`, `1.5` fall back to 3), `SessionPipelineManager` forwards it, `main.ts` wires it and logs it, README documents the variable and the tradeoff. Docker/.env.example were left untouched, following the `MOCK_LATENCY_MS` precedent.

### Checks
- `npm run typecheck`: clean. `npm test`: 14 files, 113/113 passed.

### T3 Bench (parent) — 5 sessions, 40s, `MOCK_LATENCY_MS=8000`, synthetic WAV (440Hz tone, 2s on / 0.6s off, 16kHz mono), port 3100 (3000 was occupied)
| maxInFlight | captions | p50 | p95 | max | drift | verdict |
|---|---|---|---|---|---|---|
| 1 (baseline) | 25 | 18890ms | 29677ms | 29678ms | 125550 ms/min | BACKLOG (exit 1) |
| 3 (default) | 70 | 8181ms | 8648ms | 8653ms | 184.9 ms/min | ok (exit 0) |
- Residual drift at 3 is because 8s latency / ~2.6s chunks ≈ 3.1 > 3 slots. The value stays below the 500ms/min threshold.
- Not measured: real Gemini (cost, rate limits), and caption quality under context lag.

## Next step
Delivery: push the branch and open a PR to main. This is the user's decision; RDD is off, so delivery is `disabled/unmanaged`.
