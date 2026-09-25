# Captearla

> So nobody misses the talk.

Open source, real-time captioning for conferences: live stage audio in, live
captions out — in the original language plus Spanish and English — for as
many parallel rooms as you have stages. Built for the Nerdearla Vibeathon
2026.

A single Node process serves three things:

| URL | Who uses it |
| --- | --- |
| `/` | Landing page: choose Stage or Viewer |
| `/stage.html` | One operator per room, on the device with the room's audio feed |
| `/viewer.html` | The audience: pick a room and a language |
| `/api/sessions` | Health check / session list |

## Before you deploy

You need:

- A **Gemini API key** ([Google AI Studio](https://aistudio.google.com/apikey)).
  Without it the server runs a mock transcriber that emits fake captions.
- A **stage token**: a shared secret the room operators type into the stage
  page. Without it, anyone who finds the URL can send audio and spend your
  Gemini quota.

  ```bash
  openssl rand -hex 24
  ```

- **HTTPS** on the public URL. Browsers only allow microphone access on
  secure origins, so the stage page will not work over plain HTTP (except
  on `localhost`).

## Deploy to Fly.io (recommended)

`fly.toml` is ready: one always-on machine in `gru` (São Paulo), HTTPS
forced, health check on `/api/sessions`.

```bash
fly auth login
fly apps create captearla            # if taken, pick another name and update `app` in fly.toml
fly secrets set GEMINI_API_KEY=... STAGE_TOKEN=$(openssl rand -hex 24)
fly deploy --ha=false
```

Your app is live at `https://<app>.fly.dev`. Keep the stage token somewhere
you can share with the room operators (`fly secrets` does not show it back).

To change the rooms shown before anyone starts talking, edit `SESSIONS` under
`[env]` in `fly.toml` and redeploy.

> **Keep it to one machine.** Sessions and captions live in memory, so two
> machines would split rooms between them. `--ha=false` and
> `min_machines_running = 1` take care of that; do not `fly scale count` up.

## Deploy with Docker

Anywhere you can run a container behind an HTTPS reverse proxy (Caddy,
nginx, a cloud load balancer):

```bash
cp .env.example .env    # fill in GEMINI_API_KEY and STAGE_TOKEN
docker compose up -d --build
```

The container listens on port `3000` (override the host port with `PORT`).
Put the proxy in front and make sure it forwards WebSocket upgrades on
`/ingest/*` and `/captions/*`.

Without compose:

```bash
docker build -t captearla .
docker run -d -p 3000:3000 --env-file .env --restart unless-stopped captearla
```

## Run without Docker

Requires Node 22+.

```bash
npm ci
cp .env.example .env    # fill in GEMINI_API_KEY and STAGE_TOKEN
export $(grep -v '^#' .env | xargs)
npm start
```

## Configuration

All settings are environment variables (see `.env.example`).

| Variable | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Enables real transcription + translation |
| `STAGE_TOKEN` | — | Required `?token=` on audio ingest. Unset = open ingest (a warning is logged) |
| `SESSIONS` | `main-stage,room-a,room-b` | Rooms listed on the stage page before any audio arrives |
| `PORT` | `3000` | HTTP port |
| `TRANSCRIBER` | auto | `gemini` or `mock`. Empty = `gemini` when a key is set, else `mock` |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Model used for transcription + translation |
| `GEMINI_THINKING_LEVEL` | model's lowest | `minimal\|low\|medium\|high`, Gemini 3.x only |
| `TRANSCRIBE_MAX_IN_FLIGHT` | `3` | Concurrent model calls per room |

## On the day

1. **Per room**, open `https://<your-host>/stage.html` on the laptop that
   gets the room's audio mix (mixer output beats a mic pointed at the crowd).
   Pick the session id (e.g. `room-a`), optionally give it a display name
   (e.g. "Sala Principal"), enter the stage token, and start.
2. **For the audience**, share `https://<your-host>/viewer.html` (a QR code
   at the door works well). Deep links pre-select a room and language:
   `/viewer.html?session=room-a&lang=es` (old `/?session=` links still
   redirect to the viewer).
3. **For a screen next to the stage**, open the viewer and use projector
   mode (fullscreen, no chrome).

If the stage page shows "Connection rejected — check the stage token", the
token typed there does not match `STAGE_TOKEN`.

## Capacity and cost

- One process handles many rooms; the audience never touches the model, so
  **cost scales with speaking time, not with audience size**.
- Caption latency is roughly the chunk length (2.5–6 s) plus model latency.
- If you outgrow one machine, run one instance per group of rooms and point
  each room's stage and audience links at its instance. Instances share no
  state.
- To check capacity without spending on Gemini, run the server with
  `TRANSCRIBER=mock MOCK_LATENCY_MS=1500` and load it with
  `npm run bench -- audio.wav --sessions 20 --duration 120`
  (16 kHz mono PCM16 WAV; convert with
  `ffmpeg -i in.mp3 -ar 16000 -ac 1 -c:a pcm_s16le audio.wav`).

## Privacy

Audio is sent to Google's Gemini API in short chunks under your own key and
is never stored. Only recent caption text is kept, in memory. There are no
accounts and no tracking.

## Development

```bash
npm install
npm test            # no network calls
npm run typecheck
TRANSCRIBER=mock npm start
npm run simulate -- audio.wav --sessions main-stage,room-a   # fake stage audio
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
