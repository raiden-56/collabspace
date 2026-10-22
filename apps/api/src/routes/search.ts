import { Router } from "express";
import { prisma, Prisma } from "@collabspace/db";
import { SearchQuery } from "@collabspace/shared";
import { h, parseQuery, ok } from "../lib/http.js";
import { requireAuth } from "../middleware/auth.js";
import { requireWorkspaceRole, visibleResourceWhere, memberProjectIds } from "../services/access.js";

export const searchRouter = Router();
searchRouter.use(requireAuth);

export interface SearchHit {
  type: "DOCUMENT" | "CANVAS" | "PROJECT" | "TASK" | "COMMENT" | "MESSAGE" | "MEETING" | "FILE";
  id: string;
  title: string;
  snippet: string;
  href: string;
  projectId?: string | null;
  updatedAt: Date;
  rank: number;
  meta?: Record<string, unknown>;
}

/** Build a websearch tsquery string safely (Postgres handles quoting via websearch_to_tsquery). */
function tsq(q: string) {
  return Prisma.sql`websearch_to_tsquery('english', ${q})`;
}

function snippetOf(text: string, q: string, len = 160): string {
  const idx = text.toLowerCase().indexOf(q.toLowerCase().split(/\s+/)[0] ?? "");
  const start = Math.max(0, idx - 60);
  const s = text.slice(start, start + len).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + s + (start + len < text.length ? "…" : "");
}

function highlight(text: string, q: string): string {
  const terms = q.split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return text;
  return text.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>");
}

/**
 * Permission-aware search. Every branch applies the same visibility rules as the list endpoints,
 * so restricted content never appears in snippets or counts. PostgreSQL full-text search with
 * ILIKE fallback for short/partial terms.
 */
