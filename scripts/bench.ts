#!/usr/bin/env -S node --experimental-strip-types
// Load bench: streams a 16 kHz mono PCM16 WAV file, looped, into N parallel
// sessions for a fixed duration, subscribes to each session's caption
// WebSocket, and measures end-to-end latency (receivedAt - chunkTs) per
// caption. Prints a per-session + overall report and exits non-zero if any
// session shows backlog (latency growing over the run), so it can gate a CI
// or manual capacity check.
//
// Usage:
//   npm run bench -- path/to/audio.wav --sessions 5 --duration 60 \
//     --host localhost:3000 --max-drift 500
//
// CLI/WebSocket glue only; the latency math lives in bench-stats.ts (unit
// tested). See README.md "Load testing" for how to read the report.

import { readFileSync } from "node:fs";
import type WebSocket from "ws";
import { parseWavPcm16 } from "../src/captions/infrastructure/wav-to-pcm.js";
import { sliceFrames, connectWebSocket, sleep } from "./stream-helpers.js";
import {
  summarize,
  isBacklogging,
  DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN,
  type LatencySample
} from "./bench-stats.js";

const FRAME_MS = 100;
const EXPECTED_SAMPLE_RATE = 16000;
const DEFAULT_DURATION_SEC = 60;
/** How long to keep listening for in-flight captions after streaming stops. */
const GRACE_MS = 10000;

interface BenchCliArgs {
  wavPath: string;
  sessions: string[];
  durationSec: number;
  host: string;
  maxDriftMsPerMin: number;
}

/** Accepts either a session count ("5" -> bench-1..bench-5) or an explicit comma-separated list. */
function parseSessionsArg(raw: string): string[] {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const count = Number(trimmed);
    return Array.from({ length: count }, (_, i) => `bench-${i + 1}`);
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): BenchCliArgs {
  const positional: string[] = [];
  let sessions = ["bench-1"];
  let durationSec = DEFAULT_DURATION_SEC;
  let host = process.env.CAPTEARLA_HOST ?? "localhost:3000";
  let maxDriftMsPerMin = DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sessions") {
      const parsed = parseSessionsArg(argv[++i] ?? "");
      sessions = parsed.length > 0 ? parsed : sessions;
    } else if (arg === "--duration") {
      const value = Number(argv[++i]);
      durationSec = Number.isFinite(value) && value > 0 ? value : DEFAULT_DURATION_SEC;
    } else if (arg === "--host") {
      host = argv[++i] ?? host;
    } else if (arg === "--max-drift") {
      const value = Number(argv[++i]);
      maxDriftMsPerMin = Number.isFinite(value) && value > 0 ? value : DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN;
    } else {
      positional.push(arg);
    }
  }

  const wavPath = positional[0];
  if (!wavPath) {
    throw new Error(
      "Usage: npm run bench -- <path/to/audio.wav> [--sessions N|a,b,c] " +
        "[--duration seconds] [--host host:port] [--max-drift ms/min]"
    );
  }

  return { wavPath, sessions, durationSec, host, maxDriftMsPerMin };
}

interface SessionResult {
  sessionId: string;
  samples: LatencySample[];
}

interface CaptionMessage {
  chunkTs?: number;
}

function parseCaptionMessage(data: WebSocket.RawData): CaptionMessage | null {
  try {
    const parsed = JSON.parse(data.toString());
    return typeof parsed === "object" && parsed !== null ? (parsed as CaptionMessage) : null;
  } catch {
    return null;
  }
}

