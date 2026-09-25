export interface AudioChunkerOptions {
  /** Sample rate of the incoming PCM16 audio, in Hz. */
  sampleRate?: number;
  /** Minimum accumulated duration before a chunk can be flushed on silence. */
  minDurationMs?: number;
  /** Duration at which a chunk is force-flushed regardless of silence. */
  maxDurationMs?: number;
  /** Trailing window checked for silence to decide when to cut a chunk. */
  trailingSilenceMs?: number;
  /** RMS (0..32767) below which a window is considered silence. */
  silenceRmsThreshold?: number;
}

function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSquares += samples[i] * samples[i];
  }
  return Math.sqrt(sumSquares / samples.length);
}

function toSamples(sampleRate: number, ms: number): number {
  return Math.round((sampleRate * ms) / 1000);
}

/**
 * Accumulates PCM16 mono audio frames and emits a chunk when enough speech
 * has been captured and trailing silence is detected, or when the maximum
 * chunk duration is reached. Chunks that turn out to be entirely silence are
 * dropped rather than emitted.
 */
export class AudioChunker {
  private readonly minSamples: number;
  private readonly maxSamples: number;
  private readonly trailingSilenceSamples: number;
  private readonly silenceRmsThreshold: number;

  private segments: Int16Array[] = [];
  private totalSamples = 0;

  constructor(options: AudioChunkerOptions = {}) {
    const sampleRate = options.sampleRate ?? 16000;
    this.minSamples = toSamples(sampleRate, options.minDurationMs ?? 2500);
    this.maxSamples = toSamples(sampleRate, options.maxDurationMs ?? 6000);
    this.trailingSilenceSamples = toSamples(sampleRate, options.trailingSilenceMs ?? 400);
    this.silenceRmsThreshold = options.silenceRmsThreshold ?? 500;
  }

  /**
   * Feed the next frame of PCM16 mono audio. Returns the merged chunk when
   * one is ready to be transcribed, or `null` when more audio is needed (or
   * the accumulated audio was silence and was discarded).
   */
  push(frame: Int16Array): Int16Array | null {
    this.segments.push(frame);
    this.totalSamples += frame.length;

    if (this.totalSamples >= this.maxSamples) {
      return this.flush();
    }

    if (this.totalSamples >= this.minSamples && this.hasTrailingSilence()) {
      return this.flush();
    }

    return null;
  }

  private hasTrailingSilence(): boolean {
    const tail = this.tail(this.trailingSilenceSamples);
    return rms(tail) < this.silenceRmsThreshold;
  }

  /**
   * Copies only the last `samples` samples, walking segments from the end, so
   * the per-frame silence check costs O(window) instead of re-merging the
   * whole buffer (which made a chunk O(n²) in its frame count).
   */
  private tail(samples: number): Int16Array {
    const tail = new Int16Array(Math.min(samples, this.totalSamples));
    let remaining = tail.length;
    for (let i = this.segments.length - 1; i >= 0 && remaining > 0; i--) {
      const segment = this.segments[i];
      const take = Math.min(remaining, segment.length);
      remaining -= take;
      tail.set(segment.subarray(segment.length - take), remaining);
    }
    return tail;
  }

  private merge(): Int16Array {
    const merged = new Int16Array(this.totalSamples);
    let offset = 0;
    for (const segment of this.segments) {
      merged.set(segment, offset);
      offset += segment.length;
    }
    return merged;
  }

  private flush(): Int16Array | null {
    const merged = this.merge();
    this.segments = [];
    this.totalSamples = 0;

    if (rms(merged) < this.silenceRmsThreshold) {
      return null;
    }

    return merged;
  }
}
