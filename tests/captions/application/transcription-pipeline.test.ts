import { describe, expect, it, vi } from "vitest";
import { TranscriptionPipeline } from "../../../src/captions/application/transcription-pipeline.js";
import { CaptionBus } from "../../../src/captions/application/caption-bus.js";
import type { Transcriber, TranscribeInput, TranscribeResult } from "../../../src/captions/domain/transcriber.js";

function chunkOf(pcm = new Int16Array(4)): { pcm: Int16Array; sampleRate: 16000 } {
  return { pcm, sampleRate: 16000 };
}

function result(text: string): TranscribeResult {
  return { text, lang: "en", es: text, en: text };
}

/** A promise whose resolution is controlled manually from the test body. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  it("processes chunks for the same session strictly in order when maxInFlight is 1", async () => {
    // maxInFlight: 1 forces strictly serial dispatch (today's behavior), so a
    // later chunk that resolves faster still cannot start before an earlier,
    // slower one settles. Concurrent dispatch is covered by the dedicated
    // "bounded concurrency" tests below, where dispatch order alone cannot
    // guarantee call order.
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
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", maxInFlight: 1 });

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

  it("logs a throwing caption listener and keeps ordered publish alive for later chunks", async () => {
    const bus = new CaptionBus();
    const logger = { error: vi.fn() };
    bus.subscribe("main-stage", (caption) => {
      if (caption.seq === 0) {
        throw new Error("listener boom");
      }
    });
    let call = 0;
    const transcriber: Transcriber = {
      transcribe: vi.fn(async () => result(`t${++call}`))
    };
    const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", logger });

    // The first chunk's enqueue promise must resolve even though its
    // caption listener throws.
    await pipeline.enqueue(chunkOf());

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Publishing caption failed for session "main-stage"', expect.any(Error));
    expect(bus.history("main-stage")).toHaveLength(1);

    // A later chunk must still publish normally.
    await pipeline.enqueue(chunkOf());

    const history = bus.history("main-stage");
    expect(history.map((c) => c.seq)).toEqual([0, 1]);
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

  describe("bounded concurrency", () => {
    it("honors the concurrency cap: a 4th call does not start until an earlier one settles", async () => {
      const bus = new CaptionBus();
      const deferreds = [deferred<TranscribeResult>(), deferred<TranscribeResult>(), deferred<TranscribeResult>(), deferred<TranscribeResult>()];
      let callCount = 0;
      const transcriber: Transcriber = {
        transcribe: vi.fn(() => deferreds[callCount++].promise)
      };
      const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", maxInFlight: 3 });

      const enqueued = [0, 1, 2, 3].map(() => pipeline.enqueue(chunkOf()));

      expect(transcriber.transcribe).toHaveBeenCalledTimes(3);

      deferreds[0].resolve(result("a"));
      await enqueued[0];

      expect(transcriber.transcribe).toHaveBeenCalledTimes(4);

      deferreds[1].resolve(result("b"));
      deferreds[2].resolve(result("c"));
      deferreds[3].resolve(result("d"));
      await Promise.all(enqueued);
    });

    it("publishes captions in chunk order even when later chunks resolve first", async () => {
      const bus = new CaptionBus();
      const deferreds = [deferred<TranscribeResult>(), deferred<TranscribeResult>(), deferred<TranscribeResult>()];
      let callCount = 0;
      const transcriber: Transcriber = {
        transcribe: vi.fn(() => deferreds[callCount++].promise)
      };
      const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", maxInFlight: 3 });

      const p0 = pipeline.enqueue(chunkOf());
      const p1 = pipeline.enqueue(chunkOf());
      const p2 = pipeline.enqueue(chunkOf());

      // Resolve out of arrival order: chunk 2 first, then chunk 1, then chunk 0.
      deferreds[2].resolve(result("c2"));
      deferreds[1].resolve(result("c1"));
      deferreds[0].resolve(result("c0"));

      await Promise.all([p0, p1, p2]);

      const history = bus.history("main-stage");
      expect(history.map((c) => c.text)).toEqual(["c0", "c1", "c2"]);
      expect(history.map((c) => c.seq)).toEqual([0, 1, 2]);
    });

    it("skips an error and an empty result in the middle without stalling later chunks, keeping seq contiguous", async () => {
      const bus = new CaptionBus();
      const logger = { error: vi.fn() };
      const outcomes: Array<() => Promise<TranscribeResult>> = [
        async () => result("first"),
        async () => {
          throw new Error("boom");
        },
        async () => result(""),
        async () => result("second")
      ];
      let call = 0;
      const transcriber: Transcriber = {
        transcribe: vi.fn(async () => outcomes[call++]())
      };
      const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", maxInFlight: 4, logger });

      const promises = [0, 1, 2, 3].map(() => pipeline.enqueue(chunkOf()));
      await Promise.all(promises);

      expect(logger.error).toHaveBeenCalledTimes(1);
      const history = bus.history("main-stage");
      expect(history.map((c) => c.text)).toEqual(["first", "second"]);
      expect(history.map((c) => c.seq)).toEqual([0, 1]);
    });

    it("maxInFlight: 1 stays fully serial and each call sees the previous published caption as context", async () => {
      const bus = new CaptionBus();
      const seenContext: string[] = [];
      const transcriber: Transcriber = {
        transcribe: vi.fn(async (input: TranscribeInput) => {
          seenContext.push(input.context);
          return result(`t${seenContext.length}`);
        })
      };
      const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", maxInFlight: 1, contextSize: 2 });

      const p0 = pipeline.enqueue(chunkOf());
      const p1 = pipeline.enqueue(chunkOf());
      const p2 = pipeline.enqueue(chunkOf());
      await Promise.all([p0, p1, p2]);

      expect(transcriber.transcribe).toHaveBeenCalledTimes(3);
      expect(seenContext[0]).toBe("");
      expect(seenContext[1]).toContain("t1");
      expect(seenContext[2]).toContain("t2");
    });

    it("dispatches concurrently sent chunks with context limited to already-published captions", async () => {
      const bus = new CaptionBus();
      const deferreds = [
        deferred<TranscribeResult>(),
        deferred<TranscribeResult>(),
        deferred<TranscribeResult>(),
        deferred<TranscribeResult>()
      ];
      const seenContext: string[] = [];
      let call = 0;
      const transcriber: Transcriber = {
        transcribe: vi.fn((input: TranscribeInput) => {
          seenContext.push(input.context);
          return deferreds[call++].promise;
        })
      };
      const pipeline = new TranscriptionPipeline({ transcriber, bus, sessionId: "main-stage", maxInFlight: 3, contextSize: 2 });

      const p0 = pipeline.enqueue(chunkOf());
      const p1 = pipeline.enqueue(chunkOf());
      const p2 = pipeline.enqueue(chunkOf());

      // All 3 fit under the concurrency cap and dispatch before any of them
      // publishes, so none has published context to offer yet.
      expect(seenContext).toEqual(["", "", ""]);

      deferreds[0].resolve(result("c0"));
      deferreds[1].resolve(result("c1"));
      deferreds[2].resolve(result("c2"));
      await Promise.all([p0, p1, p2]);

      const p3 = pipeline.enqueue(chunkOf());
      deferreds[3].resolve(result("c3"));
      await p3;

      expect(seenContext[3]).toBe("c1 c2");
    });
  });
});
