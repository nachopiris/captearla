import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../src/captions/infrastructure/config.js";

describe("loadConfig", () => {
  it("applies documented defaults for an empty environment", () => {
    const config = loadConfig({});

    expect(config.port).toBe(3000);
    expect(config.transcriber).toBe("mock");
    expect(config.geminiModel).toBe("gemini-2.5-flash");
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
});
