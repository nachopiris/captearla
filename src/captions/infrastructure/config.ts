export type TranscriberKind = "mock" | "gemini";

export interface Config {
  port: number;
  transcriber: TranscriberKind;
  geminiApiKey?: string;
  geminiModel: string;
  sessions: string[];
  /** Simulated MockTranscriber latency in milliseconds. Default 0. */
  mockLatencyMs: number;
  /** Simulated MockTranscriber latency jitter in milliseconds. Default 0. */
  mockLatencyJitterMs: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_SESSIONS = ["main-stage", "room-a", "room-b"];

export type EnvSource = Record<string, string | undefined>;

function parseSessions(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_SESSIONS];
  const sessions = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sessions.length > 0 ? sessions : [...DEFAULT_SESSIONS];
}

function parseTranscriberKind(env: EnvSource): TranscriberKind {
  const value = env.TRANSCRIBER?.trim();
  if (value === "mock" || value === "gemini") {
    return value;
  }
  return env.GEMINI_API_KEY ? "gemini" : "mock";
}

/** Parses a non-negative millisecond duration; non-finite or negative values fall back to 0. */
function parseNonNegativeMs(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Loads and validates runtime configuration from environment variables. */
export function loadConfig(env: EnvSource): Config {
  const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    transcriber: parseTranscriberKind(env),
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    sessions: parseSessions(env.SESSIONS),
    mockLatencyMs: parseNonNegativeMs(env.MOCK_LATENCY_MS),
    mockLatencyJitterMs: parseNonNegativeMs(env.MOCK_LATENCY_JITTER_MS)
  };
}
