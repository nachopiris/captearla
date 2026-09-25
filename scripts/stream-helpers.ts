// Shared CLI/WebSocket glue for scripts/simulate.ts and scripts/bench.ts.
// This is I/O plumbing, not domain logic, so (like simulate.ts and bench.ts
// themselves) it is exempt from unit tests and only needs to typecheck.

import WebSocket from "ws";

/**
 * Slices a PCM16 mono buffer into fixed-duration frames, matching how a real
 * mic/mixer feed would arrive in small chunks over the ingest WebSocket.
 */
export function sliceFrames(pcm: Int16Array, sampleRate: number, frameMs: number): Int16Array[] {
  const samplesPerFrame = Math.round((sampleRate * frameMs) / 1000);
  const frames: Int16Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += samplesPerFrame) {
    frames.push(pcm.subarray(offset, Math.min(offset + samplesPerFrame, pcm.length)));
  }
  return frames;
}

/** Opens a WebSocket connection and resolves once it's open (or rejects on error). */
export function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
