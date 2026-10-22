import { Router } from "express";
import { prisma, type Prisma } from "@collabspace/db";
import { CreateChannelInput, SendMessageInput, MessageQuery, ReactionInput, extractMentions, ch, truncate } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, parseQuery, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { emit } from "../lib/realtime.js";
import { notify } from "../lib/notify.js";
import { rateLimit } from "../lib/rateLimit.js";
import { assertAccess, requireWorkspaceRole } from "../services/access.js";
import { findWorkspace } from "./workspaces.js";

export const channelsRouter = Router();
export const workspaceChannelsRouter = Router({ mergeParams: true });
export const messagesRouter = Router();
channelsRouter.use(requireAuth);
workspaceChannelsRouter.use(requireAuth);
messagesRouter.use(requireAuth);

const messageInclude = {
  author: { select: { id: true, name: true, avatarUrl: true, color: true } },
  reactions: { select: { emoji: true, userId: true } },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export function shapeMessage(m: MessageRow) {
  const grouped: Record<string, string[]> = {};
  for (const r of m.reactions) (grouped[r.emoji] ??= []).push(r.userId);
  return { ...m, body: m.deletedAt ? "" : m.body, reactions: Object.entries(grouped).map(([emoji, userIds]) => ({ emoji, userIds, count: userIds.length })) };
}

async function channelMember(channelId: string, userId: string) {
  return prisma.channelMember.findUnique({ where: { channelId_userId: { channelId, userId } } });
}

/** Membership is the access rule for chat: public channels can be joined; everything else needs membership. */
async function requireChannelAccess(user: Express.AuthUser, channelId: string, write = false) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.archivedAt) throw notFound("Channel");
  const role = await requireWorkspaceRole(user, channel.workspaceId);
  const member = await channelMember(channelId, user.id);
  if (!member) {
    const isAdmin = role === "OWNER" || role === "ADMIN";
    if (channel.type === "PUBLIC" && role !== "GUEST") {
      if (write) await prisma.channelMember.create({ data: { channelId, userId: user.id } });
    } else if (channel.type === "RESOURCE" && channel.resourceType && channel.resourceId) {
      await assertAccess(user, channel.resourceType, channel.resourceId, write ? "COMMENTER" : "VIEWER");
      if (write) await prisma.channelMember.upsert({ where: { channelId_userId: { channelId, userId: user.id } }, update: {}, create: { channelId, userId: user.id } });
    } else if (channel.type === "PROJECT" && channel.projectId) {
      await assertAccess(user, "PROJECT", channel.projectId, write ? "EDITOR" : "VIEWER");
      if (write) await prisma.channelMember.upsert({ where: { channelId_userId: { channelId, userId: user.id } }, update: {}, create: { channelId, userId: user.id } });
    } else if (!isAdmin || channel.type === "DIRECT") {
      // Admins may read private/group channels for moderation but never DMs they're not part of.
      throw notFound("Channel");
    }
  }
  return channel;
}

workspaceChannelsRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const channels = await prisma.channel.findMany({
      where: {
        workspaceId: ws.id,
        archivedAt: null,
        OR: [{ members: { some: { userId: req.user!.id } } }, ...(role !== "GUEST" ? [{ type: "PUBLIC" as const }] : [])],
      },
      include: {
        members: { include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } },
        readStates: { where: { userId: req.user!.id } },
        project: { select: { id: true, name: true, key: true, color: true } },
        _count: { select: { messages: { where: { deletedAt: null, parentId: null } } } },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    const result = [];
    for (const c of channels) {
      const lastRead = c.readStates[0]?.lastReadAt ?? new Date(0);
      const [unread, last] = await Promise.all([
        prisma.message.count({ where: { channelId: c.id, deletedAt: null, parentId: null, createdAt: { gt: lastRead }, authorId: { not: req.user!.id } } }),
        prisma.message.findFirst({ where: { channelId: c.id, deletedAt: null, parentId: null }, orderBy: { createdAt: "desc" }, select: { body: true, createdAt: true, author: { select: { name: true } } } }),
      ]);
      const isMember = c.members.some((m) => m.userId === req.user!.id);
      const { readStates: _r, ...rest } = c;
      result.push({ ...rest, isMember, unread, lastMessage: last ? { ...last, body: truncate(last.body, 120) } : null, messageCount: c._count.messages });
    }
    ok(res, result);
  }),
);

