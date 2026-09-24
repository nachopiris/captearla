export type TranscriberKind = "mock" | "gemini";

export interface Config {
  port: number;
  transcriber: TranscriberKind;
  geminiApiKey?: string;
  geminiModel: string;
  sessions: string[];
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

/** Loads and validates runtime configuration from environment variables. */
export function loadConfig(env: EnvSource): Config {
  const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    transcriber: parseTranscriberKind(env),
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    sessions: parseSessions(env.SESSIONS)
  };
}
