import { describe, expect, it, vi } from "vitest";
import { MockTranscriber } from "../../../src/captions/infrastructure/mock-transcriber.js";
import type { TranscribeResult } from "../../../src/captions/domain/transcriber.js";

const chunk = { pcm: new Int16Array(10), sampleRate: 16000 as const, context: "" };

describe("MockTranscriber", () => {
  it("returns a deterministic bilingual result without any network access", async () => {
    const transcriber = new MockTranscriber();
    const result = await transcriber.transcribe(chunk);

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.lang).toBeTruthy();
    expect(result.es.length).toBeGreaterThan(0);
    expect(result.en.length).toBeGreaterThan(0);
  });

  it("cycles through canned sentences by call count", async () => {
    const transcriber = new MockTranscriber();
    const first = await transcriber.transcribe(chunk);
    const second = await transcriber.transcribe(chunk);

    expect(first.text).not.toBe(second.text);
  });

  it("wraps back to the first sentence after cycling through all of them", async () => {
    const transcriber = new MockTranscriber();
    const results: TranscribeResult[] = [];
    for (let i = 0; i < 20; i++) {
      results.push(await transcriber.transcribe(chunk));
    }

    // The sequence must repeat: some later call reproduces the very first result.
    const cycleLength = results.findIndex((r, i) => i > 0 && r.text === results[0].text);
    expect(cycleLength).toBeGreaterThan(0);
  });

  it("does not await any sleep when latencyMs and jitterMs are both zero (default)", async () => {
    const sleep = vi.fn(async () => {});
    const transcriber = new MockTranscriber({ sleep });

    await transcriber.transcribe(chunk);

    expect(sleep).not.toHaveBeenCalled();
  });

  it("awaits the injected sleep with the fixed latency when jitter is zero", async () => {
    const sleep = vi.fn(async () => {});
    const transcriber = new MockTranscriber({ latencyMs: 1500, jitterMs: 0, sleep });

    await transcriber.transcribe(chunk);

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1500);
  });

  it("applies jitter as max(0, latencyMs + (random()*2-1)*jitterMs)", async () => {
    const sleep = vi.fn(async () => {});
    // random() = 1 -> jitter term = (1*2-1)*jitterMs = +jitterMs
    const transcriberHigh = new MockTranscriber({ latencyMs: 1000, jitterMs: 200, random: () => 1, sleep });
    await transcriberHigh.transcribe(chunk);
    expect(sleep).toHaveBeenLastCalledWith(1200);

    // random() = 0 -> jitter term = (0*2-1)*jitterMs = -jitterMs
    const transcriberLow = new MockTranscriber({ latencyMs: 1000, jitterMs: 200, random: () => 0, sleep });
    await transcriberLow.transcribe(chunk);
    expect(sleep).toHaveBeenLastCalledWith(800);
  });

  it("clamps the delay to 0 when jitter would push it negative", async () => {
    const sleep = vi.fn(async () => {});
    const transcriber = new MockTranscriber({ latencyMs: 100, jitterMs: 500, random: () => 0, sleep });

    await transcriber.transcribe(chunk);

    expect(sleep).toHaveBeenCalledWith(0);
  });
});
