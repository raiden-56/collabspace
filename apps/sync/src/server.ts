import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { prisma } from "@collabspace/db";
import { InternalPublish, ServerEvent, accessAtLeast } from "@collabspace/shared";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { authenticate, originAllowed, resourceAccess, type AuthedUser } from "./auth.js";
import { getOrCreateRoom, makeConn, rooms, flushAllRooms, type RoomConn } from "./rooms.js";
import { deliver, disconnect, handleClientMessage, sendEvent, startRedisRelay, stats, type EventConn } from "./events.js";

/**
 * CollabSpace realtime service.
 *   GET  /health                      — liveness
 *   WS   /yjs/<canvas|document>:<id>  — Yjs sync + awareness (y-websocket compatible), ?share=<token>
 *   WS   /events                      — JSON app events (presence, chat, notifications, resource updates)
 *   POST /internal/publish            — API → fan-out (x-internal-secret)
 *   POST /internal/yjs/apply          — API → apply an update to a live room (version restore)
 *
 * Every connection is authenticated with the same HttpOnly session cookie the API issues, and every
 * room/channel join is authorized against the database. Rate limits, heartbeats and idle cleanup
 * protect the service; Redis (optional) relays traffic between instances.
 */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size, ...stats(), time: new Date().toISOString() }));
    return;
  }
  if (req.method === "POST" && url.pathname.startsWith("/internal/")) {
    if (req.headers["x-internal-secret"] !== config.INTERNAL_EVENT_SECRET) {
      res.writeHead(401).end();
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const json = JSON.parse(body);
        if (url.pathname === "/internal/publish") {
          const parsed = InternalPublish.safeParse(json);
          if (!parsed.success) {
            res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid payload" }));
            return;
          }
          deliver(parsed.data.channels, parsed.data.event);
          res.writeHead(202).end();
          return;
        }
        if (url.pathname === "/internal/yjs/apply") {
          const { type, id, update } = json as { type: "canvas" | "document"; id: string; update: string };
          const room = rooms.get(`${type}:${id}`);
          if (room && !room.destroyed) room.applyExternal(new Uint8Array(Buffer.from(update, "base64")));
          res.writeHead(202).end();
          return;
        }
        res.writeHead(404).end();
      } catch (err) {
        logger.warn({ err }, "internal request failed");
        res.writeHead(400).end();
      }
    });
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });

interface RateState {
  count: number;
  windowStart: number;
}

function rateLimited(state: RateState): boolean {
  const now = Date.now();
  if (now - state.windowStart >= 1000) {
    state.windowStart = now;
    state.count = 0;
  }
  state.count += 1;
  return state.count > config.maxMessagesPerSecond;
}

server.on("upgrade", async (req, socket, head) => {
  try {
    if (!originAllowed(req)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const user = await authenticate(req);

    if (url.pathname === "/events") {
      if (!user) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => handleEventsConnection(ws, user));
      return;
    }

    const m = url.pathname.match(/^\/yjs\/(canvas|document)[:/]([A-Za-z0-9_-]+)$/);
    if (m) {
      const type = m[1] as "canvas" | "document";
      const id = m[2]!;
      const share = url.searchParams.get("share");
      const access = await resourceAccess(user, type === "canvas" ? "CANVAS" : "DOCUMENT", id, share);
      if (!accessAtLeast(access, "VIEWER")) {
        socket.write(user ? "HTTP/1.1 403 Forbidden\r\n\r\n" : "HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => handleYjsConnection(ws, user, type, id, access));
      return;
    }
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  } catch (err) {
    logger.error({ err }, "upgrade failed");
    socket.destroy();
  }
});

function handleYjsConnection(ws: WebSocket, user: AuthedUser | null, type: "canvas" | "document", id: string, access: ReturnType<typeof makeConn>["access"]) {
  const room = getOrCreateRoom(type, id);
  const conn: RoomConn = makeConn(ws, user, access);
  const rate: RateState = { count: 0, windowStart: Date.now() };
  ws.binaryType = "arraybuffer";
  ws.on("message", (data, isBinary) => {
    if (rateLimited(rate)) {
      ws.close(1008, "rate limit exceeded");
      return;
    }
    if (!isBinary) return; // yjs rooms only accept binary protocol frames
    try {
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : Array.isArray(data) ? new Uint8Array(Buffer.concat(data)) : new Uint8Array(data as Buffer);
      room.handleMessage(conn, buf);
    } catch (err) {
      logger.warn({ err, room: room.key }, "bad yjs message");
      ws.close(1003, "invalid message");
    }
  });
  ws.on("pong", () => {
    conn.alive = true;
  });
  ws.on("close", () => room.leave(conn));
  ws.on("error", (err) => logger.debug({ err: err.message }, "yjs ws error"));
  void room.join(conn).catch((err) => {
    logger.error({ err, room: room.key }, "room join failed");
    ws.close(1011, "room unavailable");
  });
  heartbeats.add({ ws, get alive() { return conn.alive; }, set alive(v: boolean) { conn.alive = v; } });
  logger.debug({ room: room.key, user: user?.userId ?? "share-link", access }, "yjs client joined");
}

function handleEventsConnection(ws: WebSocket, user: AuthedUser) {
  const conn: EventConn = { id: randomUUID(), ws, user, channels: new Set(), presence: new Map(), alive: true };
  const rate: RateState = { count: 0, windowStart: Date.now() };
  sendEvent(conn, { t: "hello", p: { connectionId: conn.id, userId: user.userId, serverTime: Date.now() } });
  ws.on("message", (data, isBinary) => {
    if (rateLimited(rate)) {
      ws.close(1008, "rate limit exceeded");
      return;
    }
    if (isBinary) return;
    void handleClientMessage(conn, data.toString()).catch((err) => logger.warn({ err }, "event handling failed"));
  });
  ws.on("pong", () => {
    conn.alive = true;
  });
  ws.on("close", () => disconnect(conn));
  ws.on("error", (err) => logger.debug({ err: err.message }, "events ws error"));
  heartbeats.add({ ws, get alive() { return conn.alive; }, set alive(v: boolean) { conn.alive = v; } });
}

interface Heart {
  ws: WebSocket;
  alive: boolean;
}
const heartbeats = new Set<Heart>();
const heartbeatTimer = setInterval(() => {
  for (const h of heartbeats) {
    if (h.ws.readyState !== WebSocket.OPEN) {
      heartbeats.delete(h);
      continue;
    }
    if (!h.alive) {
      h.ws.terminate();
      heartbeats.delete(h);
      continue;
    }
    h.alive = false;
    h.ws.ping();
  }
}, config.heartbeatMs);
heartbeatTimer.unref();

export function start(port = config.SYNC_PORT): Promise<http.Server> {
  return new Promise((resolve) => {
    server.listen(port, () => {
      logger.info({ port, redis: Boolean(config.REDIS_URL) }, `CollabSpace sync service listening on ws://localhost:${port}`);
      void startRedisRelay().catch((err) => logger.warn({ err }, "redis relay unavailable"));
      resolve(server);
    });
  });
}

export async function stop(): Promise<void> {
  clearInterval(heartbeatTimer);
  for (const client of wss.clients) client.close(1001, "server shutting down");
  await flushAllRooms();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
}

async function shutdown(signal: string) {
  logger.info({ signal }, "sync shutting down");
  await stop();
  process.exit(0);
}

if (process.env.SYNC_NO_AUTOSTART !== "1") {
  void start();
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

export { server, wss };
export type { ServerEvent };