async function runSession(
  host: string,
  sessionId: string,
  frames: Int16Array[],
  frameMs: number,
  durationMs: number,
  benchStartTs: number
): Promise<SessionResult> {
  const samples: LatencySample[] = [];

  // Subscribe to captions before streaming any audio, so we never miss one.
  const captionsSocket = await connectWebSocket(`ws://${host}/captions/${encodeURIComponent(sessionId)}`);
  captionsSocket.on("message", (data) => {
    const caption = parseCaptionMessage(data);
    // History captions sent right on connect (or anything from before this
    // run started) are not this run's data; ignore them.
    if (!caption || typeof caption.chunkTs !== "number" || caption.chunkTs < benchStartTs) {
      return;
    }
    samples.push({ elapsedMs: caption.chunkTs - benchStartTs, latencyMs: Date.now() - caption.chunkTs });
  });

  const ingestSocket = await connectWebSocket(`ws://${host}/ingest/${encodeURIComponent(sessionId)}`);
  console.log(`[bench:${sessionId}] connected, streaming for ${durationMs / 1000}s`);

  const streamDeadline = Date.now() + durationMs;
  streaming: while (Date.now() < streamDeadline) {
    for (const frame of frames) {
      if (Date.now() >= streamDeadline || ingestSocket.readyState !== ingestSocket.OPEN) {
        break streaming;
      }
      ingestSocket.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
      await sleep(frameMs);
    }
  }

  ingestSocket.close();
  console.log(`[bench:${sessionId}] streaming done, waiting ${GRACE_MS / 1000}s for in-flight captions`);
  await sleep(GRACE_MS);
  captionsSocket.close();

  return { sessionId, samples };
}

function formatRow(cells: string[], widths: number[]): string {
  return cells.map((cell, i) => cell.padStart(widths[i])).join("  ");
}

/** Prints the per-session and overall report. Returns true if any session is backlogging. */
function printReport(results: SessionResult[], maxDriftMsPerMin: number): boolean {
  const widths = [14, 6, 7, 7, 7, 14, 8];
  console.log("");
  console.log(
    formatRow(["session", "count", "p50ms", "p95ms", "maxms", "drift(ms/min)", "verdict"], widths)
  );

  let anyBacklog = false;
  const allSamples: LatencySample[] = [];

  for (const { sessionId, samples } of results) {
    allSamples.push(...samples);
    const summary = summarize(samples);
    const backlog = isBacklogging(summary.driftMsPerMin, maxDriftMsPerMin);
    anyBacklog = anyBacklog || backlog;
    console.log(
      formatRow(
        [
          sessionId,
          String(summary.count),
          summary.p50.toFixed(0),
          summary.p95.toFixed(0),
          summary.max.toFixed(0),
          summary.driftMsPerMin.toFixed(1),
          backlog ? "BACKLOG" : "ok"
        ],
        widths
      )
    );
  }

  const overall = summarize(allSamples);
  const overallBacklog = isBacklogging(overall.driftMsPerMin, maxDriftMsPerMin);
  console.log("");
  console.log(
    `Overall: count=${overall.count} p50=${overall.p50.toFixed(0)}ms p95=${overall.p95.toFixed(0)}ms ` +
      `max=${overall.max.toFixed(0)}ms drift=${overall.driftMsPerMin.toFixed(1)}ms/min ` +
      `(threshold ${maxDriftMsPerMin}ms/min) ${overallBacklog ? "BACKLOG" : "ok"}`
  );

  return anyBacklog;
}

async function main(): Promise<void> {
  const { wavPath, sessions, durationSec, host, maxDriftMsPerMin } = parseArgs(process.argv.slice(2));

  const buffer = readFileSync(wavPath);
  const wav = parseWavPcm16(buffer);

  if (wav.sampleRate !== EXPECTED_SAMPLE_RATE || wav.channels !== 1) {
    console.error(
      [
        `"${wavPath}" is ${wav.sampleRate} Hz / ${wav.channels}ch, but bench.ts requires 16 kHz mono PCM16.`,
        "Convert it first with ffmpeg, e.g.:",
        `  ffmpeg -i "${wavPath}" -ar 16000 -ac 1 -c:a pcm_s16le converted.wav`
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const frames = sliceFrames(wav.pcm, wav.sampleRate, FRAME_MS);
  console.log(`[bench] loaded ${wavPath}: ${wav.pcm.length} samples @ ${wav.sampleRate}Hz, ${frames.length} frames/loop`);
  console.log(
    `[bench] sessions: ${sessions.join(", ")} (ws://${host}), duration=${durationSec}s, max-drift=${maxDriftMsPerMin}ms/min`
  );

  const benchStartTs = Date.now();
  const durationMs = durationSec * 1000;

  const results = await Promise.all(
    sessions.map((sessionId) => runSession(host, sessionId, frames, FRAME_MS, durationMs, benchStartTs))
  );

  const anyBacklog = printReport(results, maxDriftMsPerMin);
  process.exitCode = anyBacklog ? 1 : 0;
}

main().catch((error) => {
  console.error("[bench] fatal error:", error);
  process.exitCode = 1;
});
