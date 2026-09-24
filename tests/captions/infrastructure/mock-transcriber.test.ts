import { describe, expect, it } from "vitest";
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
});
