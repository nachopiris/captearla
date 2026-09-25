import type { Caption } from "../domain/caption.js";
import type { Transcriber, TranscribeResult } from "../domain/transcriber.js";
import type { CaptionBus } from "./caption-bus.js";

export interface TranscriptionPipelineDeps {
  transcriber: Transcriber;
  bus: CaptionBus;
  sessionId: string;
  /** Number of recent caption texts kept as rolling context. Default 2. */
  contextSize?: number;
  /**
   * Max number of concurrent `transcriber.transcribe` calls for this
   * session. Default 3. `1` reproduces the fully serial behavior from
   * before bounded concurrency was introduced.
   */
  maxInFlight?: number;
  now?: () => number;
  idGenerator?: () => string;
  logger?: { error: (message: string, error: unknown) => void };
}

let fallbackIdCounter = 0;

function defaultId(): string {
  fallbackIdCounter += 1;
  return `cap-${Date.now()}-${fallbackIdCounter}`;
}

export interface AudioChunkInput {
  pcm: Int16Array | Buffer;
  sampleRate: 16000;
}

interface PendingTask {
  chunk: AudioChunkInput;
  chunkTs: number;
  arrivalIndex: number;
  resolveEnqueue: () => void;
}

type TranscribeOutcome = { ok: true; result: TranscribeResult } | { ok: false; error: unknown };

interface SettledEntry {
  chunkTs: number;
  resolveEnqueue: () => void;
  outcome: TranscribeOutcome;
}

/**
 * Per-session pipeline that transcribes audio chunks with up to
 * `maxInFlight` `transcriber.transcribe` calls running concurrently, while
 * still publishing the resulting captions on the bus in strict chunk
 * arrival order: a faster later chunk can finish transcribing ahead of an
 * earlier, slower one, but its caption is only published once every earlier
 * chunk has itself been published or skipped. Keeps a rolling text context
 * of the latest *published* captions for continuity, so under load context
 * can lag by up to `maxInFlight - 1` chunks; `maxInFlight: 1` keeps it
 * identical to today's serial behavior. Transcription errors and
 * empty-text results are logged/skipped without stalling later chunks, and
 * `enqueue()` never rejects.
 */
export class TranscriptionPipeline {
  private readonly contextSize: number;
  private readonly maxInFlight: number;
  private seq = 0;
  private contextHistory: string[] = [];

  private nextArrivalIndex = 0;
  private nextPublishIndex = 0;
  private inFlight = 0;
  private readonly pending: PendingTask[] = [];
  private readonly settled = new Map<number, SettledEntry>();

  constructor(private readonly deps: TranscriptionPipelineDeps) {
    this.contextSize = deps.contextSize ?? 2;
    this.maxInFlight = Math.max(1, Math.floor(deps.maxInFlight ?? 3));
  }

  enqueue(chunk: AudioChunkInput): Promise<void> {
    // Captured synchronously, at the moment the chunk is cut and handed
    // off, not when it eventually gets dispatched or published.
    const chunkTs = this.deps.now?.() ?? Date.now();
    const arrivalIndex = this.nextArrivalIndex++;
    const promise = new Promise<void>((resolve) => {
      this.pending.push({ chunk, chunkTs, arrivalIndex, resolveEnqueue: resolve });
    });
    this.dispatchAvailable();
    return promise;
  }

  /** Starts transcribing queued chunks FIFO until `maxInFlight` calls are running. */
  private dispatchAvailable(): void {
    while (this.inFlight < this.maxInFlight && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) break;
      this.inFlight++;
      // Context reflects only what has been published so far, not chunks
      // still in flight or waiting.
      const context = this.contextHistory.join(" ");
      void this.runTranscribe(task, context);
    }
  }

  private async runTranscribe(task: PendingTask, context: string): Promise<void> {
    let outcome: TranscribeOutcome;
    try {
      const result = await this.deps.transcriber.transcribe({
        pcm: task.chunk.pcm,
        sampleRate: task.chunk.sampleRate,
        context
      });
      outcome = { ok: true, result };
    } catch (error) {
      outcome = { ok: false, error };
    }

    // The slot frees as soon as the call settles, not when its caption
    // publishes, so a slow head-of-line chunk doesn't cap throughput below
    // maxInFlight.
    this.inFlight--;
    this.settled.set(task.arrivalIndex, { chunkTs: task.chunkTs, resolveEnqueue: task.resolveEnqueue, outcome });
    this.publishReady();
    this.dispatchAvailable();
  }

  /** Flushes the reorder buffer strictly in chunk arrival order. */
  private publishReady(): void {
    let entry = this.settled.get(this.nextPublishIndex);
    while (entry) {
      this.settled.delete(this.nextPublishIndex);
      this.nextPublishIndex++;
      this.finalize(entry);
      entry = this.settled.get(this.nextPublishIndex);
    }
  }

  private finalize(entry: SettledEntry): void {
    const { outcome, chunkTs, resolveEnqueue } = entry;

    if (!outcome.ok) {
      this.deps.logger?.error(`Transcription failed for session "${this.deps.sessionId}"`, outcome.error);
      resolveEnqueue();
      return;
    }

    const result = outcome.result;
    if (!result.text.trim()) {
      resolveEnqueue();
      return;
    }

    const caption: Caption = {
      id: this.deps.idGenerator?.() ?? defaultId(),
      sessionId: this.deps.sessionId,
      seq: this.seq++,
      text: result.text,
      lang: result.lang,
      translations: { es: result.es, en: result.en },
      final: true,
      ts: this.deps.now?.() ?? Date.now(),
      chunkTs
    };

    this.contextHistory.push(result.text);
    if (this.contextHistory.length > this.contextSize) {
      this.contextHistory.shift();
    }

    this.deps.bus.publish(caption);
    resolveEnqueue();
  }
}
