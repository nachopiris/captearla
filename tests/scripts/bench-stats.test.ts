import { describe, expect, it } from "vitest";
import {
  percentile,
  summarize,
  isBacklogging,
  DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN,
  type LatencySample
} from "../../scripts/bench-stats.js";

describe("percentile", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the only value for a single-element array at any percentile", () => {
    expect(percentile([42], 0)).toBe(42);
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 100)).toBe(42);
  });

  it("computes p50 using the nearest-rank method on sorted values", () => {
    // sorted: [1,2,3,4,5], rank = ceil(0.5*5) = 3 -> index 2 -> value 3
    expect(percentile([5, 3, 1, 4, 2], 50)).toBe(3);
  });

  it("computes p95 using the nearest-rank method on sorted values", () => {
    // sorted: [1,2,3,4,5], rank = ceil(0.95*5) = 5 -> index 4 -> value 5
    expect(percentile([5, 3, 1, 4, 2], 95)).toBe(5);
  });

  it("computes p0 as the minimum value", () => {
    expect(percentile([5, 3, 1, 4, 2], 0)).toBe(1);
  });

  it("computes p100 as the maximum value", () => {
    expect(percentile([5, 3, 1, 4, 2], 100)).toBe(5);
  });

  it("does not mutate the input array", () => {
    const values = [5, 3, 1, 4, 2];
    percentile(values, 50);
    expect(values).toEqual([5, 3, 1, 4, 2]);
  });
});

describe("summarize", () => {
  it("reports count 0 and drift 0 for an empty sample set", () => {
    const summary = summarize([]);
    expect(summary).toEqual({ count: 0, p50: 0, p95: 0, max: 0, driftMsPerMin: 0 });
  });

  it("reports drift 0 with fewer than two samples", () => {
    const samples: LatencySample[] = [{ elapsedMs: 1000, latencyMs: 500 }];
    expect(summarize(samples).driftMsPerMin).toBe(0);
  });

  it("computes count, p50, p95 and max from latency values", () => {
    const samples: LatencySample[] = [
      { elapsedMs: 0, latencyMs: 100 },
      { elapsedMs: 1000, latencyMs: 300 },
      { elapsedMs: 2000, latencyMs: 200 },
      { elapsedMs: 3000, latencyMs: 500 },
      { elapsedMs: 4000, latencyMs: 400 }
    ];
    const summary = summarize(samples);
    expect(summary.count).toBe(5);
    expect(summary.p50).toBe(300);
    expect(summary.p95).toBe(500);
    expect(summary.max).toBe(500);
  });

  it("computes driftMsPerMin as the least-squares slope of latency over elapsed time, in ms/min", () => {
    // Perfectly linear: latency grows 500ms over 60000ms elapsed -> 500 ms/min.
    const samples: LatencySample[] = [
      { elapsedMs: 0, latencyMs: 1000 },
      { elapsedMs: 30000, latencyMs: 1250 },
      { elapsedMs: 60000, latencyMs: 1500 }
    ];
    expect(summarize(samples).driftMsPerMin).toBeCloseTo(500, 5);
  });

  it("computes driftMsPerMin as roughly 0 for flat latency", () => {
    const samples: LatencySample[] = [
      { elapsedMs: 0, latencyMs: 1000 },
      { elapsedMs: 30000, latencyMs: 1000 },
      { elapsedMs: 60000, latencyMs: 1000 }
    ];
    expect(summarize(samples).driftMsPerMin).toBeCloseTo(0, 5);
  });

  it("returns drift 0 when all samples share the same elapsed time (degenerate regression)", () => {
    const samples: LatencySample[] = [
      { elapsedMs: 1000, latencyMs: 100 },
      { elapsedMs: 1000, latencyMs: 900 }
    ];
    expect(summarize(samples).driftMsPerMin).toBe(0);
  });
});

describe("isBacklogging", () => {
  it("flags backlog when drift exceeds the default threshold", () => {
    expect(isBacklogging(DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN + 1)).toBe(true);
  });

  it("does not flag backlog at or below the default threshold", () => {
    expect(isBacklogging(DEFAULT_BACKLOG_DRIFT_THRESHOLD_MS_PER_MIN)).toBe(false);
    expect(isBacklogging(0)).toBe(false);
  });

  it("honors a custom threshold", () => {
    expect(isBacklogging(150, 100)).toBe(true);
    expect(isBacklogging(50, 100)).toBe(false);
  });
});
