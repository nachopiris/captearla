import { loadConfig } from "./captions/infrastructure/config.js";
import { SessionRegistry } from "./captions/application/session-registry.js";
import { CaptionBus } from "./captions/application/caption-bus.js";
import { SessionPipelineManager } from "./captions/application/session-pipeline-manager.js";
import { MockTranscriber } from "./captions/infrastructure/mock-transcriber.js";
import { GeminiTranscriber, thinkingConfigFor } from "./captions/infrastructure/gemini-transcriber.js";
import { createServer } from "./captions/infrastructure/http-server.js";
import type { Transcriber } from "./captions/domain/transcriber.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const logger = {
  error(message: string, error: unknown): void {
    console.error(message, error);
  }
};

async function buildTranscriber(config: ReturnType<typeof loadConfig>): Promise<Transcriber> {
  if (config.transcriber === "mock") {
    console.log("[captearla] using MockTranscriber (no network, deterministic captions)");
    if (config.mockLatencyMs !== 0 || config.mockLatencyJitterMs !== 0) {
      console.log(
        `[captearla] MockTranscriber simulated latency: ${config.mockLatencyMs}ms +/- ${config.mockLatencyJitterMs}ms`
      );
    }
    return new MockTranscriber({ latencyMs: config.mockLatencyMs, jitterMs: config.mockLatencyJitterMs });
  }

  if (!config.geminiApiKey) {
    throw new Error("TRANSCRIBER=gemini requires GEMINI_API_KEY to be set");
  }

  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const thinkingConfig = thinkingConfigFor(config.geminiModel, config.geminiThinkingLevel);
  const thinkingDescription =
    "thinkingBudget" in thinkingConfig ? `budget ${thinkingConfig.thinkingBudget}` : `level ${thinkingConfig.thinkingLevel}`;
  console.log(`[captearla] using GeminiTranscriber (model: ${config.geminiModel}, thinking: ${thinkingDescription})`);
  return new GeminiTranscriber({
    client,
    model: config.geminiModel,
    thinkingLevel: config.geminiThinkingLevel,
    logger
  });
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const registry = new SessionRegistry(config.sessions);
  const bus = new CaptionBus();
  const transcriber = await buildTranscriber(config);

  console.log(`[captearla] max concurrent transcriptions per session: ${config.transcribeMaxInFlight}`);

  const manager = new SessionPipelineManager({
    bus,
    transcriber,
    maxInFlight: config.transcribeMaxInFlight,
    logger
  });

  if (!config.stageToken) {
    console.warn("[captearla] STAGE_TOKEN not set — stage ingest is open to anyone with the URL");
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const staticRoot = join(here, "..", "public");

  const server = createServer({ registry, bus, manager, staticRoot, stageToken: config.stageToken });
  server.listen(config.port, () => {
    console.log(`[captearla] listening on http://localhost:${config.port}`);
    console.log(`[captearla] sessions: ${registry.list().map((s) => s.id).join(", ")}`);
  });
}

main().catch((error) => {
  console.error("[captearla] fatal startup error", error);
  process.exitCode = 1;
});
