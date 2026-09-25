import type { Transcriber, TranscribeInput, TranscribeResult } from "../domain/transcriber.js";
import { pcmToWav } from "./pcm-to-wav.js";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_THINKING_LEVEL: ThinkingLevel = "minimal";

const EMPTY_RESULT: TranscribeResult = { text: "", lang: "", es: "", en: "" };

/**
 * Thinking effort level accepted by Gemini 3.x's `thinkingConfig.thinkingLevel`.
 * Kept as a plain string union (rather than importing the SDK's own
 * `ThinkingLevel` enum, whose members are the uppercase Vertex/Enterprise
 * names) because the values that actually go on the wire for the Gemini
 * Developer API are lowercase, as confirmed by a direct probe against the
 * real API (see the feature document for evidence).
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Selects the `thinkingConfig` to send with a `generateContent` call, based
 * on the target model's generation.
 *
 * Gemini 2.x models accept `thinkingBudget`, and transcription/translation
 * gains nothing from reasoning tokens, so thinking stays disabled
 * (`thinkingBudget: 0`) to keep per-chunk latency low; any requested level is
 * ignored on this generation.
 *
 * Gemini 3.x models reject `thinkingBudget` with a `400 INVALID_ARGUMENT`
 * error and require `thinkingLevel` instead. There is no way to fully
 * disable thinking on 3.x, so the lowest available level is used unless a
 * different one is requested via `GEMINI_THINKING_LEVEL`. The lowest level is
 * `minimal` on 3.5 Flash-Lite / 3.6 Flash, and `low` on 3.7 / 3.8 Flash.
 */
export function thinkingConfigFor(
  model: string,
  level?: ThinkingLevel
): { thinkingBudget: number } | { thinkingLevel: ThinkingLevel } {
  if (model.startsWith("gemini-2.")) {
    return { thinkingBudget: 0 };
  }
  return { thinkingLevel: level ?? DEFAULT_THINKING_LEVEL };
}

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
  thinkingLevel?: ThinkingLevel;
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
  private readonly thinkingLevel?: ThinkingLevel;

  constructor(private readonly options: GeminiTranscriberOptions) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.thinkingLevel = options.thinkingLevel;
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
          thinkingConfig: thinkingConfigFor(this.model, this.thinkingLevel)
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
