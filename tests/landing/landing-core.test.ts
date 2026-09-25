import { describe, expect, test } from "vitest";
import { viewerRedirect } from "../../public/landing-core.js";

describe("viewerRedirect", () => {
  test("redirects to the viewer, preserving the session param", () => {
    expect(viewerRedirect("?session=room-a")).toBe("/viewer.html?session=room-a");
  });

  test("preserves extra params alongside session, such as lang", () => {
    expect(viewerRedirect("?session=room-a&lang=es")).toBe("/viewer.html?session=room-a&lang=es");
  });

  test("returns null when there is no session param", () => {
    expect(viewerRedirect("")).toBeNull();
  });

  test("returns null for an empty search string", () => {
    expect(viewerRedirect("")).toBeNull();
  });

  test("returns null when only lang is given, without session", () => {
    expect(viewerRedirect("?lang=es")).toBeNull();
  });

  test("returns null when session is present but blank", () => {
    expect(viewerRedirect("?session=")).toBeNull();
  });
});
