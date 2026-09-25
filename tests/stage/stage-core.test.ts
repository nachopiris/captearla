import { describe, expect, test } from "vitest";
import { audienceUrl, ingestPath, meterSegments } from "../../public/stage-core.js";

describe("audienceUrl", () => {
  test("builds a viewer link for the given origin and session id", () => {
    expect(audienceUrl("https://captearla.example", "main-stage")).toBe(
      "https://captearla.example/?session=main-stage"
    );
  });

  test("URL-encodes a session id with special characters", () => {
    expect(audienceUrl("https://captearla.example", "room one/2")).toBe(
      "https://captearla.example/?session=room%20one%2F2"
    );
  });

  test("returns an origin-only link when the session id is empty", () => {
    expect(audienceUrl("https://captearla.example", "")).toBe("https://captearla.example/?session=");
  });
});

describe("ingestPath", () => {
  test("builds the ingest path without a name query param when no name is given", () => {
    expect(ingestPath("main-stage")).toBe("/ingest/main-stage");
  });

  test("omits the name query param when the name is blank or whitespace-only", () => {
    expect(ingestPath("main-stage", "")).toBe("/ingest/main-stage");
    expect(ingestPath("main-stage", "   ")).toBe("/ingest/main-stage");
  });

  test("appends a trimmed, URL-encoded name query param when given", () => {
    expect(ingestPath("room-a", "  Sala A  ")).toBe("/ingest/room-a?name=Sala%20A");
  });

  test("URL-encodes a session id with special characters", () => {
    expect(ingestPath("room one/2")).toBe("/ingest/room%20one%2F2");
  });
});

describe("meterSegments", () => {
  test("level 0 lights no segments", () => {
    const segments = meterSegments(0);
    expect(segments).toHaveLength(28);
    expect(segments.every((s) => s.lit === false && s.hot === false)).toBe(true);
  });

  test("level 1 lights every segment, with the last 4 marked hot", () => {
    const segments = meterSegments(1);
    expect(segments.every((s) => s.lit === true)).toBe(true);
    expect(segments.filter((s) => s.hot).map((s) => s.lit)).toEqual([true, true, true, true]);
    expect(segments.slice(0, 24).every((s) => s.hot === false)).toBe(true);
    expect(segments.slice(24).every((s) => s.hot === true)).toBe(true);
  });

  test("mid level lights a proportional count with none hot below hotFrom", () => {
    const segments = meterSegments(0.5, 28, 24);
    const litCount = segments.filter((s) => s.lit).length;
    expect(litCount).toBe(14);
    expect(segments.every((s) => s.hot === false)).toBe(true);
  });

  test("only lit segments at or past hotFrom are hot", () => {
    // 26/28 lit -> indices 0..25 lit; hotFrom=24 -> indices 24,25 are hot (2 segments).
    const segments = meterSegments(26 / 28, 28, 24);
    expect(segments.filter((s) => s.lit)).toHaveLength(26);
    expect(segments.filter((s) => s.hot)).toHaveLength(2);
    expect(segments[24].hot).toBe(true);
    expect(segments[25].hot).toBe(true);
    expect(segments[23].hot).toBe(false);
  });

  test("clamps out-of-range levels", () => {
    expect(meterSegments(-1).every((s) => !s.lit)).toBe(true);
    expect(meterSegments(2).every((s) => s.lit)).toBe(true);
  });

  test("treats a non-finite level as 0", () => {
    expect(meterSegments(NaN).every((s) => !s.lit)).toBe(true);
  });

  test("supports custom total and hotFrom", () => {
    const segments = meterSegments(1, 10, 8);
    expect(segments).toHaveLength(10);
    expect(segments.filter((s) => s.hot)).toHaveLength(2);
  });
});
