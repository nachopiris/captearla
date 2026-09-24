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
- [x] T4 Server: HTTP static + WS `/ingest/:session` and `/captions/:session` + `/api/sessions` — tests
- [x] T5 Frontend: `stage.html` (mic -> PCM16 AudioWorklet), `index.html` viewer (session/lang
      picker, captions), minimal styling
- [x] T6 Simulation script (WAV -> N sessions), Dockerfile, docker-compose, README deploy docs

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
  `tsc --noEmit` clean. Commit: 3b23ee5.
- T4 done. `loadConfig` (env parsing: PORT, TRANSCRIBER default from GEMINI_API_KEY presence,
  GEMINI_MODEL, comma-separated SESSIONS with trim/empty-filter). `SessionPipelineManager`
  (application-layer wiring: one AudioChunker + one TranscriptionPipeline per session, sharing one
  Transcriber instance, lazily created, independent per session). `createServer` (node:http +
  `ws`, no framework): `GET /api/sessions` (id/name/live/captionsCount), `GET
  /api/sessions/:id/captions` (bus history), static file serving from `public/` with 404 fallback,
  WS `/ingest/:session` (binary PCM16LE frames -> manager.ingest, marks session live on
  connect/not-live on close), WS `/captions/:session` (sends history on connect, then live
  fan-out via bus.subscribe). `src/main.ts` composition root wired (mock or Gemini transcriber
  chosen from config; GoogleGenAI client imported dynamically only when TRANSCRIBER=gemini).
  RED observed first (3 suites failing on missing module: config, session-pipeline-manager,
  http-server), then GREEN: 46/46 tests passing overall (includes a real WS
  ingest -> captions integration test on an ephemeral port with MockTranscriber), `tsc --noEmit`
  clean. Manual smoke: `TRANSCRIBER=mock PORT=3998 npx tsx src/main.ts` served
  `/api/sessions` correctly. Commit: e11f751.
- T5 done. Frontend is vanilla HTML/CSS/JS, no build step, English UI copy. `public/styles.css`
  (shared dark high-contrast theme, responsive `clamp()` caption sizing, `.projector` mode
  styles). `public/pcm-worklet.js` (AudioWorkletProcessor: linear-interpolation downsample from
  the browser's native rate to 16 kHz mono, Float32->Int16, ~100ms frames posted to main thread;
  documented as having no anti-aliasing filter, an acceptable tradeoff for speech). `stage.html` +
  `stage.js` (operator page: session id input with datalist from `/api/sessions`, start/stop mic,
  AnalyserNode-based level meter, streams worklet frames over WS `/ingest/:session`, live caption
  preview via WS `/captions/:session`, remembers session in localStorage try/catch). `index.html`
  + `viewer.js` (audience viewer: session picker polled every 5s from `/api/sessions`, language
  picker Original/Español/English, shows last 4 caption lines with newest emphasized via CSS,
  auto-reconnect with backoff timer, localStorage remember (try/catch) + `?session=&lang=`
  deep-link via `history.replaceState`, projector/fullscreen toggle). Frontend is exempt from unit
  tests per plan; validated with `node --check` on all `.js` files (pass) and by serving every
  static asset through the real server (`/`, `/stage.html`, `/viewer.js`, `/pcm-worklet.js`,
  `/styles.css` all 200 with correct content-type). Full suite still 46/46, `tsc --noEmit` clean
  (no `src/` changes this task). Commit: 4e93c3d.
- T6 done. Added `parseWavPcm16` (pure WAV decoder pairing with `pcmToWav`: generic chunk walker
  tolerant of extra chunks, rejects non-RIFF/WAVE and non-16-bit files with clear errors; tested
  RED-then-GREEN including an encode/decode round-trip against `pcmToWav`) and
  `scripts/simulate.ts` (loops a 16kHz mono PCM16 WAV into one or more `--sessions` over
  `/ingest/:session` in real time via `ws`, exits with an ffmpeg conversion command if the file
  isn't 16kHz mono, auto-reconnects on drop). `Dockerfile` (single-stage `node:22-slim`, `npm ci`
  including dev deps so `tsx` runs the TS source directly — no separate build step for this
  prototype) and `docker-compose.yml` (env passthrough for PORT/TRANSCRIBER/GEMINI_API_KEY/
  GEMINI_MODEL/SESSIONS). `README.md` (architecture diagram, quick start for mock/Gemini modes,
  running-a-conference guidance, scaling notes, local/offline-adapter note, privacy note).
  RED observed first (1 suite failing on missing module: wav-to-pcm), then GREEN: 49/49 tests
  passing overall, `tsc --noEmit` clean. Manual smoke: `docker build` succeeded, `docker run`
  served `/api/sessions` correctly; `npx tsx scripts/simulate.ts` against a locally generated
  16kHz mono sine-wave WAV, streamed into two parallel sessions
  (`main-stage`,`room-a`) at once, both produced distinct MockTranscriber captions retrievable via
  `/api/sessions/:id/captions` — confirming end-to-end parallelism. Commit: 1735d75.
- Post-T6 fix (found during the mandated final smoke check, `curl -sI /` and `/stage.html`):
  the HTTP handler only matched `req.method === "GET"`, so HEAD requests fell through to a
  generic 404. Added a RED test first (2 new cases in http-server.test.ts: HEAD on a static
  file, HEAD on the JSON API — both failed 404 vs expected 200), then fixed `createServer` to
  treat GET/HEAD alike and skip writing a body for HEAD. GREEN: 51/51 tests. Commit: 1bb6fff.
- Final verification (all in foreground, see report):
  - `npm test`: 51/51 passing.
  - `npm run typecheck`: clean, no errors.
  - Smoke: `TRANSCRIBER=mock PORT=3999 npm start` in background; `curl -s /api/sessions` ->
    3 predefined sessions; `curl -sI /` -> 200 text/html; `curl -sI /stage.html` -> 200
    text/html; ran `npx tsx scripts/simulate.ts <generated 16kHz mono sine WAV> --sessions
    main-stage --host localhost:3999` for ~8s; `curl -s /api/sessions/main-stage/captions`
    returned one caption, and `/api/sessions` showed `live:true, captionsCount:1` for
    main-stage; server and simulate processes killed afterward, no stray listeners left.

## Next step
None. T1-T6 implemented, tested (strict TDD RED->GREEN throughout), committed as one work-unit
commit per task plus one follow-up fix commit, and independently smoke-verified end to end
(server, simulate script, Docker image). No known gaps against the acceptance criteria.
