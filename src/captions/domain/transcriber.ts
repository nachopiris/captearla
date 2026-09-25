/**
 * Outbound port for converting a chunk of raw audio into a transcribed,
 * translated caption. Adapters (mock, Gemini, ...) implement this.
 */
export interface TranscribeInput {
  pcm: Int16Array | Buffer;
  sampleRate: 16000;
  /** Rolling text context (recent caption text) to keep continuity across chunks. */
  context: string;
}

export interface TranscribeResult {
  /** Verbatim transcription in the detected original language. Empty when silence/noise. */
  text: string;
  /** ISO-639-1 language code detected for `text`. */
  lang: string;
  /** Spanish translation of `text`. */
  es: string;
  /** English translation of `text`. */
  en: string;
}

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}
