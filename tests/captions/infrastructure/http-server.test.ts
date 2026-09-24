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

describe("HTTP + WS server", () => {
  let server: Server;
  let staticRoot: string;
  let baseUrl: string;
  let wsBaseUrl: string;
  let bus: CaptionBus;
  let registry: SessionRegistry;

  beforeEach(async () => {
    staticRoot = mkdtempSync(join(tmpdir(), "livecap-static-"));
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
});
