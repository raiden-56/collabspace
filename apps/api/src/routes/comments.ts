import { Router } from "express";
import { prisma, type ResourceType } from "@collabspace/db";
import { CreateCommentInput, UpdateCommentInput, ReactionInput, ResourceTypeSchema, extractMentions, ch, truncate } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, parseQuery, ok, created, noContent, requireParam } from "../lib/http.js";
import { forbidden, notFound } from "../lib/errors.js";
import { requireAuth, requireAuthUnlessShare } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { notify } from "../lib/notify.js";
import { emit } from "../lib/realtime.js";
import { assertAccess, resolveAccess } from "../services/access.js";
import { accessAtLeast } from "@collabspace/shared";

export const commentsRouter = Router();
export const threadsRouter = Router();
commentsRouter.use(requireAuthUnlessShare);
threadsRouter.use(requireAuth);

const commentInclude = {
  author: { select: { id: true, name: true, avatarUrl: true, color: true } },
  reactions: { select: { emoji: true, userId: true } },
  mentions: { select: { userId: true } },
} as const;

function shapeComment(c: { reactions: Array<{ emoji: string; userId: string }>; deletedAt: Date | null; body: string } & Record<string, unknown>) {
  const grouped: Record<string, string[]> = {};
  for (const r of c.reactions) (grouped[r.emoji] ??= []).push(r.userId);
  return { ...c, body: c.deletedAt ? "" : c.body, reactions: Object.entries(grouped).map(([emoji, userIds]) => ({ emoji, userIds, count: userIds.length })) };
}

function hrefFor(slug: string, type: ResourceType, id: string, threadId: string): string {
  switch (type) {
    case "CANVAS":
      return `/app/${slug}/canvas/${id}?thread=${threadId}`;
    case "DOCUMENT":
      return `/app/${slug}/docs/${id}?thread=${threadId}`;
    case "TASK":
      return `/app/${slug}/tasks?task=${id}`;
    case "PROJECT":
      return `/app/${slug}/projects/${id}?tab=discussion`;
    case "MEETING":
      return `/app/${slug}/meetings/${id}`;
    default:
      return `/app/${slug}`;
  }
}

commentsRouter.get(
  "/",
  h(async (req, res) => {
    const q = parseQuery(z.object({ resourceType: ResourceTypeSchema, resourceId: z.string(), includeResolved: z.coerce.boolean().optional(), share: z.string().optional() }), req.query);
    await assertAccess(req.user, q.resourceType, q.resourceId, "VIEWER", q.share);
    const threads = await prisma.commentThread.findMany({
      where: { resourceType: q.resourceType, resourceId: q.resourceId, ...(q.includeResolved ? {} : { resolvedAt: null }) },
      orderBy: { createdAt: "asc" },
      include: { comments: { orderBy: { createdAt: "asc" }, include: commentInclude } },
    });
    ok(res, threads.map((t) => ({ ...t, comments: t.comments.map(shapeComment) })));
  }),
);