channelsRouter.post(
  "/",
  h(async (req, res) => {
    const input = parseBody(CreateChannelInput, req.body);
    const role = await requireWorkspaceRole(req.user, input.workspaceId);
    if (role === "GUEST" && input.type !== "DIRECT") throw forbidden("Guests can only start direct messages");
    const memberIds = new Set([req.user!.id, ...(input.memberIds ?? [])]);
    const valid = await prisma.workspaceMember.findMany({ where: { workspaceId: input.workspaceId, userId: { in: [...memberIds] } }, select: { userId: true } });
    const ids = valid.map((v) => v.userId);
    if (input.type === "DIRECT") {
      if (ids.length !== 2) throw badRequest("A direct message needs exactly one other member");
      const existing = await prisma.channel.findFirst({ where: { workspaceId: input.workspaceId, type: "DIRECT", AND: ids.map((userId) => ({ members: { some: { userId } } })) }, include: { members: { include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } } } });
      if (existing) return ok(res, { ...existing, isMember: true });
    }
    if (input.type === "RESOURCE") {
      if (!input.resourceType || !input.resourceId) throw badRequest("resourceType and resourceId are required");
      await assertAccess(req.user, input.resourceType, input.resourceId, "COMMENTER");
      const existing = await prisma.channel.findFirst({ where: { resourceType: input.resourceType, resourceId: input.resourceId }, include: { members: { include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } } } });
      if (existing) {
        await prisma.channelMember.upsert({ where: { channelId_userId: { channelId: existing.id, userId: req.user!.id } }, update: {}, create: { channelId: existing.id, userId: req.user!.id } });
        return ok(res, { ...existing, isMember: true });
      }
    }
    if (input.type === "PROJECT" && input.projectId) await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const channel = await prisma.channel.create({
      data: {
        workspaceId: input.workspaceId,
        type: input.type,
        name: input.type === "DIRECT" ? null : (input.name ?? null),
        topic: input.topic ?? null,
        projectId: input.projectId ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        createdById: req.user!.id,
        members: { create: ids.map((userId) => ({ userId })) },
      },
      include: { members: { include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } } },
    });
    for (const uid of ids) emit([ch.user(uid)], { t: "resource:updated", p: { resourceType: "CHANNEL", resourceId: channel.id, workspaceId: input.workspaceId, action: "created", actorId: req.user!.id } });
    created(res, { ...channel, isMember: true });
  }),
);

channelsRouter.get(
  "/:channelId",
  h(async (req, res) => {
    const id = requireParam(req, "channelId");
    const channel = await requireChannelAccess(req.user!, id);
    const full = await prisma.channel.findUniqueOrThrow({ where: { id }, include: { members: { include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } }, project: { select: { id: true, name: true, key: true } } } });
    let resource: { title: string } | null = null;
    if (channel.resourceType && channel.resourceId) {
      const { loadResource } = await import("../services/access.js");
      const r = await loadResource(channel.resourceType, channel.resourceId);
      resource = r ? { title: r.title } : null;
    }
    ok(res, { ...full, resource, isMember: full.members.some((m) => m.userId === req.user!.id) });
  }),
);

channelsRouter.post(
  "/:channelId/join",
  h(async (req, res) => {
    const id = requireParam(req, "channelId");
    await requireChannelAccess(req.user!, id, true);
    noContent(res);
  }),
);

channelsRouter.post(
  "/:channelId/members",
  h(async (req, res) => {
    const id = requireParam(req, "channelId");
    const channel = await requireChannelAccess(req.user!, id, true);
    if (channel.type === "DIRECT") throw badRequest("Direct messages cannot have additional members");
    const { userIds } = parseBody(z.object({ userIds: z.array(z.string()).min(1).max(50) }), req.body);
    const valid = await prisma.workspaceMember.findMany({ where: { workspaceId: channel.workspaceId, userId: { in: userIds } }, select: { userId: true } });
    await prisma.channelMember.createMany({ data: valid.map((v) => ({ channelId: id, userId: v.userId })), skipDuplicates: true });
    for (const v of valid) emit([ch.user(v.userId)], { t: "resource:updated", p: { resourceType: "CHANNEL", resourceId: id, workspaceId: channel.workspaceId, action: "updated", actorId: req.user!.id } });
    noContent(res);
  }),
);

channelsRouter.post(
  "/:channelId/read",
  h(async (req, res) => {
    const id = requireParam(req, "channelId");
    await requireChannelAccess(req.user!, id);
    await prisma.channelReadState.upsert({ where: { channelId_userId: { channelId: id, userId: req.user!.id } }, update: { lastReadAt: new Date() }, create: { channelId: id, userId: req.user!.id } });
    noContent(res);
  }),
);

