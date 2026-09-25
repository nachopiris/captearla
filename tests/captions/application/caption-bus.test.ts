import { describe, expect, it, vi } from "vitest";
import { CaptionBus } from "../../../src/captions/application/caption-bus.js";
import type { Caption } from "../../../src/captions/domain/caption.js";

function makeCaption(overrides: Partial<Caption> = {}): Caption {
  return {
    id: "c1",
    sessionId: "main-stage",
    seq: 0,
    text: "hello",
    lang: "en",
    translations: { es: "hola", en: "hello" },
    final: true,
    ts: 1,
    ...overrides
  };
}

describe("CaptionBus", () => {
  it("delivers a published caption only to listeners of its session", () => {
    const bus = new CaptionBus();
    const mainListener = vi.fn();
    const otherListener = vi.fn();
    bus.subscribe("main-stage", mainListener);
    bus.subscribe("room-a", otherListener);

    const caption = makeCaption();
    bus.publish(caption);

    expect(mainListener).toHaveBeenCalledWith(caption);
    expect(otherListener).not.toHaveBeenCalled();
  });

  it("stops delivering to a listener after it unsubscribes", () => {
    const bus = new CaptionBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe("main-stage", listener);

    unsubscribe();
    bus.publish(makeCaption());

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps a bounded recent history per session", () => {
    const bus = new CaptionBus(3);
    for (let i = 0; i < 5; i++) {
      bus.publish(makeCaption({ id: `c${i}`, seq: i }));
    }

    const history = bus.history("main-stage");
    expect(history).toHaveLength(3);
    expect(history.map((c) => c.seq)).toEqual([2, 3, 4]);
  });

  it("returns an empty history for a session with no captions", () => {
    const bus = new CaptionBus();
    expect(bus.history("unknown")).toEqual([]);
  });
});
