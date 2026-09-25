// Pure statistics helpers for the load bench (scripts/bench.ts). Kept free of
// I/O so they stay unit-testable per the project's hexagonal-ish layout,
// even though this module lives under scripts/ rather than src/.

/** One latency observation: how far into the run it was recorded, and the observed latency. */
export interface LatencySample {
  /** Milliseconds since the bench run started when the underlying chunk was cut. */
  elapsedMs: number;
  /** Observed latency in milliseconds (e.g. receivedAt - chunkTs). */
  latencyMs: number;
}

export interface BenchSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
  /** Least-squares slope of latency over elapsed time, expressed in ms of latency per minute. */
  driftMsPerMin: number;
}

/** Default drift threshold above which a session is considered to be falling behind (backlogging). */
export const DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN = 500;

/**
 * Computes the pth percentile (0-100) of a set of values using the
 * nearest-rank method: values are sorted ascending, and the result is the
 * value at index `ceil(p/100 * n) - 1` (clamped to the array bounds). This is
 * simpler and dependency-free compared to linear interpolation, and precise
 * enough for a load-bench report. Returns 0 for an empty array. Does not
 * mutate the input array.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

/**
 * Least-squares slope of latencyMs as a function of elapsedMs, converted
 * from ms-of-latency-per-ms-of-elapsed-time to ms-of-latency-per-minute.
 * Returns 0 with fewer than two samples, or when elapsed times are all
 * identical (degenerate regression, zero variance on the x-axis).
 */
function driftMsPerMinute(samples: LatencySample[]): number {
  const n = samples.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const { elapsedMs, latencyMs } of samples) {
    sumX += elapsedMs;
    sumY += latencyMs;
    sumXY += elapsedMs * latencyMs;
    sumXX += elapsedMs * elapsedMs;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;

  const slopePerMs = (n * sumXY - sumX * sumY) / denominator;
  const MS_PER_MINUTE = 60000;
  return slopePerMs * MS_PER_MINUTE;
}

/** Summarizes a session's (or the whole run's) latency samples into a report-ready shape. */
export function summarize(samples: LatencySample[]): BenchSummary {
  const latencies = samples.map((s) => s.latencyMs);
  return {
    count: samples.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length > 0 ? Math.max(...latencies) : 0,
    driftMsPerMin: driftMsPerMinute(samples)
  };
}

/** Flags backlog (captions progressively falling behind) when drift exceeds the threshold. */
export function isBacklogging(
  driftMsPerMin: number,
  thresholdMsPerMin: number = DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN
): boolean {
  return driftMsPerMin > thresholdMsPerMin;
}
