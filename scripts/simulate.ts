#!/usr/bin/env -S node --experimental-strip-types
// Streams a 16 kHz mono PCM16 WAV file in real time into one or more
// sessions, looping forever, to demo many parallel sessions without needing
// a real microphone or multiple stages.
//
// Usage:
//   npm run simulate -- path/to/audio.wav --sessions main-stage,room-a,room-b
//
// If the WAV file is not 16 kHz mono, this exits with an explanation of how
// to convert it with ffmpeg (see README.md).

import { readFileSync } from "node:fs";
import type WebSocket from "ws";
import { parseWavPcm16 } from "../src/captions/infrastructure/wav-to-pcm.js";
import { sliceFrames, connectWebSocket, sleep } from "./stream-helpers.js";

const FRAME_MS = 100;
const EXPECTED_SAMPLE_RATE = 16000;

interface CliArgs {
  wavPath: string;
  sessions: string[];
  host: string;
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let sessions = ["main-stage"];
  let host = process.env.CAPTEARLA_HOST ?? "localhost:3000";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--sessions") {
      sessions = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--host") {
      host = argv[++i] ?? host;
    } else {
      positional.push(arg);
    }
  }

  const wavPath = positional[0];
  if (!wavPath) {
    throw new Error("Usage: npm run simulate -- <path/to/audio.wav> [--sessions a,b,c] [--host host:port]");
  }
  if (sessions.length === 0) {
    sessions = ["main-stage"];
  }

  return { wavPath, sessions, host };
}

async function streamSessionForever(host: string, sessionId: string, frames: Int16Array[], frameMs: number): Promise<void> {
  for (;;) {
    let socket: WebSocket;
    try {
      socket = await connectWebSocket(`ws://${host}/ingest/${encodeURIComponent(sessionId)}`);
    } catch (error) {
      console.error(`[simulate:${sessionId}] failed to connect, retrying in 2s:`, (error as Error).message);
      await sleep(2000);
      continue;
    }

    console.log(`[simulate:${sessionId}] connected, streaming ${frames.length} frames per loop`);

    for (const frame of frames) {
      if (socket.readyState !== socket.OPEN) break;
      socket.send(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
      await sleep(frameMs);
    }

    socket.close();
  }
}

async function main(): Promise<void> {
  const { wavPath, sessions, host } = parseArgs(process.argv.slice(2));

  const buffer = readFileSync(wavPath);
  const wav = parseWavPcm16(buffer);

  if (wav.sampleRate !== EXPECTED_SAMPLE_RATE || wav.channels !== 1) {
    console.error(
      [
        `"${wavPath}" is ${wav.sampleRate} Hz / ${wav.channels}ch, but simulate.ts requires 16 kHz mono PCM16.`,
        "Convert it first with ffmpeg, e.g.:",
        `  ffmpeg -i "${wavPath}" -ar 16000 -ac 1 -c:a pcm_s16le converted.wav`
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const frames = sliceFrames(wav.pcm, wav.sampleRate, FRAME_MS);
  console.log(`[simulate] loaded ${wavPath}: ${wav.pcm.length} samples @ ${wav.sampleRate}Hz, ${frames.length} frames/loop`);
  console.log(`[simulate] streaming into sessions: ${sessions.join(", ")} (ws://${host})`);

  await Promise.all(sessions.map((sessionId) => streamSessionForever(host, sessionId, frames, FRAME_MS)));
}

main().catch((error) => {
  console.error("[simulate] fatal error:", error);
  process.exitCode = 1;
});
