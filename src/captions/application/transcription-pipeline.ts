import type { Caption } from "../domain/caption.js";
import type { Transcriber } from "../domain/transcriber.js";
import type { CaptionBus } from "./caption-bus.js";

export interface TranscriptionPipelineDeps {
  transcriber: Transcriber;
  bus: CaptionBus;
  sessionId: string;
  /** Number of recent caption texts kept as rolling context. Default 2. */
  contextSize?: number;
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

/**
 * Per-session pipeline that transcribes audio chunks in strict arrival order
 * (chunks are queued so a slower earlier call never lets a later one publish
 * first), keeps a rolling text context for continuity, and publishes
 * resulting captions on the bus. Transcription errors are logged and do not
 * stop the session's pipeline.
 */
export class TranscriptionPipeline {
  private readonly contextSize: number;
  private seq = 0;
  private contextHistory: string[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TranscriptionPipelineDeps) {
    this.contextSize = deps.contextSize ?? 2;
  }

  enqueue(chunk: AudioChunkInput): Promise<void> {
    // Captured synchronously, at the moment the chunk is cut and handed off,
    // not when it eventually gets processed or published.
    const chunkTs = this.deps.now?.() ?? Date.now();
    const next = this.queue.then(() => this.process(chunk, chunkTs));
    // Keep the queue alive even if this chunk's processing failed, so later
    // chunks are still attempted; failures are already caught in process().
    this.queue = next;
    return next;
  }

  private async process(chunk: AudioChunkInput, chunkTs: number): Promise<void> {
    try {
      const result = await this.deps.transcriber.transcribe({
        pcm: chunk.pcm,
        sampleRate: chunk.sampleRate,
        context: this.contextHistory.join(" ")
      });

      if (!result.text.trim()) {
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
    } catch (error) {
      this.deps.logger?.error(`Transcription failed for session "${this.deps.sessionId}"`, error);
    }
  }
}
