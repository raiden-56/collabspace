import type { WebSocket } from "ws";
import { ClientEvent, ServerEvent, parseChannel, type PresenceUser } from "@collabspace/shared";
import type { ResourceType } from "@collabspace/db";
import { accessAtLeast } from "@collabspace/shared";
import { canViewChannel, resourceAccess, workspaceRole, type AuthedUser } from "./auth.js";
import { logger } from "./logger.js";
import { getRedis } from "./redis.js";

/**
 * Application-level realtime: JSON events over the `/events` WebSocket.
 * Clients subscribe to channels (user:<id>, workspace:<id>, project:<id>, chat:<id>, resource:<type>:<id>);
 * every subscription is authorized against the database. The API publishes events through
 * /internal/publish (or Redis), and this module fans them out to subscribers.
 */

export interface EventConn {
  id: string;
  ws: WebSocket;
  user: AuthedUser;
  channels: Set<string>;
  presence: Map<string, Record<string, unknown>>; // channel → state
  alive: boolean;
}

const subscribers = new Map<string, Set<EventConn>>();
export const REDIS_EVENTS_CHANNEL = "collabspace:events";

export function sendEvent(conn: EventConn, event: ServerEvent): void {
  if (conn.ws.readyState !== conn.ws.OPEN) return;
  conn.ws.send(JSON.stringify(event));
}

export function broadcast(channel: string, event: ServerEvent, except?: EventConn): void {
  const subs = subscribers.get(channel);
  if (!subs) return;
  for (const c of subs) if (c !== except) sendEvent(c, event);
}

/** Deliver an event published by the API (local fan-out only; Redis relays between instances). */
export function deliver(channels: string[], event: ServerEvent): void {
  for (const ch of channels) broadcast(ch, event);
}

async function authorizeChannel(user: AuthedUser, channel: string): Promise<boolean> {
  const parsed = parseChannel(channel);
  if (!parsed) return false;
  switch (parsed.kind) {
    case "user":
      return parsed.id === user.userId;
    case "workspace":
      return (await workspaceRole(user.userId, parsed.id)) !== null || user.platformRole === "ADMIN";
    case "project":
      return accessAtLeast(await resourceAccess(user, "PROJECT", parsed.id), "VIEWER");
    case "chat":
      return canViewChannel(user, parsed.id);
    case "resource": {
      const type = parsed.type.toUpperCase() as ResourceType;
      if (!["CANVAS", "DOCUMENT", "PROJECT", "MEETING", "TASK", "BOARD"].includes(type)) return false;
      return accessAtLeast(await resourceAccess(user, type, parsed.id), "VIEWER");
    }
  }
}

function presenceSnapshot(channel: string): Array<PresenceUser & { state?: Record<string, unknown>; connections: number }> {
  const subs = subscribers.get(channel);
  if (!subs) return [];
  const byUser = new Map<string, PresenceUser & { state?: Record<string, unknown>; connections: number }>();
  for (const c of subs) {
    const state = c.presence.get(channel);
    if (!state) continue;
    const existing = byUser.get(c.user.userId);
    if (existing) {
      existing.connections += 1;
      existing.state = { ...existing.state, ...state };
    } else byUser.set(c.user.userId, { userId: c.user.userId, name: c.user.name, avatarUrl: c.user.avatarUrl, color: c.user.color, state, connections: 1 });
  }
  return [...byUser.values()];
}

function broadcastPresence(channel: string): void {
  broadcast(channel, { t: "presence:update", p: { channel, users: presenceSnapshot(channel) } });
}

