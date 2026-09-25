import { describe, expect, it, vi } from "vitest";
import { SessionPipelineManager } from "../../../src/captions/application/session-pipeline-manager.js";
import { CaptionBus } from "../../../src/captions/application/caption-bus.js";
import type { Transcriber, TranscribeResult } from "../../../src/captions/domain/transcriber.js";

/** A promise whose resolution is controlled manually from the test body. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

  it("forwards maxInFlight to the pipelines it creates", async () => {
    const bus = new CaptionBus();
    const deferreds = [deferred<TranscribeResult>(), deferred<TranscribeResult>()];
    let callCount = 0;
    const transcriber: Transcriber = {
      transcribe: vi.fn(() => deferreds[callCount++].promise)
    };
    const chunkerOptions = { sampleRate: SAMPLE_RATE, minDurationMs: 200, maxDurationMs: 500, trailingSilenceMs: 100, silenceRmsThreshold: 500 };
    const manager = new SessionPipelineManager({ bus, transcriber, chunkerOptions, maxInFlight: 1 });

    // Two chunk-cutting bursts fed back-to-back without awaiting in between,
    // so both would be dispatched immediately if maxInFlight weren't forwarded.
    const p1 = manager.ingest("main-stage", tone(samplesFor(250)));
    const p2 = manager.ingest("main-stage", silence(samplesFor(150)));
    const p3 = manager.ingest("main-stage", tone(samplesFor(250)));
    const p4 = manager.ingest("main-stage", silence(samplesFor(150)));

    expect(transcriber.transcribe).toHaveBeenCalledTimes(1);

    deferreds[0].resolve({ text: "a", lang: "en", es: "a", en: "a" });
    deferreds[1].resolve({ text: "b", lang: "en", es: "b", en: "b" });
    await Promise.all([p1, p2, p3, p4]);

    expect(transcriber.transcribe).toHaveBeenCalledTimes(2);
    expect(bus.history("main-stage")).toHaveLength(2);
  });
});
