import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/captions/infrastructure/config.js";

describe("loadConfig", () => {
  it("applies documented defaults for an empty environment", () => {
    const config = loadConfig({});

    expect(config.port).toBe(3000);
    expect(config.transcriber).toBe("mock");
    expect(config.geminiModel).toBe("gemini-3.5-flash-lite");
    expect(config.sessions).toEqual(["main-stage", "room-a", "room-b"]);
  });

  it("parses PORT as a number", () => {
    const config = loadConfig({ PORT: "8080" });
    expect(config.port).toBe(8080);
  });

  it("defaults to the gemini transcriber when GEMINI_API_KEY is set and TRANSCRIBER is unset", () => {
    const config = loadConfig({ GEMINI_API_KEY: "secret" });
    expect(config.transcriber).toBe("gemini");
    expect(config.geminiApiKey).toBe("secret");
  });

  it("treats an empty TRANSCRIBER (as in .env.example) as unset", () => {
    expect(loadConfig({ GEMINI_API_KEY: "secret", TRANSCRIBER: "" }).transcriber).toBe("gemini");
    expect(loadConfig({ TRANSCRIBER: "" }).transcriber).toBe("mock");
  });

  it("lets TRANSCRIBER override the key-based default", () => {
    const config = loadConfig({ GEMINI_API_KEY: "secret", TRANSCRIBER: "mock" });
    expect(config.transcriber).toBe("mock");
  });

  it("parses a comma-separated SESSIONS list, trimming whitespace and empties", () => {
    const config = loadConfig({ SESSIONS: " main-stage, room-a ,, room-b " });
    expect(config.sessions).toEqual(["main-stage", "room-a", "room-b"]);
  });

  it("honors a custom GEMINI_MODEL", () => {
    const config = loadConfig({ GEMINI_MODEL: "gemini-3.0-pro" });
    expect(config.geminiModel).toBe("gemini-3.0-pro");
  });

  it("defaults mock latency and jitter to 0 when unset", () => {
    const config = loadConfig({});
    expect(config.mockLatencyMs).toBe(0);
    expect(config.mockLatencyJitterMs).toBe(0);
  });

  it("parses MOCK_LATENCY_MS and MOCK_LATENCY_JITTER_MS as numbers", () => {
    const config = loadConfig({ MOCK_LATENCY_MS: "1500", MOCK_LATENCY_JITTER_MS: "300" });
    expect(config.mockLatencyMs).toBe(1500);
    expect(config.mockLatencyJitterMs).toBe(300);
  });

  it("falls back to 0 for a non-finite MOCK_LATENCY_MS", () => {
    const config = loadConfig({ MOCK_LATENCY_MS: "not-a-number" });
    expect(config.mockLatencyMs).toBe(0);
  });

  it("falls back to 0 for a negative MOCK_LATENCY_JITTER_MS", () => {
    const config = loadConfig({ MOCK_LATENCY_JITTER_MS: "-50" });
    expect(config.mockLatencyJitterMs).toBe(0);
  });

  it("defaults transcribeMaxInFlight to 3 when unset", () => {
    const config = loadConfig({});
    expect(config.transcribeMaxInFlight).toBe(3);
  });

  it("parses TRANSCRIBE_MAX_IN_FLIGHT as a positive integer", () => {
    const config = loadConfig({ TRANSCRIBE_MAX_IN_FLIGHT: "5" });
    expect(config.transcribeMaxInFlight).toBe(5);
  });

  it.each(["0", "-2", "abc", "1.5"])(
    "falls back to 3 for an invalid TRANSCRIBE_MAX_IN_FLIGHT (%s)",
    (raw) => {
      const config = loadConfig({ TRANSCRIBE_MAX_IN_FLIGHT: raw });
      expect(config.transcribeMaxInFlight).toBe(3);
    }
  );

  it("leaves geminiThinkingLevel undefined when GEMINI_THINKING_LEVEL is unset", () => {
    const config = loadConfig({});
    expect(config.geminiThinkingLevel).toBeUndefined();
  });

  it.each(["minimal", "low", "medium", "high"])(
    "parses a valid GEMINI_THINKING_LEVEL (%s)",
    (raw) => {
      const config = loadConfig({ GEMINI_THINKING_LEVEL: raw });
      expect(config.geminiThinkingLevel).toBe(raw);
    }
  );

  it("accepts GEMINI_THINKING_LEVEL case-insensitively", () => {
    const config = loadConfig({ GEMINI_THINKING_LEVEL: "HIGH" });
    expect(config.geminiThinkingLevel).toBe("high");
  });

  it.each(["", "extreme", "0", "  "])(
    "falls back to undefined for an invalid GEMINI_THINKING_LEVEL (%s)",
    (raw) => {
      const config = loadConfig({ GEMINI_THINKING_LEVEL: raw });
      expect(config.geminiThinkingLevel).toBeUndefined();
    }
  );
});
