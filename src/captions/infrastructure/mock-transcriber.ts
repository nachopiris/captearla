import type { Transcriber, TranscribeInput, TranscribeResult } from "../domain/transcriber.js";

const CANNED_SENTENCES: TranscribeResult[] = [
  {
    text: "Welcome everyone to the conference, glad to have you here.",
    lang: "en",
    es: "Bienvenidos todos a la conferencia, un gusto tenerlos aqui.",
    en: "Welcome everyone to the conference, glad to have you here."
  },
  {
    text: "Hoy vamos a hablar sobre transcripcion en tiempo real.",
    lang: "es",
    es: "Hoy vamos a hablar sobre transcripcion en tiempo real.",
    en: "Today we are going to talk about real-time transcription."
  },
  {
    text: "This next demo shows captions in multiple languages at once.",
    lang: "en",
    es: "Esta siguiente demo muestra subtitulos en varios idiomas a la vez.",
    en: "This next demo shows captions in multiple languages at once."
  },
  {
    text: "Gracias por acompañarnos, ahora pasamos a preguntas del publico.",
    lang: "es",
    es: "Gracias por acompañarnos, ahora pasamos a preguntas del publico.",
    en: "Thanks for joining us, now let's move on to audience questions."
  }
];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MockTranscriberOptions {
  /** Simulated average model latency in milliseconds. Default 0 (no delay). */
  latencyMs?: number;
  /** Simulated latency jitter in milliseconds, applied as +/- around latencyMs. Default 0. */
  jitterMs?: number;
  /** Injectable RNG in [0, 1), for deterministic tests. Defaults to Math.random. */
  random?: () => number;
  /** Injectable sleep, for deterministic tests. Defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Deterministic transcriber with no network access, used for tests and for
 * demoing the system without a Gemini API key. Cycles through a fixed list
 * of bilingual sentences by call count.
 *
 * Optionally simulates model latency (with jitter) so load tests against it
 * exercise the same queuing behavior a slow real model would cause. The
 * simulated delay is `max(0, latencyMs + (random() * 2 - 1) * jitterMs)`.
 * With the default `latencyMs: 0, jitterMs: 0`, no sleep is awaited at all.
 */
export class MockTranscriber implements Transcriber {
  private callCount = 0;
  private readonly latencyMs: number;
  private readonly jitterMs: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: MockTranscriberOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    this.jitterMs = options.jitterMs ?? 0;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
    if (this.latencyMs !== 0 || this.jitterMs !== 0) {
      const delay = Math.max(0, this.latencyMs + (this.random() * 2 - 1) * this.jitterMs);
      await this.sleep(delay);
    }

    const sentence = CANNED_SENTENCES[this.callCount % CANNED_SENTENCES.length];
    this.callCount += 1;
    return { ...sentence };
  }
}
