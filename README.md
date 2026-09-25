# Captearla

> So nobody misses the talk.

*Captearla* blends **caption** with the Rioplatense *-earla* ending of
Nerdearla, and plays on the Spanish *captarla*: to catch it, to get it.

Open source, real-time transcription and captioning for conferences: live
stage audio in, live captions out — in the original language, plus Spanish
and English — for as many parallel sessions/rooms as you have stages, with a
simple audience page to pick a session and a language.

Built for the Nerdearla Vibeathon 2026.

## How it works

```
 ┌────────────┐   mic (PCM16 16kHz)   ┌──────────────────────────────┐
 │ stage.html │ ────── WS ──────────► │   /ingest/:session           │
 │ (operator) │                       │                               │
 └────────────┘                       │  AudioChunker (silence-cut)  │
                                       │        │                    │
                                       │        ▼                    │
                                       │  TranscriptionPipeline       │
                                       │  (ordered, rolling context)  │
                                       │        │                    │
                                       │        ▼                    │
                                       │  Transcriber port            │
                                       │  ┌────────────┐ ┌──────────┐ │
                                       │  │MockTranscri-│ │ Gemini   │ │
                                       │  │ber (no key) │ │Transcriber│ │
                                       │  └────────────┘ └──────────┘ │
                                       │        │                    │
                                       │        ▼                    │
                                       │      CaptionBus              │
                                       └──────────────────────────────┘
                                               │            ▲
                                        WS  /captions/:session   GET /api/sessions
                                               ▼            │
                                       ┌────────────┐  ┌────────────┐
                                       │ index.html │  │  (polling) │
                                       │ (audience) │  │            │
                                       └────────────┘  └────────────┘
```

- **One process handles many sessions.** Each session id gets its own
  `AudioChunker` (so silence-cut chunk boundaries never mix across
  stages/rooms) and its own `TranscriptionPipeline` (so caption ordering and
  the rolling text context used for continuity stay session-scoped), sharing
  one `Transcriber` adapter instance since the adapter itself is stateless
  per call.
- **Hexagonal-ish layout**: `src/captions/domain` (types, ports),
  `src/captions/application` (chunking, bus, registry, pipeline — no I/O),
  `src/captions/infrastructure` (WS/HTTP server, mock/Gemini adapters, WAV
  helpers), `src/main.ts` (composition root).
- **`Transcriber` port**: `transcribe({ pcm, sampleRate: 16000, context }) =>
  { text, lang, es, en }`. Swap the adapter to run fully offline (see
  "Local/offline alternative" below) without touching anything else.

## Quick start

Requires Node 22+.

```bash
npm install
npm test          # vitest, no network calls
npm run typecheck
```

### Mock mode (no API key, deterministic demo captions)

```bash
TRANSCRIBER=mock npm start
# -> http://localhost:3000/          audience viewer
# -> http://localhost:3000/stage.html operator page (needs a real mic)
```

To see captions flow without a microphone, stream a WAV file into one or more
simulated sessions in another terminal:

```bash
npm run simulate -- path/to/audio.wav --sessions main-stage,room-a,room-b
```

`simulate.ts` requires **16 kHz mono PCM16** WAV input and loops the file
forever. If your file isn't in that format, convert it first:

```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -c:a pcm_s16le audio.wav
```

### Gemini mode (real transcription + translation)

```bash
cp .env.example .env   # fill in GEMINI_API_KEY
export $(grep -v '^#' .env | xargs)
npm start
```

`TRANSCRIBER` defaults to `gemini` automatically once `GEMINI_API_KEY` is set
(set `TRANSCRIBER=mock` explicitly to keep using the mock adapter even with a
key present). Open `stage.html` on the machine/device with the mixer or
microphone feed for a room, and `index.html` for the audience.

### Docker

```bash
docker compose up --build
# TRANSCRIBER, GEMINI_API_KEY, GEMINI_MODEL, SESSIONS, PORT all pass through
# from your shell environment or a .env file (see docker-compose.yml).
```

## Running a real conference