commentsRouter.post(
  "/",
  h(async (req, res) => {
    const input = parseBody(CreateCommentInput, req.body);
    const { resource } = await assertAccess(req.user, input.resourceType, input.resourceId, "COMMENTER");
    const mentionIds = extractMentions(input.body);
    // Only mention people who can see the resource.
    const validMentions: string[] = [];
    for (const uid of mentionIds) {
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, email: true, name: true, avatarUrl: true, color: true, platformRole: true, emailVerifiedAt: true, onboardingDone: true } });
      if (!u) continue;
      const r = await resolveAccess(u, input.resourceType, input.resourceId).catch(() => null);
      if (r && accessAtLeast(r.access, "VIEWER")) validMentions.push(uid);
    }
    let threadId = input.threadId;
    if (threadId) {
      const thread = await prisma.commentThread.findUnique({ where: { id: threadId } });
      if (!thread || thread.resourceId !== input.resourceId) throw notFound("Thread");
    } else {
      const thread = await prisma.commentThread.create({ data: { workspaceId: resource.workspaceId, resourceType: input.resourceType, resourceId: input.resourceId, anchor: (input.anchor ?? undefined) as object | undefined } });
      threadId = thread.id;
    }
    const comment = await prisma.comment.create({
      data: { threadId, authorId: req.user!.id, body: input.body, mentions: { create: validMentions.map((userId) => ({ userId })) } },
      include: commentInclude,
    });
    await prisma.commentThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
    const ws = await prisma.workspace.findUnique({ where: { id: resource.workspaceId }, select: { slug: true } });
    const href = hrefFor(ws?.slug ?? "", input.resourceType, input.resourceId, threadId);
    const isReply = Boolean(input.threadId);

    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "comment.created", resourceType: input.resourceType, resourceId: input.resourceId, resourceTitle: resource.title, payload: { threadId, reply: isReply } });
    emit([ch.resource(input.resourceType, input.resourceId)], { t: "comment:updated", p: { resourceType: input.resourceType, resourceId: input.resourceId, threadId, action: "created" } });

    // Notify mentions, then other thread participants (de-duplicated, no self).
    const notified = new Set<string>([req.user!.id]);
    for (const uid of validMentions) {
      notified.add(uid);
      await notify({ userId: uid, type: "MENTION", title: `${req.user!.name} mentioned you in ${resource.title}`, body: truncate(input.body.replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1"), 160), href, actorId: req.user!.id, workspaceId: resource.workspaceId, resourceType: input.resourceType, resourceId: input.resourceId, email: true });
    }
    const participants = await prisma.comment.findMany({ where: { threadId, authorId: { notIn: [...notified] } }, select: { authorId: true }, distinct: ["authorId"] });
    for (const p of participants) {
      notified.add(p.authorId);
      await notify({ userId: p.authorId, type: "COMMENT_REPLY", title: `${req.user!.name} replied in ${resource.title}`, body: truncate(input.body, 160), href, actorId: req.user!.id, workspaceId: resource.workspaceId, resourceType: input.resourceType, resourceId: input.resourceId, groupKey: `thread:${threadId}` });
    }
    if (input.resourceType === "TASK") {
      const task = await prisma.task.findUnique({ where: { id: input.resourceId }, select: { assigneeId: true, reporterId: true } });
      for (const uid of [task?.assigneeId, task?.reporterId]) {
        if (uid && !notified.has(uid)) {
          notified.add(uid);
          await notify({ userId: uid, type: "COMMENT", title: `${req.user!.name} commented on ${resource.title}`, body: truncate(input.body, 160), href, actorId: req.user!.id, workspaceId: resource.workspaceId, resourceType: "TASK", resourceId: input.resourceId, groupKey: `thread:${threadId}` });
        }
      }
      await prisma.taskActivity.create({ data: { taskId: input.resourceId, actorId: req.user!.id, type: "comment", payload: { threadId, commentId: comment.id } } });
    }
    created(res, { threadId, comment: shapeComment(comment) });
  }),
);

commentsRouter.patch(
  "/:commentId",
  h(async (req, res) => {
    const id = requireParam(req, "commentId");
    const comment = await prisma.comment.findUnique({ where: { id }, include: { thread: true } });
    if (!comment || comment.deletedAt) throw notFound("Comment");
    const { access } = await assertAccess(req.user, comment.thread.resourceType, comment.thread.resourceId, "COMMENTER");
    if (comment.authorId !== req.user!.id && access !== "OWNER") throw forbidden("You can only edit your own comments");
    const input = parseBody(UpdateCommentInput, req.body);
    const updated = await prisma.comment.update({ where: { id }, data: { body: input.body, editedAt: new Date() }, include: commentInclude });
    emit([ch.resource(comment.thread.resourceType, comment.thread.resourceId)], { t: "comment:updated", p: { resourceType: comment.thread.resourceType, resourceId: comment.thread.resourceId, threadId: comment.threadId, action: "updated" } });
    ok(res, shapeComment(updated));
  }),
);

commentsRouter.delete(
  "/:commentId",
  h(async (req, res) => {
    const id = requireParam(req, "commentId");
    const comment = await prisma.comment.findUnique({ where: { id }, include: { thread: { include: { _count: { select: { comments: { where: { deletedAt: null } } } } } } } });
    if (!comment || comment.deletedAt) throw notFound("Comment");
    const { access } = await assertAccess(req.user, comment.thread.resourceType, comment.thread.resourceId, "COMMENTER");
    if (comment.authorId !== req.user!.id && access !== "OWNER") throw forbidden("You can only delete your own comments");
    await prisma.comment.update({ where: { id }, data: { deletedAt: new Date(), body: "" } });
    if (comment.thread._count.comments <= 1) await prisma.commentThread.delete({ where: { id: comment.threadId } }).catch(() => {});
    emit([ch.resource(comment.thread.resourceType, comment.thread.resourceId)], { t: "comment:updated", p: { resourceType: comment.thread.resourceType, resourceId: comment.thread.resourceId, threadId: comment.threadId, action: "deleted" } });
    noContent(res);
  }),
);