export async function handleClientMessage(conn: EventConn, raw: string): Promise<void> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    sendEvent(conn, { t: "error", p: { code: "bad_json", message: "Malformed message" } });
    return;
  }
  const parsed = ClientEvent.safeParse(json);
  if (!parsed.success) {
    sendEvent(conn, { t: "error", p: { code: "invalid_event", message: "Unknown or invalid event" } });
    return;
  }
  const ev = parsed.data;
  switch (ev.t) {
    case "ping":
      sendEvent(conn, { t: "pong", p: { ts: ev.p?.ts ?? Date.now() } });
      return;
    case "subscribe": {
      const channel = ev.p.channel;
      if (conn.channels.has(channel)) return;
      if (conn.channels.size >= 200) {
        sendEvent(conn, { t: "error", p: { code: "too_many_subscriptions", message: "Subscription limit reached", channel } });
        return;
      }
      const ok = await authorizeChannel(conn.user, channel).catch((err) => {
        logger.warn({ err, channel }, "channel authorization failed");
        return false;
      });
      if (!ok) {
        sendEvent(conn, { t: "error", p: { code: "forbidden", message: "You cannot subscribe to this channel", channel } });
        return;
      }
      conn.channels.add(channel);
      let set = subscribers.get(channel);
      if (!set) subscribers.set(channel, (set = new Set()));
      set.add(conn);
      sendEvent(conn, { t: "room:joined", p: { channel } });
      // Presence channels: resource viewers immediately see who else is here.
      if (channel.startsWith("resource:") || channel.startsWith("chat:")) sendEvent(conn, { t: "presence:update", p: { channel, users: presenceSnapshot(channel) } });
      return;
    }
    case "unsubscribe":
      unsubscribe(conn, ev.p.channel, "client");
      return;
    case "presence:update": {
      if (!conn.channels.has(ev.p.channel)) {
        sendEvent(conn, { t: "error", p: { code: "not_subscribed", message: "Subscribe before publishing presence", channel: ev.p.channel } });
        return;
      }
      // Only non-sensitive, bounded state is accepted.
      const state: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(ev.p.state)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") state[k] = typeof v === "string" ? v.slice(0, 120) : v;
      conn.presence.set(ev.p.channel, state);
      broadcastPresence(ev.p.channel);
      return;
    }
    case "typing": {
      const channel = `chat:${ev.p.channelId}`;
      if (!conn.channels.has(channel)) return;
      broadcast(channel, { t: "chat:typing", p: { channelId: ev.p.channelId, threadId: ev.p.threadId, user: { userId: conn.user.userId, name: conn.user.name, avatarUrl: conn.user.avatarUrl, color: conn.user.color } } }, conn);
      return;
    }
  }
}

export function unsubscribe(conn: EventConn, channel: string, reason: string): void {
  if (!conn.channels.delete(channel)) return;
  subscribers.get(channel)?.delete(conn);
  if (subscribers.get(channel)?.size === 0) subscribers.delete(channel);
  const hadPresence = conn.presence.delete(channel);
  if (hadPresence) {
    broadcast(channel, { t: "presence:leave", p: { channel, userId: conn.user.userId } });
    broadcastPresence(channel);
  }
  sendEvent(conn, { t: "room:left", p: { channel, reason } });
}

export function disconnect(conn: EventConn): void {
  for (const channel of [...conn.channels]) {
    conn.channels.delete(channel);
    subscribers.get(channel)?.delete(conn);
    if (subscribers.get(channel)?.size === 0) subscribers.delete(channel);
    if (conn.presence.has(channel)) {
      conn.presence.delete(channel);
      broadcast(channel, { t: "presence:leave", p: { channel, userId: conn.user.userId } });
      broadcastPresence(channel);
    }
  }
}

/** Subscribe to the Redis events channel so API publishes reach every sync instance. */
export async function startRedisRelay(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const sub = redis.duplicate();
  await sub.subscribe(REDIS_EVENTS_CHANNEL);
  sub.on("message", (_ch: string, msg: string) => {
    try {
      const { channels, event } = JSON.parse(msg) as { channels: string[]; event: ServerEvent };
      const parsed = ServerEvent.safeParse(event);
      if (parsed.success) deliver(channels, parsed.data);
    } catch (err) {
      logger.warn({ err }, "bad redis event");
    }
  });
  logger.info("redis event relay active");
}

export function stats() {
  let connections = 0;
  const seen = new Set<EventConn>();
  for (const set of subscribers.values()) for (const c of set) seen.add(c);
  connections = seen.size;
  return { channels: subscribers.size, connections };
}
