import { describe, expect, it } from "vitest";
import { SessionRegistry } from "../../../src/captions/application/session-registry.js";

describe("SessionRegistry", () => {
  it("pre-populates predefined sessions as not live", () => {
    const registry = new SessionRegistry(["main-stage", "room-a"]);
    const sessions = registry.list();

    expect(sessions.map((s) => s.id).sort()).toEqual(["main-stage", "room-a"]);
    expect(sessions.every((s) => s.live === false)).toBe(true);
  });

  it("auto-creates a session on first ensure() call", () => {
    const registry = new SessionRegistry([]);
    expect(registry.get("room-b")).toBeUndefined();

    const created = registry.ensure("room-b");

    expect(created.id).toBe("room-b");
    expect(registry.get("room-b")).toBeDefined();
  });

  it("does not duplicate an already-known session", () => {
    const registry = new SessionRegistry(["main-stage"]);
    registry.ensure("main-stage");

    expect(registry.list()).toHaveLength(1);
  });

  it("marks a session live and back to not-live", () => {
    const registry = new SessionRegistry(["main-stage"]);

    registry.markLive("main-stage", true);
    expect(registry.get("main-stage")!.live).toBe(true);

    registry.markLive("main-stage", false);
    expect(registry.get("main-stage")!.live).toBe(false);
  });

  it("defaults a new session's name to its id when no name is given", () => {
    const registry = new SessionRegistry([]);
    const created = registry.ensure("room-c");

    expect(created.name).toBe("room-c");
  });

  it("sets a new session's name when one is given on ensure()", () => {
    const registry = new SessionRegistry([]);
    const created = registry.ensure("room-c", "Room C");

    expect(created.name).toBe("Room C");
  });

  it("trims a given name and caps it at 80 characters", () => {
    const registry = new SessionRegistry([]);
    const created = registry.ensure("room-c", `  ${"x".repeat(90)}  `);

    expect(created.name).toBe("x".repeat(80));
  });

  it("renames an existing session when ensure() is called again with a new name", () => {
    const registry = new SessionRegistry(["main-stage"]);

    registry.ensure("main-stage", "Main Stage");

    expect(registry.get("main-stage")!.name).toBe("Main Stage");
  });

  it("a blank or missing name on ensure() keeps the current name (last non-empty wins)", () => {
    const registry = new SessionRegistry(["main-stage"]);
    registry.ensure("main-stage", "Main Stage");

    registry.ensure("main-stage");
    expect(registry.get("main-stage")!.name).toBe("Main Stage");

    registry.ensure("main-stage", "   ");
    expect(registry.get("main-stage")!.name).toBe("Main Stage");
  });
});
