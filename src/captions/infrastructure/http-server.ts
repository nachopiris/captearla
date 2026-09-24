import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { SessionRegistry } from "../application/session-registry.js";
import type { CaptionBus } from "../application/caption-bus.js";
import type { SessionPipelineManager } from "../application/session-pipeline-manager.js";

export interface HttpServerDeps {
  registry: SessionRegistry;
  bus: CaptionBus;
  manager: SessionPipelineManager;
  staticRoot: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wav": "audio/wav"
};

function contentTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function serveStatic(staticRoot: string, pathname: string, res: import("node:http").ServerResponse): void {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const resolvedRoot = resolve(staticRoot);
  const filePath = normalize(join(resolvedRoot, relativePath));

  if (!filePath.startsWith(resolvedRoot) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
  createReadStream(filePath).pipe(res);
}

const INGEST_PATH = /^\/ingest\/([^/]+)\/?$/;
const CAPTIONS_PATH = /^\/captions\/([^/]+)\/?$/;

/**
 * Wires the plain node:http static/API server together with the two
 * WebSocket endpoints: binary audio ingest per session, and JSON caption
 * fan-out per session.
 */
export function createServer(deps: HttpServerDeps): Server {
  const { registry, bus, manager, staticRoot } = deps;

  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const sessions = registry.list().map((session) => ({
        id: session.id,
        name: session.name,
        live: session.live,
        captionsCount: bus.history(session.id).length
      }));
      sendJson(res, 200, sessions);
      return;
    }

    const captionsApiMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/captions\/?$/);
    if (req.method === "GET" && captionsApiMatch) {
      sendJson(res, 200, bus.history(captionsApiMatch[1]));
      return;
    }

    if (req.method === "GET") {
      serveStatic(staticRoot, url.pathname, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  const ingestWss = new WebSocketServer({ noServer: true });
  const captionsWss = new WebSocketServer({ noServer: true });

  ingestWss.on("connection", (socket: WebSocket, sessionId: string) => {
    registry.ensure(sessionId);
    registry.markLive(sessionId, true);

    socket.on("message", (data: RawData) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const sampleCount = Math.floor(buffer.length / 2);
      // Read sample-by-sample rather than viewing the Buffer's underlying
      // ArrayBuffer directly: Node pools small Buffers, so byteOffset is not
      // guaranteed to be 2-byte aligned, which Int16Array requires.
      const frame = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        frame[i] = buffer.readInt16LE(i * 2);
      }
      manager.ingest(sessionId, frame).catch(() => {
        // TranscriptionPipeline already swallows and logs errors internally;
        // this catch only guards against unexpected manager-level failures.
      });
    });

    socket.on("close", () => {
      registry.markLive(sessionId, false);
    });
  });

  captionsWss.on("connection", (socket: WebSocket, sessionId: string) => {
    for (const caption of bus.history(sessionId)) {
      socket.send(JSON.stringify(caption));
    }

    const unsubscribe = bus.subscribe(sessionId, (caption) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(caption));
      }
    });

    socket.on("close", unsubscribe);
  });

  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    const ingestMatch = url.pathname.match(INGEST_PATH);
    if (ingestMatch) {
      ingestWss.handleUpgrade(req, socket, head, (ws) => {
        ingestWss.emit("connection", ws, decodeURIComponent(ingestMatch[1]));
      });
      return;
    }

    const captionsMatch = url.pathname.match(CAPTIONS_PATH);
    if (captionsMatch) {
      captionsWss.handleUpgrade(req, socket, head, (ws) => {
        captionsWss.emit("connection", ws, decodeURIComponent(captionsMatch[1]));
      });
      return;
    }

    socket.destroy();
  });

  return server;
}
