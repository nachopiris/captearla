/**
 * A single transcribed caption for a session, in its original language plus
 * Spanish/English translations.
 */
export interface Caption {
  id: string;
  sessionId: string;
  seq: number;
  text: string;
  lang: string;
  translations: {
    es: string;
    en: string;
  };
  final: boolean;
  ts: number;
  /**
   * Epoch ms when the audio chunk backing this caption was cut and enqueued
   * for transcription (not when the caption was published). Optional so
   * existing clients and cached history from before this field existed are
   * unaffected. `ts - chunkTs` approximates queue wait + model latency +
   * delivery time.
   */
  chunkTs?: number;
}
