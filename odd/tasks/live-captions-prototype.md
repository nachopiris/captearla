# Feature: live-captions-prototype

Locator: `odd/tasks/live-captions-prototype.md` · Engram mirror: `odd/live-captions-prototype/tasks`

## Objective
Prototype for the Nerdearla Vibeathon 2026 (deadline 2026-09-25 15:00 UTC): an open source,
real-time transcription system for conferences. Live stage audio -> subtitles in the original
language plus Spanish (and English), for many parallel sessions, with an audience UI to pick
session and language.

## Why
Competition requirements: live audio input, real-time subtitles, bilingual output, 5-10+ parallel
sessions, OSI license, deployment docs, audience-facing session/language selector. Recommended
stack: Gemini audio (cloud) or Gemma (local).

## Scope / constraints
- Node 22+ TypeScript backend, `ws` WebSocket server, static vanilla HTML/JS frontend. No framework.
- Hexagonal: `Transcriber` port; adapters `mock` (no key, deterministic, for tests/demo) and
  `gemini` (chunked audio -> `@google/genai` generateContent returning JSON with original text,
  detected language, `es`, `en`). Model configurable via env.
- Stage page captures mic as PCM16 16 kHz mono and streams it over WebSocket per session.
- Viewer page: choose session + language, large captions, live updates.
- Session registry supports N parallel sessions; each session has its own pipeline.
- Simulation script streams a WAV file into several sessions to demo parallelism.
- License: Apache-2.0. README with deploy docs, Dockerfile + docker-compose.
- Artifacts in English.

## TDD
Mode: strict (source: user global CLAUDE.md "Strict TDD Mode: enabled"). Runner: `npm test` (vitest).

## Route
Delegated direct — writer trigger fired (2+ non-trivial files), preparation trigger (reading that
prepares the write belongs to the writer).

## Delivery
Strategy: `ask-on-risk`. Forecast ~1200 authored lines (prototype, single greenfield repo).
RDD: not enabled by user (default off) -> `disabled/unmanaged`.

## Tasks
- [x] T1 Scaffold: package.json, tsconfig, vitest, LICENSE, .gitignore
- [x] T2 Domain + pipeline: audio chunker (PCM windowing with silence-based cut), session registry,
      caption bus (pub/sub by session), `Transcriber` port + mock adapter — with tests
- [x] T3 Gemini adapter (chunk -> WAV -> generateContent JSON; rolling context) — unit tests with
      stubbed client
- [ ] T4 Server: HTTP static + WS `/ingest/:session` and `/captions/:session` + `/api/sessions` — tests
- [ ] T5 Frontend: `stage.html` (mic -> PCM16 AudioWorklet), `index.html` viewer (session/lang
      picker, captions), minimal styling
- [ ] T6 Simulation script (WAV -> N sessions), Dockerfile, docker-compose, README deploy docs

## Acceptance criteria
- `npm test` green; `npm run build` passes typecheck.
- `TRANSCRIBER=mock npm start` serves viewer; captions flow from simulated stage to viewer.
- With `GEMINI_API_KEY`, real transcription + ES/EN translation from mic.

## Progress / evidence
- T1 done. Scaffolded package.json (ESM, Node 22+, scripts: dev/start/test/typecheck/simulate),
  tsconfig.json (NodeNext, strict), vitest.config.ts, Apache-2.0 LICENSE, .gitignore, .env.example.
  `npm install` clean, `npx tsc --version` / `npx vitest --version` both resolve. Commit: 2dd0120.
- T2 done. Domain: `Caption`, `Transcriber` port (`TranscribeInput`/`TranscribeResult`).
  Application: `AudioChunker` (silence-cut + max-duration flush, drops all-silence chunks),
  `CaptionBus` (pub/sub by session + bounded history), `SessionRegistry` (predefined +
  auto-create), `TranscriptionPipeline` (per-session ordered queue, rolling context, logs
  and swallows transcriber errors). Infrastructure: `MockTranscriber` (deterministic, cycles
  canned bilingual sentences, no network). RED observed first (5 suites failing on missing
  module: audio-chunker, caption-bus, session-registry, mock-transcriber, transcription-pipeline),
  then GREEN: 21/21 tests passing, `tsc --noEmit` clean. Commit: 70002b9.
- T3 done. Added `pcmToWav` (pure helper: canonical 44-byte WAV header + PCM16LE data, tested
  header fields byte-by-byte and payload/size correctness) and `GeminiTranscriber` (adapter over
  an injected narrow `GeminiClient` interface — no real `@google/genai` client touched in tests;
  wraps chunk to WAV/base64, sends prompt + rolling context + inlineData audio/wav,
  `responseMimeType: application/json` with schema, parses `{text,lang,es,en}`, empty/invalid
  JSON or client-throw all degrade to an empty-text result instead of throwing, model defaults to
  `gemini-2.5-flash`). Note: bumped `@google/genai` from the originally scaffolded `^0.3.0` (its
  published tarball ships no `dist/`, i.e. broken) to `^2.24.0`, whose `node.d.ts` confirms
  `ai.models.generateContent(params) => Promise<GenerateContentResponse>` and
  `response.text: string | undefined`, matching the design. RED observed first (2 suites failing
  on missing module: pcm-to-wav, gemini-transcriber), then GREEN: 31/31 tests passing overall,
  `tsc --noEmit` clean. Commit: (recorded after commit below).

## Next step
Continue with T4 (HTTP + WS server).