channelsRouter.patch(
  "/:channelId",
  h(async (req, res) => {
    const id = requireParam(req, "channelId");
    const channel = await requireChannelAccess(req.user!, id, true);
    const input = parseBody(z.object({ name: z.string().min(1).max(80).optional(), topic: z.string().max(250).nullable().optional(), archived: z.boolean().optional(), muted: z.boolean().optional() }), req.body);
    if (input.muted !== undefined) await prisma.channelMember.updateMany({ where: { channelId: id, userId: req.user!.id }, data: { muted: input.muted } });
    const updated = await prisma.channel.update({ where: { id }, data: { name: channel.type === "DIRECT" ? undefined : input.name, topic: input.topic, archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null } });
    ok(res, updated);
  }),
);

// ---- Messages -----------------------------------------------------------------

channelsRouter.get(
  "/:channelId/messages",
  h(async (req, res) => {
    const id = requireParam(req, "channelId");
    await requireChannelAccess(req.user!, id);
    const q = parseQuery(MessageQuery, req.query);
    const where: Prisma.MessageWhereInput = { channelId: id, parentId: q.threadId ?? null };
    if (q.before) {
      const anchor = await prisma.message.findUnique({ where: { id: q.before }, select: { createdAt: true } });
      if (anchor) where.createdAt = { lt: anchor.createdAt };
    }
    if (q.after) {
      const anchor = await prisma.message.findUnique({ where: { id: q.after }, select: { createdAt: true } });
      if (anchor) where.createdAt = { ...(where.createdAt as object), gt: anchor.createdAt };
    }
    const rows = await prisma.message.findMany({ where, orderBy: { createdAt: q.after ? "asc" : "desc" }, take: q.limit + 1, include: messageInclude });
    const hasMore = rows.length > q.limit;
    const items = (hasMore ? rows.slice(0, q.limit) : rows).map(shapeMessage);
    if (!q.after) items.reverse();
    ok(res, { items, hasMore });
  }),
);

