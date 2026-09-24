import { describe, expect, it } from "vitest";
import { AudioChunker } from "../../../src/captions/application/audio-chunker.js";

const SAMPLE_RATE = 16000;

function toneFrame(samples: number, amplitude = 12000): Int16Array {
  const frame = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    frame[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE));
  }
  return frame;
}

function silenceFrame(samples: number): Int16Array {
  return new Int16Array(samples);
}

function samplesFor(ms: number): number {
  return Math.round((SAMPLE_RATE * ms) / 1000);
}

describe("AudioChunker", () => {
  it("does not emit a chunk before the minimum duration is reached", () => {
    const chunker = new AudioChunker({ sampleRate: SAMPLE_RATE });
    const result = chunker.push(toneFrame(samplesFor(500)));
    expect(result).toBeNull();
  });

  it("emits a chunk once past minimum duration and trailing silence is detected", () => {
    const chunker = new AudioChunker({
      sampleRate: SAMPLE_RATE,
      minDurationMs: 2500,
      maxDurationMs: 6000,
      trailingSilenceMs: 400,
      silenceRmsThreshold: 500
    });

    // 2.6s of speech, then 0.5s of silence -> should flush with trailing silence.
    expect(chunker.push(toneFrame(samplesFor(2600)))).toBeNull();
    const result = chunker.push(silenceFrame(samplesFor(500)));

    expect(result).not.toBeNull();
    expect(result!.length).toBe(samplesFor(2600) + samplesFor(500));
  });

  it("force-flushes at the maximum duration even without trailing silence", () => {
    const chunker = new AudioChunker({
      sampleRate: SAMPLE_RATE,
      minDurationMs: 2500,
      maxDurationMs: 6000,
      trailingSilenceMs: 400,
      silenceRmsThreshold: 500
    });

    expect(chunker.push(toneFrame(samplesFor(3000)))).toBeNull();
    expect(chunker.push(toneFrame(samplesFor(2900)))).toBeNull();
    const result = chunker.push(toneFrame(samplesFor(200)));

    expect(result).not.toBeNull();
    expect(result!.length).toBe(samplesFor(3000) + samplesFor(2900) + samplesFor(200));
  });

  it("skips emitting a chunk that is entirely silence", () => {
    const chunker = new AudioChunker({
      sampleRate: SAMPLE_RATE,
      minDurationMs: 500,
      maxDurationMs: 1000,
      trailingSilenceMs: 200,
      silenceRmsThreshold: 500
    });

    expect(chunker.push(silenceFrame(samplesFor(600)))).toBeNull();
    const result = chunker.push(silenceFrame(samplesFor(500)));

    expect(result).toBeNull();
  });

  it("resets its buffer after flushing so the next chunk starts empty", () => {
    const chunker = new AudioChunker({
      sampleRate: SAMPLE_RATE,
      minDurationMs: 500,
      maxDurationMs: 1000,
      trailingSilenceMs: 200,
      silenceRmsThreshold: 500
    });

    chunker.push(toneFrame(samplesFor(600)));
    chunker.push(silenceFrame(samplesFor(300)));

    // Immediately after the flush, a tiny frame should not be enough to flush again.
    const result = chunker.push(toneFrame(samplesFor(50)));
    expect(result).toBeNull();
  });
});
