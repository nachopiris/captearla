import { describe, expect, it, vi } from "vitest";
import { GeminiTranscriber } from "../../../src/captions/infrastructure/gemini-transcriber.js";
import type { GeminiClient } from "../../../src/captions/infrastructure/gemini-transcriber.js";

const chunk = { pcm: new Int16Array([1, 2, 3, 4]), sampleRate: 16000 as const, context: "previous line" };

function stubClient(responseText: string | undefined): GeminiClient {
  return {
    models: {
      generateContent: vi.fn(async () => ({ text: responseText }))
    }
  };
}

describe("GeminiTranscriber", () => {
  it("sends the audio as base64 WAV inline data with the rolling context in the prompt", async () => {
    const client = stubClient(JSON.stringify({ text: "hola", lang: "es", es: "hola", en: "hello" }));
    const transcriber = new GeminiTranscriber({ client, model: "gemini-test-model" });

    await transcriber.transcribe(chunk);

    expect(client.models.generateContent).toHaveBeenCalledTimes(1);
    const call = (client.models.generateContent as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(call.model).toBe("gemini-test-model");
    expect(call.config.responseMimeType).toBe("application/json");

    const parts = call.contents[0].parts;
    const textPart = parts.find((p: { text?: string }) => typeof p.text === "string");
    const audioPart = parts.find((p: { inlineData?: unknown }) => p.inlineData);

    expect(textPart.text).toContain("previous line");
    expect(audioPart.inlineData.mimeType).toBe("audio/wav");
    expect(typeof audioPart.inlineData.data).toBe("string");
    // base64 of a valid WAV header should decode back to "RIFF...WAVE"
    const decoded = Buffer.from(audioPart.inlineData.data, "base64");
    expect(decoded.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("parses the model's JSON response into a TranscribeResult", async () => {
    const client = stubClient(JSON.stringify({ text: "hola mundo", lang: "es", es: "hola mundo", en: "hello world" }));
    const transcriber = new GeminiTranscriber({ client, model: "gemini-test-model" });

    const result = await transcriber.transcribe(chunk);

    expect(result).toEqual({ text: "hola mundo", lang: "es", es: "hola mundo", en: "hello world" });
  });

  it("returns an empty-text result when the model reports silence", async () => {
    const client = stubClient(JSON.stringify({ text: "", lang: "", es: "", en: "" }));
    const transcriber = new GeminiTranscriber({ client, model: "gemini-test-model" });

    const result = await transcriber.transcribe(chunk);

    expect(result.text).toBe("");
  });

  it("returns an empty-text result instead of throwing when the response has no text", async () => {
    const client = stubClient(undefined);
    const transcriber = new GeminiTranscriber({ client, model: "gemini-test-model" });

    const result = await transcriber.transcribe(chunk);

    expect(result.text).toBe("");
  });

  it("returns an empty-text result instead of throwing when the response is not valid JSON", async () => {
    const client = stubClient("not json at all");
    const transcriber = new GeminiTranscriber({ client, model: "gemini-test-model" });

    const result = await transcriber.transcribe(chunk);

    expect(result.text).toBe("");
  });

  it("defaults the model to gemini-2.5-flash when none is provided", async () => {
    const client = stubClient(JSON.stringify({ text: "x", lang: "en", es: "x", en: "x" }));
    const transcriber = new GeminiTranscriber({ client });

    await transcriber.transcribe(chunk);

    const call = (client.models.generateContent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.model).toBe("gemini-2.5-flash");
  });
});
