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
}
