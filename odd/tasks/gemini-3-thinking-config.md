# Feature: gemini-3-thinking-config

Locator: `odd/tasks/gemini-3-thinking-config.md` · Engram mirror: `odd/gemini-3-thinking-config/tasks`
(project `livecap`)

## Objective
Make `GeminiTranscriber` work with Gemini 3.x models (for example `gemini-3.5-flash-lite`), then
benchmark 3.5 flash-lite against 2.5 flash on latency and caption quality.

## Problem / evidence (2026-09-25)
- `GeminiTranscriber` hardcodes `thinkingConfig: { thinkingBudget: 0 }`.
- Real bench: `gemini-3.5-flash-lite` returned `400 INVALID_ARGUMENT` on 120/120 calls. A direct
  probe confirmed `thinkingBudget: 0` -> 400 and `thinkingLevel: "minimal"` -> OK.
- Docs (https://ai.google.dev/gemini-api/docs/thinking): Gemini 3.x uses `thinkingLevel`; the
  lowest level is `minimal` on 3.5 flash-lite / 3.6 flash and `low` on 3.7 / 3.8 flash.
- `gemini-2.5-flash-lite` returns 404 for this account ("no longer available to new users").

## Decision (accepted by user)
- Model `gemini-2.*` -> `{ thinkingBudget: 0 }` (unchanged behavior).
- Any other model -> `{ thinkingLevel: GEMINI_THINKING_LEVEL ?? "minimal" }`.
- `GEMINI_THINKING_LEVEL` in `minimal|low|medium|high`; invalid or missing -> unset (default
  applies). It is ignored for 2.x models.

## Scope / constraints
- In scope: thinking config selection + config/env + main wiring + README (T1); real-Gemini
  bench and quality comparison (T2, parent).
- Out of scope: changing the default model, the Live API, prompt changes.
- Hexagonal: selection is a pure, unit-tested function in infrastructure.
- Artifacts in English.

## TDD
Mode: strict (source: session "Strict TDD Mode: enabled"). Runner: `npm test` (vitest),
`npm run typecheck`.

## Route
- T1: delegated direct, one writer (writer trigger: gemini-transcriber, config, main, README and
  tests).
- T2: parent (per-action bench runs with the user's key from `.env`; the user authorized the
  real-Gemini runs).

## Delivery
Strategy: `ask-on-risk`. Forecast ~150 authored lines -> single PR. RDD: off -> `disabled/unmanaged`.
Branch: `fix/gemini-3-thinking-config` (from `main` 9accd6f).

## Tasks
- [x] T1 Thinking config: pure `thinkingConfigFor(model, level?)`; `GeminiTranscriber` accepts
      `thinkingLevel?` and uses it; config parses `GEMINI_THINKING_LEVEL`; `main.ts` wires and
      logs it; README documents it. Tests: 2.x -> budget 0 (level ignored), 3.x -> minimal by
      default, 3.x + level -> that level, request carries the selected config, config parsing
      (valid values, missing, invalid).
- [x] T2 Bench: `gemini-3.5-flash-lite` with 5 rooms (same WAV and settings as the 2.5-flash
      run: Nerdearla RNMzyrnfNV0 min 3-5, 120s, maxInFlight 3); capture the `bench-1` captions for
      both models and compare text quality.

## Acceptance criteria
- `npm test` green, `npm run typecheck` clean.
- `gemini-3.5-flash-lite` produces captions with 0 errors in the bench; latency and quality are
  recorded next to 2.5 flash.

## Baseline (2.5 flash, 5 rooms)
p50 2520ms, p95 3606ms, max 4693ms, 125 captions, 0 errors, no backlog.

## Progress / evidence

### T1 — f0a770d (delegated writer)
- RED: 10 failed / 28 passed (`thinkingConfigFor is not a function` x3; 3.x requests carried `{ thinkingBudget: 0 }`; 5 `GEMINI_THINKING_LEVEL` parsing cases returned `undefined`).
- GREEN: 38/38 in the two files; `npm test` 130/130; `npm run typecheck` clean.
- Wire values: 2.x -> `{ thinkingBudget: 0 }`; 3.x -> `{ thinkingLevel: "minimal" }` or the configured level. Lowercase is correct for the Developer API; the SDK's uppercase `ThinkingLevel` enum is not used.
- Boot log: `using GeminiTranscriber (model: X, thinking: budget 0 | level Y)`.

### T2 — real bench (5 rooms, 120s, Nerdearla RNMzyrnfNV0 min 3-5, maxInFlight 3)
| model | captions | p50 | p95 | max | errors / 429 | backlog |
|---|---|---|---|---|---|---|
| gemini-2.5-flash | 125 | 2701ms | 3408ms | 4712ms | 0 / 0 | no |
| gemini-3.5-flash-lite (minimal) | 125 | 2368ms | 2728ms | 2909ms | 0 / 0 | no |

Quality (first 12 `bench-1` captions, no ground-truth transcript, one speaker):
- The Spanish transcriptions are nearly identical. Each model makes one different error: flash-lite heard "y ya nos llevo" where flash heard "y yo los llevo"; flash wrote "no peor" where flash-lite wrote "o peor".
- Translation: flash-lite is more natural and more correct in places (it translates "egresar" as "leave"; flash says "graduate").
- Chunk boundaries garble words for both models ("puede desmotivar / dar", "puedes / llegar"). That is a chunking issue, not a model issue.
- Verdict: with this small sample, flash-lite is equal or better on quality, 12% faster at p50, and 20% faster at p95.

## Next step
Delivery: PR to main (the user decides). Optionally switch the default model to gemini-3.5-flash-lite (a product decision, not taken here).
