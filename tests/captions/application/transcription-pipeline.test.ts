import { describe, expect, it, vi } from "vitest";
import { TranscriptionPipeline } from "../../../src/captions/application/transcription-pipeline.js";
import { CaptionBus } from "../../../src/captions/application/caption-bus.js";
import type { Transcriber, TranscribeInput, TranscribeResult } from "../../../src/captions/domain/transcriber.js";

function chunkOf(pcm = new Int16Array(4)): { pcm: Int16Array; sampleRate: 16000 } {
  return { pcm, sampleRate: 16000 };
}

describe("TranscriptionPipeline", () => {
  it("publishes a caption built from the transcriber result", async () => {
    const bus = new CaptionBus();
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => ({ text: "hello", lang: "en", es: "hola", en: "hello" }))
    };
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage" });

    await pipeline.enqueue(chunkOf());

    const history = bus.history("main-stage");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sessionId: "main-stage",
      text: "hello",
      lang: "en",
      translations: { es: "hola", en: "hello" },
      final: true,
      seq: 0
    });
  });

  it("does not publish a caption when the transcriber returns empty text", async () => {
    const bus = new CaptionBus();
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => ({ text: "", lang: "en", es: "", en: "" }))
    };
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage" });

    await pipeline.enqueue(chunkOf());

    expect(bus.history("main-stage")).toHaveLength(0);
  });

  it("passes a rolling context of the last captions to the transcriber", async () => {
    const bus = new CaptionBus();
    const seen: string[] = [];
    const transcriber: Transcriber = {
      transcribe: vi.fn(async (input: TranscribeInput): Promise<TranscribeResult> => {
        seen.push(input.context);
        return { text: `line-${seen.length}`, lang: "en", es: `linea-${seen.length}`, en: `line-${seen.length}` };
      })
    };
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", contextSize: 2 });

    await pipeline.enqueue(chunkOf());
    await pipeline.enqueue(chunkOf());
    await pipeline.enqueue(chunkOf());

    expect(seen[0]).toBe("");
    expect(seen[1]).toContain("line-1");
    expect(seen[2]).toContain("line-2");
  });

  it("processes chunks for the same session strictly in order", async () => {
    const bus = new CaptionBus();
    const order: number[] = [];
    let call = 0;
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => {
        const n = ++call;
        // Later calls resolve faster, to prove ordering is preserved despite that.
        await new Promise((resolve) => setTimeout(resolve, n === 1 ? 20 : 1));
        order.push(n);
        return { text: `t${n}`, lang: "en", es: `t${n}`, en: `t${n}` };
      })
    };
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage" });

    const p1 = pipeline.enqueue(chunkOf());
    const p2 = pipeline.enqueue(chunkOf());
    const p3 = pipeline.enqueue(chunkOf());
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
    expect(bus.history("main-stage").map((c) => c.seq)).toEqual([0, 1, 2]);
  });

  it("logs a transcription error and continues processing the next chunk", async () => {
    const bus = new CaptionBus();
    const logger = { error: vi.fn() };
    let call = 0;
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => {
        call++;
        if (call === 1) throw new Error("boom");
        return { text: "recovered", lang: "en", es: "recuperado", en: "recovered" };
      })
    };
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", logger });

    await pipeline.enqueue(chunkOf());
    await pipeline.enqueue(chunkOf());

    expect(logger.error).toHaveBeenCalledTimes(1);
    const history = bus.history("main-stage");
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe("recovered");
  });

  it("stamps chunkTs with the enqueue-time value of now(), distinct from the later publish-time ts", async () => {
    const bus = new CaptionBus();
    let now = 1000;
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => {
        // Simulate model latency elapsing between enqueue and publish.
        now = 9000;
        return { text: "hello", lang: "en", es: "hola", en: "hello" };
      })
    };
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", now: () => now });

    await pipeline.enqueue(chunkOf());

    const [caption] = bus.history("main-stage");
    expect(caption.chunkTs).toBe(1000);
    expect(caption.ts).toBe(9000);
  });
});
