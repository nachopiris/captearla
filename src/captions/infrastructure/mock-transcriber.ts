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

/**
 * Deterministic transcriber with no network access, used for tests and for
 * demoing the system without a Gemini API key. Cycles through a fixed list
 * of bilingual sentences by call count.
 */
export class MockTranscriber implements Transcriber {
  private callCount = 0;

  async transcribe(_input: TranscribeInput): Promise<TranscribeResult> {
    const sentence = CANNED_SENTENCES[this.callCount % CANNED_SENTENCES.length];
    this.callCount += 1;
    return { ...sentence };
  }
}
