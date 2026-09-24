import type { Transcriber } from "../domain/transcriber.js";
import { AudioChunker, type AudioChunkerOptions } from "./audio-chunker.js";
import { CaptionBus } from "./caption-bus.js";
import { TranscriptionPipeline } from "./transcription-pipeline.js";

export interface SessionPipelineManagerDeps {
  bus: CaptionBus;
  transcriber: Transcriber;
  chunkerOptions?: AudioChunkerOptions;
  contextSize?: number;
  logger?: { error: (message: string, error: unknown) => void };
}

/**
 * Wires per-session audio chunking to per-session ordered transcription.
 * Each session gets its own AudioChunker (so silence-cut boundaries don't mix
 * across stages) and its own TranscriptionPipeline (so ordering and rolling
 * context stay session-scoped), while sharing one Transcriber instance since
 * the adapters themselves hold no per-session state.
 */
export class SessionPipelineManager {
  private readonly chunkers = new Map<string, AudioChunker>();
  private readonly pipelines = new Map<string, TranscriptionPipeline>();

  constructor(private readonly deps: SessionPipelineManagerDeps) {}

  /** Feed the next PCM16 mono frame for a session. Resolves once any resulting chunk is enqueued. */
  ingest(sessionId: string, frame: Int16Array): Promise<void> {
    const chunker = this.chunkerFor(sessionId);
    const chunk = chunker.push(frame);
    if (!chunk) {
      return Promise.resolve();
    }
    return this.pipelineFor(sessionId).enqueue({ pcm: chunk, sampleRate: 16000 });
  }

  private chunkerFor(sessionId: string): AudioChunker {
    let chunker = this.chunkers.get(sessionId);
    if (!chunker) {
      chunker = new AudioChunker(this.deps.chunkerOptions);
      this.chunkers.set(sessionId, chunker);
    }
    return chunker;
  }

  private pipelineFor(sessionId: string): TranscriptionPipeline {
    let pipeline = this.pipelines.get(sessionId);
    if (!pipeline) {
      pipeline = new TranscriptionPipeline({
        transcriber: this.deps.transcriber,
        bus: this.deps.bus,
        sessionId,
        contextSize: this.deps.contextSize,
        logger: this.deps.logger
      });
      this.pipelines.set(sessionId, pipeline);
    }
    return pipeline;
  }
}