- One laptop (or the room's own mixer output) per stage/room runs
  `stage.html`, pointed at that room's unique session id (e.g. `room-a`).
  Feed it the room's audio mix, not raw crowd noise, for best results.
- The audience opens `index.html` (e.g. via a QR code at the entrance),
  picks their room and preferred language (original / Español / English).
  Their choice is remembered (`localStorage`) and shareable via
  `?session=room-a&lang=es` deep links.
- A "projector mode" toggle on the viewer hides the chrome and goes
  fullscreen, for a screen mounted next to the stage.
- Sessions are created automatically on first audio ingest, and can also be
  pre-declared via the `SESSIONS` env var so they show up in the pickers
  before anyone starts talking.

## Scaling notes

- A single Node process comfortably handles many parallel sessions: the
  per-session state (chunker + pipeline) is a few small objects, and
  transcription calls for different sessions run concurrently (only calls
  *within* the same session are serialized, to keep caption order correct).
- Beyond one process/machine, shard by session id (e.g. consistent hashing
  across N instances behind a load balancer, or route each room's
  `stage.html`/`index.html` to a dedicated instance/URL). No shared state is
  required between shards.
- **Latency** is roughly `chunk duration (2.5–6s, silence-cut) + model
  latency`. Shortening `minDurationMs`/`maxDurationMs` trades latency for
  more, shorter model calls (and cost).
- **Cost** scales with the number of chunks transcribed, i.e. with total
  speaking time across sessions, not with audience size (the audience only
  reads from the WebSocket/HTTP API, it never touches the model).

## Load testing

`scripts/simulate.ts` streams audio into sessions but measures nothing.
`scripts/bench.ts` does the same streaming, but also subscribes to each
session's captions and reports end-to-end latency, so you can find out how
many parallel rooms one process sustains — without spending on Gemini.

### 1. Run with simulated model latency

Point the server at `MockTranscriber` with a realistic simulated latency
(and optional jitter) instead of Gemini's real (and billed) response time:

```bash
TRANSCRIBER=mock MOCK_LATENCY_MS=1500 MOCK_LATENCY_JITTER_MS=300 npm start
```

`MOCK_LATENCY_MS`/`MOCK_LATENCY_JITTER_MS` default to `0` (instant, the old
behavior) and fall back to `0` on invalid or negative input. The simulated
delay per transcription call is `max(0, latencyMs + jitter)`.

### 2. Run the bench

In another terminal:

```bash
npm run bench -- path/to/audio.wav --sessions 20 --duration 120 \
  --host localhost:3000 --max-drift 500
```

- `--sessions` accepts a count (`20` -> sessions `bench-1..bench-20`) or an
  explicit comma-separated list (`room-a,room-b`).
- `--duration` is the run length in seconds (default `60`); the WAV loops for
  that long per session.
- `--max-drift` is the backlog threshold in ms of extra latency per minute
  (default `500`).
- Like `simulate.ts`, the WAV must be 16 kHz mono PCM16 (same `ffmpeg`
  conversion as above).

The bench opens each session's `/captions/:session` WebSocket *before*
streaming audio, records `latency = receivedAt - chunkTs` for every caption
(`chunkTs` is stamped when the audio chunk was cut and enqueued, not when the
caption was published), waits a short grace period after streaming stops for
in-flight captions, then prints a per-session and overall report:

```
session         count   p50ms   p95ms   maxms  drift(ms/min)  verdict
bench-1            34    1510    1830    1920            4.2       ok
bench-2            33    1490    1795    1901            3.8       ok

Overall: count=67 p50=1500ms p95=1810ms max=1920ms drift=4.0ms/min (threshold 500ms/min) ok
```

### Reading the report

- `p50`/`p95`/`max` are steady-state latency: queue wait + model latency +
  delivery. With mock latency and no backlog these should hover near the
  configured `MOCK_LATENCY_MS`.
- `driftMsPerMin` is the least-squares slope of latency over elapsed time. A
  value near 0 means captions keep pace; a large positive value means the
  per-session pipeline (which serializes transcription calls) can't keep up
  and captions are progressively falling behind.
- A session (or the overall row) is flagged `BACKLOG` when its drift exceeds
  `--max-drift`, and the process exits non-zero — useful as a capacity gate.
  To reproduce backlog deliberately, set `MOCK_LATENCY_MS` above the chunk
  duration (`AudioChunker`'s `maxDurationMs`, 6000ms by default): each chunk
  then takes longer to transcribe than it took to record, so the queue grows
  without bound.

### Real Gemini load runs

Running the bench with `TRANSCRIBER=gemini` sends real audio to Google's API
and **costs money** per chunk transcribed, and may hit per-key rate limits
well before it hits any limit of this process. Prefer the mock-latency runs
above for capacity planning; only run against real Gemini deliberately, with
a small number of sessions/duration, and watch for rate-limit errors in the
server logs.

## Local/offline alternative

The `Transcriber` port is the only integration point a model needs to
satisfy: `transcribe({ pcm, sampleRate, context }) => Promise<{ text, lang,
es, en }>`. Swapping Gemini for a local model (e.g. Whisper for transcription
+ a local translation model, or a multimodal local model like Gemma that can
do both in one call) means writing one new adapter in
`src/captions/infrastructure/`, with no changes to the chunker, pipeline,
bus, registry, server, or frontend.

## Privacy note

Audio is processed in short chunks (a few seconds) and only the resulting
text captions are kept (bounded recent history per session, in memory, not
persisted to disk). In Gemini mode, each chunk is sent to Google's API under
your own `GEMINI_API_KEY`; nothing else is sent. There is no user
authentication or tracking — the viewer only reveals which sessions exist and
their live/caption-count status, never who is watching.

## License

Apache-2.0. See [LICENSE](./LICENSE).
