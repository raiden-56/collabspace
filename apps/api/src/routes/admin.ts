import { Router } from "express";
import { prisma } from "@collabspace/db";
import { z } from "zod";
import { h, parseBody, parseQuery, ok, requireParam, toPage } from "../lib/http.js";
import { Pagination } from "@collabspace/shared";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { redisReady } from "../lib/redis.js";
import { storage } from "../lib/storage.js";
import { aiStatus } from "../services/ai/provider.js";
import { config } from "../config.js";
import { publicUser } from "./auth.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requirePlatformAdmin);

adminRouter.get(
  "/users",
  h(async (req, res) => {
    const q = parseQuery(Pagination.extend({ q: z.string().optional() }), req.query);
    const rows = await prisma.user.findMany({
      where: q.q ? { OR: [{ email: { contains: q.q, mode: "insensitive" } }, { name: { contains: q.q, mode: "insensitive" } }] } : {},
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { _count: { select: { workspaceMembers: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } } },
    });
    ok(res, toPage(rows.map((u) => ({ ...publicUser(u), disabledAt: u.disabledAt, deletedAt: u.deletedAt, workspaces: u._count.workspaceMembers, activeSessions: u._count.sessions })), q.limit));
  }),
);

adminRouter.patch(
  "/users/:userId",
  h(async (req, res) => {
    const id = requireParam(req, "userId");
    const input = parseBody(z.object({ disabled: z.boolean().optional(), platformRole: z.enum(["USER", "ADMIN"]).optional(), emailVerified: z.boolean().optional() }), req.body);
    if (id === req.user!.id && (input.disabled || input.platformRole === "USER")) throw badRequest("You cannot disable or demote yourself");
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound("User");
    const updated = await prisma.user.update({ where: { id }, data: { disabledAt: input.disabled === undefined ? undefined : input.disabled ? new Date() : null, platformRole: input.platformRole, emailVerifiedAt: input.emailVerified === undefined ? undefined : input.emailVerified ? new Date() : null } });
    if (input.disabled) await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ action: "admin.user_updated", req, resourceType: "USER", resourceId: id, metadata: input });
    ok(res, publicUser(updated));
  }),
);

adminRouter.get(
  "/workspaces",
  h(async (req, res) => {
    const q = parseQuery(Pagination.extend({ q: z.string().optional() }), req.query);
    const rows = await prisma.workspace.findMany({
      where: q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { slug: { contains: q.q, mode: "insensitive" } }] } : {},
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { owner: { select: { id: true, name: true, email: true } }, _count: { select: { members: true, projects: true, documents: true, canvases: true } } },
    });
    ok(res, toPage(rows, q.limit));
  }),
);

adminRouter.patch(
  "/workspaces/:workspaceId",
  h(async (req, res) => {
    const id = requireParam(req, "workspaceId");
    const input = parseBody(z.object({ deleted: z.boolean() }), req.body);
    const ws = await prisma.workspace.update({ where: { id }, data: { deletedAt: input.deleted ? new Date() : null } });
    await audit({ action: input.deleted ? "admin.workspace_deleted" : "admin.workspace_restored", req, workspaceId: id });
    ok(res, ws);
  }),
);

adminRouter.get(
  "/audit-logs",
  h(async (req, res) => {
    const q = parseQuery(Pagination.extend({ action: z.string().optional(), workspaceId: z.string().optional(), actorId: z.string().optional() }), req.query);
    const rows = await prisma.auditLog.findMany({
      where: { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.workspaceId ? { workspaceId: q.workspaceId } : {}), ...(q.actorId ? { actorId: q.actorId } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, name: true, email: true } }, workspace: { select: { id: true, name: true, slug: true } } },
    });
    ok(res, toPage(rows, q.limit));
  }),
);

adminRouter.get(
  "/system",
  h(async (_req, res) => {
    const [users, workspaces, sessions, aiJobs, pendingJobs, failedJobs, collabDocs] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.workspace.count({ where: { deletedAt: null } }),
      prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.aIJob.count(),
      prisma.aIJob.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }),
      prisma.aIJob.count({ where: { status: "FAILED" } }),
      prisma.collabDoc.count(),
    ]);
    let dbOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    let syncOk = false;
    try {
      const r = await fetch(`${config.SYNC_URL}/health`, { signal: AbortSignal.timeout(1500) });
      syncOk = r.ok;
    } catch {
      syncOk = false;
    }
    ok(res, {
      version: "0.1.0",
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      services: { database: dbOk, redis: redisReady(), sync: syncOk, storage: storage().name, email: config.EMAIL_DRIVER, ai: aiStatus() },
      counts: { users, workspaces, activeSessions: sessions, aiJobs, pendingJobs, failedJobs, collabDocs },
      memory: process.memoryUsage().rss,
    });
  }),
);

adminRouter.post(
  "/jobs/:jobId/retry",
  h(async (req, res) => {
    const id = requireParam(req, "jobId");
    const job = await prisma.aIJob.findUnique({ where: { id } });
    if (!job) throw notFound("Job");
    ok(res, await prisma.aIJob.update({ where: { id }, data: { status: "QUEUED", error: null, attempts: 0 } }));
  }),
);

