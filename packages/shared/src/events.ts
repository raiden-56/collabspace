import { z } from "zod";

/**
 * Typed application-level realtime protocol (non-CRDT).
 * Yjs sync/awareness traffic uses binary y-protocols messages on dedicated rooms;
 * this JSON protocol carries transient app events: presence, chat, notifications, resource updates.
 *
 * Wire format: JSON text frames { t: <type>, p: <payload> }.
 */

export const PresenceUser = z.object({
  userId: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable().optional(),
  color: z.string(),
});
export type PresenceUser = z.infer<typeof PresenceUser>;

// ---- Client → Server --------------------------------------------------------

export const ClientEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping"), p: z.object({ ts: z.number() }).optional() }),
  // Subscribe to app-level channels (workspace feed, chat channel, resource viewers)
  z.object({
    t: z.literal("subscribe"),
    p: z.object({ channel: z.string().min(1).max(200) }),
  }),
  z.object({
    t: z.literal("unsubscribe"),
    p: z.object({ channel: z.string().min(1).max(200) }),
  }),
  // Lightweight viewing presence (who is looking at a resource) — not Yjs awareness
  z.object({
    t: z.literal("presence:update"),
    p: z.object({
      channel: z.string(),
      state: z.object({ status: z.enum(["viewing", "editing", "idle"]).optional() }).passthrough(),
    }),
  }),
  z.object({ t: z.literal("typing"), p: z.object({ channelId: z.string(), threadId: z.string().optional() }) }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

// ---- Server → Client --------------------------------------------------------

export const ServerEvent = z.discriminatedUnion("t", [
  z.object({ t: z.literal("pong"), p: z.object({ ts: z.number() }).optional() }),
  z.object({ t: z.literal("hello"), p: z.object({ connectionId: z.string(), userId: z.string(), serverTime: z.number() }) }),
  z.object({ t: z.literal("error"), p: z.object({ code: z.string(), message: z.string(), channel: z.string().optional() }) }),
  z.object({ t: z.literal("room:joined"), p: z.object({ channel: z.string() }) }),
  z.object({ t: z.literal("room:left"), p: z.object({ channel: z.string(), reason: z.string().optional() }) }),
  z.object({
    t: z.literal("presence:update"),
    p: z.object({
      channel: z.string(),
      users: z.array(PresenceUser.extend({ state: z.record(z.string(), z.unknown()).optional(), connections: z.number() })),
    }),
  }),
  z.object({ t: z.literal("presence:leave"), p: z.object({ channel: z.string(), userId: z.string() }) }),
  z.object({
    t: z.literal("chat:message"),
    p: z.object({ channelId: z.string(), message: z.record(z.string(), z.unknown()), kind: z.enum(["created", "updated", "deleted"]) }),
  }),
  z.object({ t: z.literal("chat:typing"), p: z.object({ channelId: z.string(), threadId: z.string().optional(), user: PresenceUser }) }),
  z.object({ t: z.literal("chat:reaction"), p: z.object({ channelId: z.string(), messageId: z.string(), reactions: z.array(z.record(z.string(), z.unknown())) }) }),
  z.object({ t: z.literal("notification:new"), p: z.object({ notification: z.record(z.string(), z.unknown()) }) }),
  z.object({ t: z.literal("notification:read"), p: z.object({ ids: z.array(z.string()), all: z.boolean().optional() }) }),
  z.object({
    t: z.literal("resource:updated"),
    p: z.object({
      resourceType: z.string(),
      resourceId: z.string(),
      workspaceId: z.string().optional(),
      projectId: z.string().nullable().optional(),
      action: z.enum(["created", "updated", "deleted", "restored", "archived"]),
      actorId: z.string().optional(),
      patch: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({
    t: z.literal("task:updated"),
    p: z.object({
      workspaceId: z.string(),
      projectId: z.string(),
      taskId: z.string(),
      action: z.enum(["created", "updated", "deleted", "moved"]),
      task: z.record(z.string(), z.unknown()).optional(),
      actorId: z.string().optional(),
    }),
  }),
  z.object({
    t: z.literal("comment:updated"),
    p: z.object({ resourceType: z.string(), resourceId: z.string(), threadId: z.string(), action: z.enum(["created", "updated", "deleted", "resolved", "reopened"]) }),
  }),
  z.object({ t: z.literal("ai:job"), p: z.object({ jobId: z.string(), status: z.string(), type: z.string(), meetingId: z.string().optional() }) }),
  z.object({ t: z.literal("meeting:updated"), p: z.object({ meetingId: z.string(), action: z.string() }) }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;

// ---- Internal API → Sync bus ------------------------------------------------

export const InternalPublish = z.object({
  /** Target channel(s): "user:<id>", "workspace:<id>", "chat:<channelId>", "resource:<type>:<id>" */
  channels: z.array(z.string().min(1)).min(1).max(100),
  event: ServerEvent,
});
export type InternalPublish = z.infer<typeof InternalPublish>;

// Channel name helpers — keep them in one place so API & sync agree.
export const ch = {
  user: (userId: string) => `user:${userId}`,
  workspace: (workspaceId: string) => `workspace:${workspaceId}`,
  chat: (channelId: string) => `chat:${channelId}`,
  resource: (type: string, id: string) => `resource:${type.toLowerCase()}:${id}`,
  project: (projectId: string) => `project:${projectId}`,
};

/** Rooms for binary Yjs sync: "yjs:canvas:<id>" / "yjs:document:<id>" */
export const yjsRoom = (type: "canvas" | "document", id: string) => `yjs:${type}:${id}`;

export function parseChannel(channel: string):
  | { kind: "user"; id: string }
  | { kind: "workspace"; id: string }
  | { kind: "chat"; id: string }
  | { kind: "project"; id: string }
  | { kind: "resource"; type: string; id: string }
  | null {
  const parts = channel.split(":");
  if (parts.length === 2) {
    const [kind, id] = parts as [string, string];
    if (kind === "user" || kind === "workspace" || kind === "chat" || kind === "project") return { kind, id };
    return null;
  }
  if (parts.length === 3 && parts[0] === "resource") return { kind: "resource", type: parts[1]!, id: parts[2]! };
  return null;
}