commentsRouter.post(
  "/:commentId/reactions",
  h(async (req, res) => {
    const id = requireParam(req, "commentId");
    const comment = await prisma.comment.findUnique({ where: { id }, include: { thread: true } });
    if (!comment) throw notFound("Comment");
    await assertAccess(req.user, comment.thread.resourceType, comment.thread.resourceId, "VIEWER");
    const { emoji } = parseBody(ReactionInput, req.body);
    const key = { commentId: id, userId: req.user!.id, emoji };
    const existing = await prisma.commentReaction.findUnique({ where: { commentId_userId_emoji: key } });
    if (existing) await prisma.commentReaction.delete({ where: { commentId_userId_emoji: key } });
    else await prisma.commentReaction.create({ data: key });
    const updated = await prisma.comment.findUniqueOrThrow({ where: { id }, include: commentInclude });
    emit([ch.resource(comment.thread.resourceType, comment.thread.resourceId)], { t: "comment:updated", p: { resourceType: comment.thread.resourceType, resourceId: comment.thread.resourceId, threadId: comment.threadId, action: "updated" } });
    ok(res, shapeComment(updated));
  }),
);

threadsRouter.post(
  "/:threadId/resolve",
  h(async (req, res) => {
    const id = requireParam(req, "threadId");
    const thread = await prisma.commentThread.findUnique({ where: { id } });
    if (!thread) throw notFound("Thread");
    await assertAccess(req.user, thread.resourceType, thread.resourceId, "COMMENTER");
    const { resolved } = parseBody(z.object({ resolved: z.boolean() }), req.body);
    const updated = await prisma.commentThread.update({ where: { id }, data: { resolvedAt: resolved ? new Date() : null, resolvedById: resolved ? req.user!.id : null } });
    emit([ch.resource(thread.resourceType, thread.resourceId)], { t: "comment:updated", p: { resourceType: thread.resourceType, resourceId: thread.resourceId, threadId: id, action: resolved ? "resolved" : "reopened" } });
    ok(res, updated);
  }),
);

/** Comment → follow-up task */
threadsRouter.post(
  "/:threadId/convert-to-task",
  h(async (req, res) => {
    const id = requireParam(req, "threadId");
    const thread = await prisma.commentThread.findUnique({ where: { id }, include: { comments: { orderBy: { createdAt: "asc" }, take: 1 } } });
    if (!thread) throw notFound("Thread");
    const { resource } = await assertAccess(req.user, thread.resourceType, thread.resourceId, "COMMENTER");
    const input = parseBody(z.object({ projectId: z.string(), title: z.string().min(1).max(300).optional(), assigneeId: z.string().nullable().optional() }), req.body);
    await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const first = thread.comments[0];
    const { nextTaskNumber } = await import("../services/projects.js");
    const { shapeTask, taskInclude } = await import("./tasks.js");
    const board = await prisma.board.findFirst({ where: { projectId: input.projectId, isDefault: true }, include: { columns: { orderBy: { position: "asc" } } } });
    const task = await prisma.$transaction(async (tx) => {
      const number = await nextTaskNumber(tx, input.projectId);
      return tx.task.create({
        data: {
          workspaceId: resource.workspaceId,
          projectId: input.projectId,
          number,
          title: (input.title ?? first?.body ?? "Follow-up").split("\n")[0]!.slice(0, 300),
          description: first ? `From a comment on ${resource.title}:\n\n> ${first.body}` : "",
          status: board?.columns[0]?.statusKey ?? "todo",
          reporterId: req.user!.id,
          assigneeId: input.assigneeId ?? null,
          position: Date.now(),
          sourceType: "comment",
          sourceId: id,
          sourceMeta: { resourceType: thread.resourceType, resourceId: thread.resourceId, title: resource.title },
          activities: { create: { actorId: req.user!.id, type: "created", payload: { from: "comment", threadId: id } } },
        },
        include: taskInclude,
      });
    });
    const shaped = shapeTask(task);
    emit([ch.project(input.projectId), ch.workspace(resource.workspaceId)], { t: "task:updated", p: { workspaceId: resource.workspaceId, projectId: input.projectId, taskId: task.id, action: "created", task: shaped as unknown as Record<string, unknown>, actorId: req.user!.id } });
    created(res, shaped);
  }),
);
