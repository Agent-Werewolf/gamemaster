// WebSocket spectator broadcast + simple HTTP server for the dashboard.
import { WebSocketServer, WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { log } from "./log.js";

export interface SpectatorEvent {
  kind: string;
  payload: unknown;
  ts: number;
}

export class SpectatorBroadcast {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();
  private history: SpectatorEvent[] = [];
  private httpServer: ReturnType<typeof createServer>;

  constructor(
    private readonly emitter: EventEmitter,
    private readonly port: number,
    private readonly staticDir?: string
  ) {
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on("connection", (ws) => {
      log.info({ clients: this.clients.size + 1 }, "spectator connected");
      this.clients.add(ws);
      // Send history so a late-joining viewer sees the game from start
      for (const ev of this.history) ws.send(JSON.stringify(ev));
      ws.on("close", () => {
        this.clients.delete(ws);
        log.info({ clients: this.clients.size }, "spectator disconnected");
      });
    });

    // Wire all game events
    const events = [
      "game_start",
      "phase_start",
      "phase_end",
      "speech",
      "vote",
      "night_kill",
      "elimination",
      "game_end",
      "archive_committed"
    ];
    for (const ev of events) {
      emitter.on(ev, (payload: unknown) => this.broadcast(ev, payload));
    }
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        log.info({ port: this.port }, "spectator HTTP+WS server listening");
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close();
      this.httpServer.close(() => resolve());
    });
  }

  private broadcast(kind: string, payload: unknown): void {
    const ev: SpectatorEvent = { kind, payload, ts: Date.now() };
    this.history.push(ev);
    if (this.history.length > 5000) this.history.shift();
    const json = JSON.stringify(ev);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(json);
    }
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || "/";
    if (url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (url === "/events") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.history));
      return;
    }
    if (this.staticDir) {
      const rawPath = url === "/" ? "index.html" : url.split("?")[0].replace(/^\/+/, "");
      // Prevent traversal
      if (rawPath.includes("..")) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("forbidden");
        return;
      }
      const filePath = join(this.staticDir, rawPath);
      if (existsSync(filePath)) {
        const ext = rawPath.split(".").pop() || "html";
        const mime = MIME[ext] ?? "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(readFileSync(filePath));
        return;
      }
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  ico: "image/x-icon"
};
