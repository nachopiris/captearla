import { describe, expect, it, vi } from "vitest";
import { SessionPipelineManager } from "../../../src/captions/application/session-pipeline-manager.js";
import { CaptionBus } from "../../../src/captions/application/caption-bus.js";
import type { Transcriber } from "../../../src/captions/domain/transcriber.js";

const SAMPLE_RATE = 16000;

function silence(samples: number): Int16Array {
  return new Int16Array(samples);
}

function tone(samples: number, amplitude = 12000): Int16Array {
  const frame = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    frame[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE));
  }
  return frame;
}

function samplesFor(ms: number): number {
  return Math.round((SAMPLE_RATE * ms) / 1000);
}

function fakeTranscriber(): Transcriber {
  return {
    transcribe: vi.fn(async () => ({ text: "spoken text", lang: "en", es: "texto hablado", en: "spoken text" }))
  };
}

describe("SessionPipelineManager", () => {
  it("emits a caption on the bus once a session's chunker produces a chunk", async () => {
    const bus = new CaptionBus();
    const manager = new SessionPipelineManager({
      bus,
      transcriber: fakeTranscriber(),
      chunkerOptions: { sampleRate: SAMPLE_RATE, minDurationMs: 200, maxDurationMs: 500, trailingSilenceMs: 100, silenceRmsThreshold: 500 }
    });

    await manager.ingest("main-stage", tone(samplesFor(250)));
    await manager.ingest("main-stage", silence(samplesFor(150)));

    expect(bus.history("main-stage")).toHaveLength(1);
  });

  it("keeps separate chunkers and pipelines per session", async () => {
    const bus = new CaptionBus();
    const manager = new SessionPipelineManager({
      bus,
      transcriber: fakeTranscriber(),
      chunkerOptions: { sampleRate: SAMPLE_RATE, minDurationMs: 200, maxDurationMs: 500, trailingSilenceMs: 100, silenceRmsThreshold: 500 }
    });

    await manager.ingest("room-a", tone(samplesFor(250)));
    await manager.ingest("room-b", tone(samplesFor(100)));
    await manager.ingest("room-a", silence(samplesFor(150)));

    expect(bus.history("room-a")).toHaveLength(1);
    expect(bus.history("room-b")).toHaveLength(0);
  });

  it("does not emit anything for a frame that never accumulates past the minimum duration", async () => {
    const bus = new CaptionBus();
    const manager = new SessionPipelineManager({
      bus,
      transcriber: fakeTranscriber(),
      chunkerOptions: { sampleRate: SAMPLE_RATE, minDurationMs: 2500, maxDurationMs: 6000, trailingSilenceMs: 400, silenceRmsThreshold: 500 }
    });

    await manager.ingest("main-stage", tone(samplesFor(100)));

    expect(bus.history("main-stage")).toHaveLength(0);
  });
});
