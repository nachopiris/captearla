import { describe, expect, test } from "vitest";
import {
  createCaptionBuffer,
  createCaptionConnection
} from "../../public/viewer-core.js";

/** Minimal fake WebSocket: records listeners, lets tests fire events by hand. */
class FakeSocket {
  url: string;
  closeCalls = 0;
  private listeners: Record<string, Array<(event: { data?: unknown }) => void>> = {};

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }

  close(): void {
    this.closeCalls++;
  }

  dispatch(type: string, data?: unknown): void {
    for (const handler of this.listeners[type] ?? []) handler({ data });
  }
}

/** Single-slot fake timer: enough since the module keeps at most one pending reconnect. */
function createFakeTimers() {
  let nextId = 1;
  let scheduled: { id: number; fn: () => void } | null = null;

  return {
    setTimer(fn: () => void, _ms: number): number {
      const id = nextId++;
      scheduled = { id, fn };
      return id;
    },
    clearTimer(id: number): void {
      if (scheduled && scheduled.id === id) scheduled = null;
    },
    fire(): void {
      const current = scheduled;
      scheduled = null;
      current?.fn();
    },
    isPending(): boolean {
      return scheduled !== null;
    }
  };
}

function makeCaption(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "id",
    sessionId: "s",
    seq: 0,
    text: "",
    lang: "en",
    translations: { es: "", en: "" },
    final: true,
    ts: 0,
    ...overrides
  };
}

describe("createCaptionConnection", () => {
  function setup(retryMs = 1500) {
    const instances: FakeSocket[] = [];
    const statuses: Array<[string, boolean]> = [];
    const captions: unknown[] = [];
    const timers = createFakeTimers();
    const connection = createCaptionConnection({
      createSocket: (sessionId: string) => {
        const socket = new FakeSocket(sessionId);
        instances.push(socket);
        return socket;
      },
      onCaption: (caption: unknown) => captions.push(caption),
      onStatus: (text: string, isLive: boolean) => statuses.push([text, isLive]),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      retryMs
    });
    return { connection, instances, statuses, captions, timers };
  }

  test("switching sessions ignores the stale socket's close: no reconnect, no status/caption from it", () => {
    const { connection, instances, statuses, captions, timers } = setup();

    connection.connect("A");
    connection.connect("B");
    const [socketA] = instances;

    statuses.length = 0;
    captions.length = 0;

    socketA.dispatch("close");
    expect(timers.isPending()).toBe(false);
    expect(statuses).toEqual([]);

    socketA.dispatch("message", JSON.stringify(makeCaption({ id: "x", text: "hi" })));
    expect(captions).toEqual([]);
  });

  test("a genuine drop of the current socket reconnects to the same session after retryMs", () => {
    const { connection, instances, timers } = setup(1500);

    connection.connect("A");
    const [socketA] = instances;
    socketA.dispatch("close");

    expect(timers.isPending()).toBe(true);
    timers.fire();

    expect(instances).toHaveLength(2);
    expect(instances[1]?.url).toBe("A");
  });

  test("connecting to a new session cancels a pending reconnect to the old one", () => {
    const { connection, instances, timers } = setup();

    connection.connect("A");
    const [socketA] = instances;
    socketA.dispatch("close");
    expect(timers.isPending()).toBe(true);

    connection.connect("B");
    expect(timers.isPending()).toBe(false);
    expect(instances).toHaveLength(2);
    expect(instances[1]?.url).toBe("B");

    timers.fire();
    expect(instances).toHaveLength(2);
  });

  test("close() tears down without scheduling a reconnect", () => {
    const { connection, instances, timers } = setup();

    connection.connect("A");
    const [socketA] = instances;
    connection.close();

    expect(socketA.closeCalls).toBe(1);
    socketA.dispatch("close");
    expect(timers.isPending()).toBe(false);
  });
});

describe("createCaptionBuffer", () => {
  test("dedupes by id, keeping only the last N in arrival order", () => {
    const buffer = createCaptionBuffer(2);
    const c1 = makeCaption({ id: "1", seq: 1, text: "one" });
    const c2 = makeCaption({ id: "2", seq: 2, text: "two" });
    const c3 = makeCaption({ id: "3", seq: 3, text: "three" });

    expect(buffer.add(c1)).toBe(true);
    expect(buffer.add(c2)).toBe(true);
    expect(buffer.add(c3)).toBe(true);
    expect(buffer.lines("original")).toEqual(["two", "three"]);

    // Replayed history (same ids again, e.g. after a reconnect) is rejected.
    expect(buffer.add(c1)).toBe(false);
    expect(buffer.add(c2)).toBe(false);
    expect(buffer.add(c3)).toBe(false);
    expect(buffer.lines("original")).toEqual(["two", "three"]);

  });

  test("accepts new captions after a server restart resets seq", () => {
    const buffer = createCaptionBuffer(2);
    buffer.add(makeCaption({ id: "a", seq: 7, text: "before restart" }));

    // The restarted server counts seq from 0 again but issues fresh ids.
    expect(buffer.add(makeCaption({ id: "b", seq: 0, text: "after restart" }))).toBe(true);
    expect(buffer.lines("original")).toEqual(["before restart", "after restart"]);
  });

  test("lines(lang) reads per-language text and skips captions without that translation yet", () => {
    const buffer = createCaptionBuffer(4);
    buffer.add(
      makeCaption({ id: "1", seq: 1, text: "hello", translations: { es: "hola", en: "" } })
    );
    buffer.add(
      makeCaption({ id: "2", seq: 2, text: "world", translations: { es: "", en: "world-en" } })
    );

    expect(buffer.lines("original")).toEqual(["hello", "world"]);
    expect(buffer.lines("es")).toEqual(["hola"]);
    expect(buffer.lines("en")).toEqual(["world-en"]);
  });

  test("reset() clears dedupe state and stored lines", () => {
    const buffer = createCaptionBuffer(4);
    buffer.add(makeCaption({ id: "1", seq: 1, text: "one" }));
    buffer.reset();

    expect(buffer.lines("original")).toEqual([]);
    // After reset, a caption with a previously-seen id/seq is accepted again.
    expect(buffer.add(makeCaption({ id: "1", seq: 1, text: "one-again" }))).toBe(true);
    expect(buffer.lines("original")).toEqual(["one-again"]);
  });
});
