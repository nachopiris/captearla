import type { Transcriber, TranscribeInput, TranscribeResult } from "../domain/transcriber.js";
import { pcmToWav } from "./pcm-to-wav.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

const EMPTY_RESULT: TranscribeResult = { text: "", lang: "", es: "", en: "" };

/**
 * Minimal shape of `@google/genai`'s `GoogleGenAI` client that this adapter
 * needs. Kept narrow and structural (rather than importing the SDK's own
 * types) so a plain stub can be injected in tests without any network
 * access, while a real `GoogleGenAI` instance satisfies it as-is.
 */
export interface GeminiClient {
  models: {
    generateContent(params: {
      model: string;
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      config?: Record<string, unknown>;
    }): Promise<{ text?: string }>;
  };
}

export interface GeminiTranscriberOptions {
  client: GeminiClient;
  model?: string;
  logger?: { error: (message: string, error: unknown) => void };
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    lang: { type: "string" },
    es: { type: "string" },
    en: { type: "string" }
  },
  required: ["text", "lang", "es", "en"]
};

function buildPrompt(context: string): string {
  return [
    "You are transcribing a short chunk of live conference audio.",
    "Return verbatim what was said in the chunk, in its original language.",
    "Detect the ISO-639-1 code of that language.",
    "Translate the transcription to Spanish (es) and English (en).",
    "The following is rolling context from the immediately preceding audio, for continuity only:",
    "do not repeat it, only use it to disambiguate words that continue across chunks.",
    `Context: ${context || "(none, this is the start of the session)"}`,
    "If the chunk is silence, noise, or otherwise contains no speech, return an empty string for text.",
    "Respond as JSON matching: { text, lang, es, en }."
  ].join(" ");
}

/**
 * Transcriber adapter backed by Gemini's multimodal `generateContent`. Wraps
 * the PCM16 chunk into a WAV file, sends it as inline audio data alongside a
 * transcription/translation prompt, and parses the JSON response.
 */
export class GeminiTranscriber implements Transcriber {
  private readonly model: string;

  constructor(private readonly options: GeminiTranscriberOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const wav = pcmToWav(input.pcm, input.sampleRate);
    const base64Audio = wav.toString("base64");

    let response: { text?: string };
    try {
      response = await this.options.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [
              { text: buildPrompt(input.context) },
              { inlineData: { mimeType: "audio/wav", data: base64Audio } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          // Transcription/translation gains nothing from reasoning tokens, and
          // thinking adds latency to every chunk on 2.5 Flash models.
          thinkingConfig: { thinkingBudget: 0 }
        }
      });
    } catch (error) {
      this.options.logger?.error("Gemini generateContent call failed", error);
      return { ...EMPTY_RESULT };
    }

    const raw = response.text;
    if (!raw) {
      return { ...EMPTY_RESULT };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<TranscribeResult>;
      return {
        text: parsed.text ?? "",
        lang: parsed.lang ?? "",
        es: parsed.es ?? "",
        en: parsed.en ?? ""
      };
    } catch (error) {
      this.options.logger?.error("Failed to parse Gemini JSON response", error);
      return { ...EMPTY_RESULT };
    }
  }
}
