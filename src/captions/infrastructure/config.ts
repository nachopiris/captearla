import type { ThinkingLevel } from "./gemini-transcriber.js";

export type TranscriberKind = "mock" | "gemini";

const THINKING_LEVELS: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high"];

export interface Config {
  port: number;
  transcriber: TranscriberKind;
  geminiApiKey?: string;
  geminiModel: string;
  /** Gemini 3.x thinking effort override. Unset lets the model use its lowest level. */
  geminiThinkingLevel?: ThinkingLevel;
  sessions: string[];
  /** Simulated MockTranscriber latency in milliseconds. Default 0. */
  mockLatencyMs: number;
  /** Simulated MockTranscriber latency jitter in milliseconds. Default 0. */
  mockLatencyJitterMs: number;
  /** Max concurrent `transcribe` calls per session. Default 3. */
  transcribeMaxInFlight: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_SESSIONS = ["main-stage", "room-a", "room-b"];
const DEFAULT_TRANSCRIBE_MAX_IN_FLIGHT = 3;

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

/** Parses `GEMINI_THINKING_LEVEL` case-insensitively; missing or invalid values -> undefined. */
function parseThinkingLevel(raw: string | undefined): ThinkingLevel | undefined {
  const value = raw?.trim().toLowerCase();
  return THINKING_LEVELS.find((level) => level === value);
}

/** Parses a positive integer max-in-flight count; anything else falls back to the default (3). */
function parseMaxInFlight(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TRANSCRIBE_MAX_IN_FLIGHT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return DEFAULT_TRANSCRIBE_MAX_IN_FLIGHT;
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
    geminiThinkingLevel: parseThinkingLevel(env.GEMINI_THINKING_LEVEL),
    sessions: parseSessions(env.SESSIONS),
    mockLatencyMs: parseNonNegativeMs(env.MOCK_LATENCY_MS),
    mockLatencyJitterMs: parseNonNegativeMs(env.MOCK_LATENCY_JITTER_MS),
    transcribeMaxInFlight: parseMaxInFlight(env.TRANSCRIBE_MAX_IN_FLIGHT)
  };
}