channelsRouter.post(
  "/:channelId/messages",
  rateLimit({ name: "chat-send", windowMs: 60_000, max: 60 }),
  h(async (req, res) => {
    const id = requireParam(req, "channelId");
    const channel = await requireChannelAccess(req.user!, id, true);
    const input = parseBody(SendMessageInput, req.body);
    if (input.parentId) {
      const parent = await prisma.message.findFirst({ where: { id: input.parentId, channelId: id, parentId: null } });
      if (!parent) throw badRequest("Thread parent not found");
    }
    const mentions = extractMentions(input.body);
    const message = await prisma.$transaction(async (tx) => {
      const m = await tx.message.create({ data: { channelId: id, authorId: req.user!.id, parentId: input.parentId ?? null, body: input.body, attachments: (input.attachments ?? []) as Prisma.InputJsonValue, mentions }, include: messageInclude });
      if (input.parentId) await tx.message.update({ where: { id: input.parentId }, data: { replyCount: { increment: 1 } } });
      await tx.channel.update({ where: { id }, data: { updatedAt: new Date() } });
      await tx.channelReadState.upsert({ where: { channelId_userId: { channelId: id, userId: req.user!.id } }, update: { lastReadAt: new Date() }, create: { channelId: id, userId: req.user!.id } });
      return m;
    });
    const shaped = { ...shapeMessage(message), clientId: input.clientId };
    emit([ch.chat(id)], { t: "chat:message", p: { channelId: id, message: shaped as unknown as Record<string, unknown>, kind: "created" } });

    const ws = await prisma.workspace.findUnique({ where: { id: channel.workspaceId }, select: { slug: true } });
    const href = `/app/${ws?.slug}/chat?channel=${id}${input.parentId ? `&thread=${input.parentId}` : ""}&message=${message.id}`;
    const members = await prisma.channelMember.findMany({ where: { channelId: id, userId: { not: req.user!.id } }, select: { userId: true, muted: true } });
    const memberIds = new Set(members.map((m) => m.userId));
    const notified = new Set<string>();
    for (const uid of mentions) {
      if (!memberIds.has(uid)) continue;
      notified.add(uid);
      await notify({ userId: uid, type: "MENTION", title: `${req.user!.name} mentioned you in ${channel.name ? `#${channel.name}` : "a conversation"}`, body: truncate(input.body.replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1"), 160), href, actorId: req.user!.id, workspaceId: channel.workspaceId, resourceType: "CHANNEL", resourceId: id, email: true });
    }
    if (channel.type === "DIRECT" || channel.type === "GROUP") {
      for (const m of members) {
        if (m.muted || notified.has(m.userId)) continue;
        await notify({ userId: m.userId, type: "CHAT_MESSAGE", title: `New message from ${req.user!.name}`, body: truncate(input.body, 160), href, actorId: req.user!.id, workspaceId: channel.workspaceId, resourceType: "CHANNEL", resourceId: id, groupKey: `chat:${id}` });
      }
    } else if (input.parentId) {
      const parent = await prisma.message.findUnique({ where: { id: input.parentId }, select: { authorId: true } });
      if (parent && parent.authorId !== req.user!.id && !notified.has(parent.authorId)) {
        await notify({ userId: parent.authorId, type: "COMMENT_REPLY", title: `${req.user!.name} replied to your message`, body: truncate(input.body, 160), href, actorId: req.user!.id, workspaceId: channel.workspaceId, resourceType: "CHANNEL", resourceId: id, groupKey: `thread:${input.parentId}` });
      }
    }
    created(res, shaped);
  }),
);

messagesRouter.patch(
  "/:messageId",
  h(async (req, res) => {
    const id = requireParam(req, "messageId");
    const message = await prisma.message.findUnique({ where: { id } });
    if (!message || message.deletedAt) throw notFound("Message");
    await requireChannelAccess(req.user!, message.channelId);
    if (message.authorId !== req.user!.id) throw forbidden("You can only edit your own messages");
    const { body } = parseBody(z.object({ body: z.string().trim().min(1).max(8000) }), req.body);
    const updated = await prisma.message.update({ where: { id }, data: { body, editedAt: new Date(), mentions: extractMentions(body) }, include: messageInclude });
    const shaped = shapeMessage(updated);
    emit([ch.chat(message.channelId)], { t: "chat:message", p: { channelId: message.channelId, message: shaped as unknown as Record<string, unknown>, kind: "updated" } });
    ok(res, shaped);
  }),
);

messagesRouter.delete(
  "/:messageId",
  h(async (req, res) => {
    const id = requireParam(req, "messageId");
    const message = await prisma.message.findUnique({ where: { id }, include: { channel: true } });
    if (!message || message.deletedAt) throw notFound("Message");
    const role = await requireWorkspaceRole(req.user, message.channel.workspaceId);
    await requireChannelAccess(req.user!, message.channelId);
    if (message.authorId !== req.user!.id && role !== "OWNER" && role !== "ADMIN") throw forbidden("You can only delete your own messages");
    const updated = await prisma.message.update({ where: { id }, data: { deletedAt: new Date(), body: "", attachments: [] }, include: messageInclude });
    emit([ch.chat(message.channelId)], { t: "chat:message", p: { channelId: message.channelId, message: shapeMessage(updated) as unknown as Record<string, unknown>, kind: "deleted" } });
    noContent(res);
  }),
);

messagesRouter.post(
  "/:messageId/reactions",
  h(async (req, res) => {
    const id = requireParam(req, "messageId");
    const message = await prisma.message.findUnique({ where: { id } });
    if (!message) throw notFound("Message");
    await requireChannelAccess(req.user!, message.channelId);
    const { emoji } = parseBody(ReactionInput, req.body);
    const key = { messageId: id, userId: req.user!.id, emoji };
    const existing = await prisma.messageReaction.findUnique({ where: { messageId_userId_emoji: key } });
    if (existing) await prisma.messageReaction.delete({ where: { messageId_userId_emoji: key } });
    else await prisma.messageReaction.create({ data: key });
    const updated = await prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude });
    const shaped = shapeMessage(updated);
    emit([ch.chat(message.channelId)], { t: "chat:reaction", p: { channelId: message.channelId, messageId: id, reactions: shaped.reactions as unknown as Record<string, unknown>[] } });
    ok(res, shaped);
  }),
);

messagesRouter.get(
  "/search",
  h(async (req, res) => {
    const q = parseQuery(z.object({ workspaceId: z.string(), q: z.string().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).default(20) }), req.query);
    await requireWorkspaceRole(req.user, q.workspaceId);
    const rows = await prisma.message.findMany({
      where: { deletedAt: null, body: { contains: q.q, mode: "insensitive" }, channel: { workspaceId: q.workspaceId, archivedAt: null, OR: [{ members: { some: { userId: req.user!.id } } }, { type: "PUBLIC" }] } },
      orderBy: { createdAt: "desc" },
      take: q.limit,
      include: { ...messageInclude, channel: { select: { id: true, name: true, type: true } } },
    });
    ok(res, rows.map((r) => ({ ...shapeMessage(r), channel: r.channel })));
  }),
);
