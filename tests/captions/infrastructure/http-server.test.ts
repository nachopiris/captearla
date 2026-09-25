import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { createServer } from "../../../src/captions/infrastructure/http-server.js";
import { SessionRegistry } from "../../../src/captions/application/session-registry.js";
import { CaptionBus } from "../../../src/captions/application/caption-bus.js";
import { SessionPipelineManager } from "../../../src/captions/application/session-pipeline-manager.js";
import { MockTranscriber } from "../../../src/captions/infrastructure/mock-transcriber.js";
import type { Caption } from "../../../src/captions/domain/caption.js";

const SAMPLE_RATE = 16000;

function samplesFor(ms: number): number {
  return Math.round((SAMPLE_RATE * ms) / 1000);
}

function tone(samples: number, amplitude = 12000): Int16Array {
  const frame = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    frame[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE));
  }
  return frame;
}

function silence(samples: number): Int16Array {
  return new Int16Array(samples);
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<Caption> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    ws.once("error", reject);
  });
}

/** Resolves once the handshake is rejected (an `error` event); rejects if it opens instead. */
function waitForRejection(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => reject(new Error("expected the handshake to be rejected, but it opened")));
    ws.once("error", () => resolve());
  });
}

describe("HTTP + WS server", () => {
  let server: Server;
  let staticRoot: string;
  let baseUrl: string;
  let wsBaseUrl: string;
  let bus: CaptionBus;
  let registry: SessionRegistry;

  beforeEach(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), "captearla-static-"));
    writeFileSync(join(staticRoot, "index.html"), "<html><body>hello test</body></html>");

    registry = new SessionRegistry(["main-stage"]);
    bus = new CaptionBus();
    const manager = new SessionPipelineManager({
      bus,
      transcriber: new MockTranscriber(),
      chunkerOptions: {
        sampleRate: SAMPLE_RATE,
        minDurationMs: 100,
        maxDurationMs: 300,
        trailingSilenceMs: 50,
        silenceRmsThreshold: 500
      }
    });

    server = createServer({ registry, bus, manager, staticRoot });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    wsBaseUrl = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(staticRoot, { recursive: true, force: true });
  });

  it("lists predefined sessions via the JSON API", async () => {
    const response = await fetch(`${baseUrl}/api/sessions`);
    expect(response.status).toBe(200);

    const sessions = (await response.json()) as Array<{ id: string; name: string; live: boolean; captionsCount: number }>;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: "main-stage", name: "main-stage", live: false, captionsCount: 0 });
  });

  it("returns an empty caption history for a session with no captions yet", async () => {
    const response = await fetch(`${baseUrl}/api/sessions/main-stage/captions`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("serves static files from the configured root", async () => {
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("hello test");
  });

  it("returns 404 for an unknown static path", async () => {
    const response = await fetch(`${baseUrl}/does-not-exist.html`);
    expect(response.status).toBe(404);
  });

  it("answers HEAD requests for static files without a body", async () => {
    const response = await fetch(`${baseUrl}/`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("");
  });

  it("answers HEAD requests for the JSON API", async () => {
    const response = await fetch(`${baseUrl}/api/sessions`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("streams ingested audio through to a captions WebSocket client and the history API", async () => {
    const captionsSocket = new WebSocket(`${wsBaseUrl}/captions/main-stage`);
    await waitForOpen(captionsSocket);

    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/main-stage`);
    await waitForOpen(ingestSocket);

    const nextCaption = waitForMessage(captionsSocket);

    ingestSocket.send(Buffer.from(tone(samplesFor(150)).buffer));
    ingestSocket.send(Buffer.from(silence(samplesFor(60)).buffer));

    const caption = await nextCaption;
    expect(caption.sessionId).toBe("main-stage");
    expect(caption.text.length).toBeGreaterThan(0);
    expect(caption.translations.es.length).toBeGreaterThan(0);
    expect(caption.translations.en.length).toBeGreaterThan(0);

    const history = await (await fetch(`${baseUrl}/api/sessions/main-stage/captions`)).json();
    expect(history).toHaveLength(1);

    captionsSocket.close();
    ingestSocket.close();
  });

  it("marks a session live while its ingest socket is connected", async () => {
    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/main-stage`);
    await waitForOpen(ingestSocket);

    type SessionSummary = { id: string; live: boolean };
    const whileConnected = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as SessionSummary[];
    expect(whileConnected.find((s) => s.id === "main-stage")?.live).toBe(true);

    ingestSocket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const afterClose = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as SessionSummary[];
    expect(afterClose.find((s) => s.id === "main-stage")?.live).toBe(false);
  });

  it("applies a name given on the ingest socket's ?name= query param", async () => {
    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/room-a?name=${encodeURIComponent("Sala A")}`);
    await waitForOpen(ingestSocket);

    type SessionSummary = { id: string; name: string };
    const sessions = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as SessionSummary[];
    expect(sessions.find((s) => s.id === "room-a")?.name).toBe("Sala A");

    ingestSocket.close();
  });

  it("keeps the session id as the name when the ingest socket omits ?name=", async () => {
    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/room-b`);
    await waitForOpen(ingestSocket);

    type SessionSummary = { id: string; name: string };
    const sessions = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as SessionSummary[];
    expect(sessions.find((s) => s.id === "room-b")?.name).toBe("room-b");

    ingestSocket.close();
  });

  it("keeps the previous name when a later ingest socket sends a blank ?name=", async () => {
    const first = new WebSocket(`${wsBaseUrl}/ingest/room-a?name=${encodeURIComponent("Sala A")}`);
    await waitForOpen(first);
    first.close();

    const second = new WebSocket(`${wsBaseUrl}/ingest/room-a?name=`);
    await waitForOpen(second);

    type SessionSummary = { id: string; name: string };
    const sessions = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as SessionSummary[];
    expect(sessions.find((s) => s.id === "room-a")?.name).toBe("Sala A");

    second.close();
  });

  it("accepts ingest connections with no ?token= when STAGE_TOKEN is unset", async () => {
    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/main-stage`);
    await waitForOpen(ingestSocket);
    ingestSocket.close();
  });
});

describe("HTTP + WS server with STAGE_TOKEN set", () => {
  const STAGE_TOKEN = "s3cret-stage-token";

  let server: Server;
  let staticRoot: string;
  let baseUrl: string;
  let wsBaseUrl: string;
  let bus: CaptionBus;
  let registry: SessionRegistry;

  beforeEach(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), "captearla-static-"));
    writeFileSync(join(staticRoot, "index.html"), "<html><body>hello test</body></html>");

    registry = new SessionRegistry(["main-stage"]);
    bus = new CaptionBus();
    const manager = new SessionPipelineManager({
      bus,
      transcriber: new MockTranscriber(),
      chunkerOptions: {
        sampleRate: SAMPLE_RATE,
        minDurationMs: 100,
        maxDurationMs: 300,
        trailingSilenceMs: 50,
        silenceRmsThreshold: 500
      }
    });

    server = createServer({ registry, bus, manager, staticRoot, stageToken: STAGE_TOKEN });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    wsBaseUrl = `ws://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(staticRoot, { recursive: true, force: true });
  });

  it("rejects an ingest connection with no ?token=", async () => {
    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/main-stage`);
    await waitForRejection(ingestSocket);
  });

  it("rejects an ingest connection with the wrong ?token=", async () => {
    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/main-stage?token=wrong-token`);
    await waitForRejection(ingestSocket);
  });

  it("accepts an ingest connection with the correct ?token= and lets audio ingest work", async () => {
    const captionsSocket = new WebSocket(`${wsBaseUrl}/captions/main-stage`);
    await waitForOpen(captionsSocket);

    const ingestSocket = new WebSocket(`${wsBaseUrl}/ingest/main-stage?token=${encodeURIComponent(STAGE_TOKEN)}`);
    await waitForOpen(ingestSocket);

    const nextCaption = waitForMessage(captionsSocket);

    ingestSocket.send(Buffer.from(tone(samplesFor(150)).buffer));
    ingestSocket.send(Buffer.from(silence(samplesFor(60)).buffer));

    const caption = await nextCaption;
    expect(caption.sessionId).toBe("main-stage");
    expect(caption.text.length).toBeGreaterThan(0);

    captionsSocket.close();
    ingestSocket.close();
  });

  it("does not create or rename a session for a rejected ingest attempt with ?name=", async () => {
    const ingestSocket = new WebSocket(
      `${wsBaseUrl}/ingest/intruder-room?name=${encodeURIComponent("Hijacked")}&token=wrong-token`
    );
    await waitForRejection(ingestSocket);

    type SessionSummary = { id: string; name: string };
    const sessions = (await (await fetch(`${baseUrl}/api/sessions`)).json()) as SessionSummary[];
    expect(sessions.find((s) => s.id === "intruder-room")).toBeUndefined();
  });
});