searchRouter.get(
  "/",
  h(async (req, res) => {
    const q = parseQuery(SearchQuery, req.query);
    const role = await requireWorkspaceRole(req.user, q.workspaceId);
    const user = req.user!;
    const types = new Set((q.types ?? "DOCUMENT,CANVAS,PROJECT,TASK,COMMENT,MESSAGE,MEETING,FILE").split(",").map((t) => t.trim().toUpperCase()));
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: q.workspaceId }, select: { slug: true } });
    const slug = ws.slug;
    const text = q.q.trim();
    const hits: SearchHit[] = [];
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    const dateWhere = from || to ? { updatedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const visibleProjectIds = isAdmin ? null : (await prisma.project.findMany({ where: { workspaceId: q.workspaceId, deletedAt: null, ...(await visibleResourceWhere(user, q.workspaceId, "PROJECT", role)) }, select: { id: true } })).map((p) => p.id);

    if (text.length === 0) {
      await recordSearch(user.id, text);
      return ok(res, { hits: [], suggestions: await suggestions(q.workspaceId, user.id) });
    }
    const useFts = text.length >= 3;

    if (types.has("DOCUMENT")) {
      const where = { workspaceId: q.workspaceId, deletedAt: null, ...(await visibleResourceWhere(user, q.workspaceId, "DOCUMENT", role)), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.ownerId ? { createdById: q.ownerId } : {}), ...dateWhere };
      let ids: Array<{ id: string; rank: number }> = [];
      if (useFts) {
        ids = await prisma.$queryRaw<Array<{ id: string; rank: number }>>`SELECT id, ts_rank(to_tsvector('english', title || ' ' || "contentText"), ${tsq(text)}) AS rank FROM "Document" WHERE "workspaceId" = ${q.workspaceId} AND "deletedAt" IS NULL AND to_tsvector('english', title || ' ' || "contentText") @@ ${tsq(text)} ORDER BY rank DESC LIMIT 50`;
      }
      const rows = await prisma.document.findMany({ where: { ...where, ...(ids.length ? { id: { in: ids.map((i) => i.id) } } : { OR: [{ title: { contains: text, mode: "insensitive" } }, { contentText: { contains: text, mode: "insensitive" } }] }) }, take: q.limit, select: { id: true, title: true, icon: true, contentText: true, projectId: true, updatedAt: true } });
      for (const r of rows) hits.push({ type: "DOCUMENT", id: r.id, title: r.title, snippet: highlight(snippetOf(r.contentText, text), text), href: `/app/${slug}/docs/${r.id}`, projectId: r.projectId, updatedAt: r.updatedAt, rank: ids.find((i) => i.id === r.id)?.rank ?? 0.1, meta: { icon: r.icon } });
    }
    if (types.has("CANVAS")) {
      const where = { workspaceId: q.workspaceId, deletedAt: null, ...(await visibleResourceWhere(user, q.workspaceId, "CANVAS", role)), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.ownerId ? { createdById: q.ownerId } : {}), ...dateWhere };
      const rows = await prisma.canvas.findMany({ where: { ...where, OR: [{ title: { contains: text, mode: "insensitive" } }, { contentText: { contains: text, mode: "insensitive" } }] }, take: q.limit, select: { id: true, title: true, contentText: true, projectId: true, updatedAt: true } });
      for (const r of rows) hits.push({ type: "CANVAS", id: r.id, title: r.title, snippet: highlight(snippetOf(r.contentText, text), text), href: `/app/${slug}/canvas/${r.id}`, projectId: r.projectId, updatedAt: r.updatedAt, rank: r.title.toLowerCase().includes(text.toLowerCase()) ? 0.5 : 0.2 });
    }
    if (types.has("PROJECT")) {
      const rows = await prisma.project.findMany({ where: { workspaceId: q.workspaceId, deletedAt: null, ...(visibleProjectIds ? { id: { in: visibleProjectIds } } : {}), OR: [{ name: { contains: text, mode: "insensitive" } }, { description: { contains: text, mode: "insensitive" } }, { key: { equals: text.toUpperCase() } }], ...dateWhere }, take: q.limit, select: { id: true, name: true, key: true, description: true, updatedAt: true, color: true } });
      for (const r of rows) hits.push({ type: "PROJECT", id: r.id, title: r.name, snippet: highlight(snippetOf(r.description ?? "", text), text), href: `/app/${slug}/projects/${r.id}`, projectId: r.id, updatedAt: r.updatedAt, rank: 0.4, meta: { key: r.key, color: r.color } });
    }
    if (types.has("TASK")) {
      const keyMatch = text.match(/^([A-Za-z0-9]{2,6})-(\d+)$/);
      const rows = await prisma.task.findMany({
        where: {
          workspaceId: q.workspaceId,
          deletedAt: null,
          ...(visibleProjectIds ? { projectId: { in: visibleProjectIds } } : {}),
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.ownerId ? { OR: [{ assigneeId: q.ownerId }, { reporterId: q.ownerId }] } : {}),
          ...dateWhere,
          ...(keyMatch ? { number: Number(keyMatch[2]), project: { key: keyMatch[1]!.toUpperCase() } } : { OR: [{ title: { contains: text, mode: "insensitive" } }, { description: { contains: text, mode: "insensitive" } }] }),
        },
        take: q.limit,
        select: { id: true, title: true, description: true, status: true, number: true, projectId: true, updatedAt: true, priority: true, project: { select: { key: true } }, assignee: { select: { name: true } } },
      });
      for (const r of rows) hits.push({ type: "TASK", id: r.id, title: `${r.project.key}-${r.number} ${r.title}`, snippet: highlight(snippetOf(r.description, text), text), href: `/app/${slug}/tasks?task=${r.id}`, projectId: r.projectId, updatedAt: r.updatedAt, rank: keyMatch ? 1 : 0.35, meta: { status: r.status, priority: r.priority, assignee: r.assignee?.name } });
    }
    if (types.has("MEETING")) {
      const rows = await prisma.meeting.findMany({ where: { workspaceId: q.workspaceId, deletedAt: null, ...(isAdmin ? {} : { OR: [{ visibility: "WORKSPACE", ...(role === "GUEST" ? { participants: { some: { userId: user.id } } } : {}) }, { participants: { some: { userId: user.id } } }, { createdById: user.id }] }), AND: [{ OR: [{ title: { contains: text, mode: "insensitive" } }, { description: { contains: text, mode: "insensitive" } }, { transcripts: { some: { content: { contains: text, mode: "insensitive" } } } }, { decisions: { some: { text: { contains: text, mode: "insensitive" } } } }] }], ...(q.projectId ? { projectId: q.projectId } : {}), ...dateWhere }, take: q.limit, select: { id: true, title: true, description: true, startsAt: true, projectId: true, updatedAt: true, status: true } });
      for (const r of rows) hits.push({ type: "MEETING", id: r.id, title: r.title, snippet: highlight(snippetOf(r.description ?? "", text), text), href: `/app/${slug}/meetings/${r.id}`, projectId: r.projectId, updatedAt: r.updatedAt, rank: 0.3, meta: { startsAt: r.startsAt, status: r.status } });
    }
    if (types.has("COMMENT")) {
      const rows = await prisma.comment.findMany({ where: { deletedAt: null, body: { contains: text, mode: "insensitive" }, thread: { workspaceId: q.workspaceId } }, take: q.limit * 2, include: { thread: true, author: { select: { name: true } } }, orderBy: { createdAt: "desc" } });
      const { resolveAccess } = await import("../services/access.js");
      const { accessAtLeast } = await import("@collabspace/shared");
      for (const r of rows) {
        if (hits.filter((h) => h.type === "COMMENT").length >= q.limit) break;
        const a = await resolveAccess(user, r.thread.resourceType, r.thread.resourceId).catch(() => null);
        if (!a || !accessAtLeast(a.access, "VIEWER")) continue;
        const base = r.thread.resourceType === "CANVAS" ? `/app/${slug}/canvas/${r.thread.resourceId}` : r.thread.resourceType === "DOCUMENT" ? `/app/${slug}/docs/${r.thread.resourceId}` : r.thread.resourceType === "TASK" ? `/app/${slug}/tasks?task=${r.thread.resourceId}` : r.thread.resourceType === "MEETING" ? `/app/${slug}/meetings/${r.thread.resourceId}` : `/app/${slug}/projects/${r.thread.resourceId}`;
        hits.push({ type: "COMMENT", id: r.id, title: `${r.author.name} on ${a.resource.title}`, snippet: highlight(snippetOf(r.body, text), text), href: `${base}${base.includes("?") ? "&" : "?"}thread=${r.threadId}`, projectId: a.resource.projectId, updatedAt: r.createdAt, rank: 0.25 });
      }
    }
    if (types.has("MESSAGE")) {
      const rows = await prisma.message.findMany({ where: { deletedAt: null, body: { contains: text, mode: "insensitive" }, channel: { workspaceId: q.workspaceId, archivedAt: null, OR: [{ members: { some: { userId: user.id } } }, ...(role !== "GUEST" ? [{ type: "PUBLIC" as const }] : [])] } }, take: q.limit, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } }, channel: { select: { id: true, name: true, type: true } } } });
      for (const r of rows) hits.push({ type: "MESSAGE", id: r.id, title: `${r.author.name} in ${r.channel.name ? `#${r.channel.name}` : "direct message"}`, snippet: highlight(snippetOf(r.body, text), text), href: `/app/${slug}/chat?channel=${r.channel.id}&message=${r.id}`, updatedAt: r.createdAt, rank: 0.2 });
    }
    if (types.has("FILE")) {
      const rows = await prisma.fileAsset.findMany({ where: { workspaceId: q.workspaceId, deletedAt: null, status: "READY", name: { contains: text, mode: "insensitive" }, ...(q.projectId ? { projectId: q.projectId } : {}), ...(visibleProjectIds ? { OR: [{ projectId: null }, { projectId: { in: visibleProjectIds } }] } : {}) }, take: q.limit, select: { id: true, name: true, mimeType: true, sizeBytes: true, projectId: true, updatedAt: true } });
      for (const r of rows) hits.push({ type: "FILE", id: r.id, title: r.name, snippet: `${r.mimeType} · ${(r.sizeBytes / 1024).toFixed(0)} KB`, href: `/app/${slug}/files?file=${r.id}`, projectId: r.projectId, updatedAt: r.updatedAt, rank: 0.2 });
    }

    hits.sort((a, b) => b.rank - a.rank || b.updatedAt.getTime() - a.updatedAt.getTime());
    await recordSearch(user.id, text);
    ok(res, { hits: hits.slice(0, q.limit * 3), suggestions: [] });
  }),
);

async function recordSearch(userId: string, query: string) {
  if (!query) return;
  await prisma.searchHistory.create({ data: { userId, query } }).catch(() => {});
  const extra = await prisma.searchHistory.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: 50, select: { id: true } });
  if (extra.length) await prisma.searchHistory.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
}

async function suggestions(workspaceId: string, userId: string) {
  const [recent, history] = await Promise.all([
    prisma.recentItem.findMany({ where: { userId, workspaceId }, orderBy: { openedAt: "desc" }, take: 5 }),
    prisma.searchHistory.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5, distinct: ["query"] }),
  ]);
  return { recent, history: history.map((h) => h.query) };
}

export { memberProjectIds };
