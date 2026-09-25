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

  it("checks trailing silence across frame boundaries with many small frames", () => {
    const chunker = new AudioChunker({
      sampleRate: SAMPLE_RATE,
      minDurationMs: 2500,
      maxDurationMs: 6000,
      trailingSilenceMs: 400,
      silenceRmsThreshold: 500
    });
    const frames: Int16Array[] = [];
    const push = (frame: Int16Array) => {
      frames.push(frame);
      return chunker.push(frame);
    };

    // 2.6s of speech in 100ms frames, the way the WebSocket ingest delivers audio.
    for (let i = 0; i < 26; i++) {
      expect(push(toneFrame(samplesFor(100)))).toBeNull();
    }
    // 300ms of silence: the 400ms window still reaches 100ms into the speech.
    expect(push(silenceFrame(samplesFor(150)))).toBeNull();
    expect(push(silenceFrame(samplesFor(150)))).toBeNull();
    // 450ms of silence: the window now spans only part of the first silence frame.
    const result = push(silenceFrame(samplesFor(150)));

    const expected = new Int16Array(frames.reduce((sum, frame) => sum + frame.length, 0));
    let offset = 0;
    for (const frame of frames) {
      expected.set(frame, offset);
      offset += frame.length;
    }
    expect(result).toEqual(expected);
  });

  it("reads trailing silence from the end of a frame that mixes speech and silence", () => {
    const options = {
      sampleRate: SAMPLE_RATE,
      minDurationMs: 2500,
      maxDurationMs: 6000,
      trailingSilenceMs: 400,
      silenceRmsThreshold: 500
    };
    const concat = (...parts: Int16Array[]) => {
      const out = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    };

    // Speech then silence inside one frame: only the trailing 400ms is silent.
    const endsSilent = new AudioChunker(options);
    expect(endsSilent.push(toneFrame(samplesFor(2600)))).toBeNull();
    expect(endsSilent.push(concat(toneFrame(samplesFor(300)), silenceFrame(samplesFor(400))))).not.toBeNull();

    // Silence then speech inside one frame: the trailing 400ms is not silent.
    const endsSpeaking = new AudioChunker(options);
    expect(endsSpeaking.push(toneFrame(samplesFor(2600)))).toBeNull();
    expect(endsSpeaking.push(concat(silenceFrame(samplesFor(400)), toneFrame(samplesFor(300))))).toBeNull();
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
