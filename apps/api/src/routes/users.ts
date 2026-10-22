import { Router } from "express";
import { prisma, type ResourceType } from "@collabspace/db";
import { UpdateProfileInput, ChangePasswordInput, FavoriteInput } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, ok, noContent, parseQuery } from "../lib/http.js";
import { hashPassword, verifyPassword } from "../lib/crypto.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { revokeAllSessions } from "../services/sessions.js";
import { publicUser } from "./auth.js";
import { loadResource, resolveAccess } from "../services/access.js";
import { accessAtLeast } from "@collabspace/shared";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.patch(
  "/me",
  h(async (req, res) => {
    const input = parseBody(UpdateProfileInput, req.body);
    const current = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { preferences: true } });
    const preferences = input.preferences ? { ...((current?.preferences as object) ?? {}), ...input.preferences } : undefined;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        name: input.name,
        avatarUrl: input.avatarUrl,
        color: input.color,
        timezone: input.timezone,
        onboardingDone: input.onboardingDone,
        ...(preferences ? { preferences: preferences as object } : {}),
      },
    });
    ok(res, publicUser(user));
  }),
);

usersRouter.post(
  "/me/password",
  h(async (req, res) => {
    const input = parseBody(ChangePasswordInput, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) throw badRequest("Current password is incorrect");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
    const revoked = await revokeAllSessions(user.id, req.sessionId);
    ok(res, { changed: true, otherSessionsRevoked: revoked });
  }),
);

usersRouter.delete(
  "/me",
  h(async (req, res) => {
    // Soft-delete: anonymise and revoke sessions. Owned workspaces must be transferred first.
    const owned = await prisma.workspace.count({ where: { ownerId: req.user!.id, deletedAt: null, members: { some: { userId: { not: req.user!.id } } } } });
    if (owned > 0) throw badRequest("Transfer ownership of your shared workspaces before deleting your account");
    await prisma.$transaction([
      prisma.workspace.updateMany({ where: { ownerId: req.user!.id }, data: { deletedAt: new Date() } }),
      prisma.user.update({
        where: { id: req.user!.id },
        data: { deletedAt: new Date(), email: `deleted-${req.user!.id}@deleted.local`, name: "Deleted user", avatarUrl: null, passwordHash: null },
      }),
      prisma.session.updateMany({ where: { userId: req.user!.id }, data: { revokedAt: new Date() } }),
    ]);
    noContent(res);
  }),
);

// ---- Favorites & recents -----------------------------------------------------

async function hydrateResources(userId: string, rows: Array<{ resourceType: ResourceType; resourceId: string }>) {
  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const resource = await loadResource(r.resourceType, r.resourceId);
    if (!resource) continue;
    const access = await resolveAccess({ id: userId } as Express.AuthUser, r.resourceType, r.resourceId).catch(() => null);
    if (!access || !accessAtLeast(access.access, "VIEWER")) continue;
    const ws = await prisma.workspace.findUnique({ where: { id: resource.workspaceId }, select: { slug: true, name: true } });
    out.push({ ...r, title: resource.title, workspaceId: resource.workspaceId, workspaceSlug: ws?.slug, workspaceName: ws?.name, projectId: resource.projectId });
  }
  return out;
}

usersRouter.get(
  "/me/favorites",
  h(async (req, res) => {
    const rows = await prisma.favorite.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } });
    ok(res, await hydrateResources(req.user!.id, rows));
  }),
);

usersRouter.post(
  "/me/favorites",
  h(async (req, res) => {
    const input = parseBody(FavoriteInput, req.body);
    const existing = await prisma.favorite.findUnique({ where: { userId_resourceType_resourceId: { userId: req.user!.id, ...input } } });
    if (existing) {
      await prisma.favorite.delete({ where: { userId_resourceType_resourceId: { userId: req.user!.id, ...input } } });
      return ok(res, { favorite: false });
    }
    const r = await loadResource(input.resourceType, input.resourceId);
    if (!r) throw notFound();
    await prisma.favorite.create({ data: { userId: req.user!.id, ...input } });
    ok(res, { favorite: true });
  }),
);

usersRouter.get(
  "/me/recent",
  h(async (req, res) => {
    const rows = await prisma.recentItem.findMany({ where: { userId: req.user!.id }, orderBy: { openedAt: "desc" }, take: 40 });
    const items = await hydrateResources(req.user!.id, rows);
    ok(res, items.map((it, i) => ({ ...it, openedAt: rows[i]?.openedAt })));
  }),
);

usersRouter.post(
  "/me/recent",
  h(async (req, res) => {
    const input = parseBody(FavoriteInput.extend({ workspaceId: z.string() }), req.body);
    await prisma.recentItem.upsert({
      where: { userId_resourceType_resourceId: { userId: req.user!.id, resourceType: input.resourceType, resourceId: input.resourceId } },
      update: { openedAt: new Date() },
      create: { userId: req.user!.id, ...input },
    });
    noContent(res);
  }),
);

usersRouter.get(
  "/me/search-history",
  h(async (req, res) => {
    const rows = await prisma.searchHistory.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" }, take: 10, distinct: ["query"] });
    ok(res, rows);
  }),
);

usersRouter.delete(
  "/me/search-history",
  h(async (req, res) => {
    await prisma.searchHistory.deleteMany({ where: { userId: req.user!.id } });
    noContent(res);
  }),
);

usersRouter.get(
  "/lookup",
  h(async (req, res) => {
    const q = parseQuery(z.object({ workspaceId: z.string(), q: z.string().default("") }), req.query);
    const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: q.workspaceId, userId: req.user!.id } } });
    if (!member) throw notFound("Workspace");
    const rows = await prisma.workspaceMember.findMany({
      where: { workspaceId: q.workspaceId, user: { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] } },
      take: 10,
      select: { user: { select: { id: true, name: true, avatarUrl: true, color: true, email: true } } },
    });
    ok(res, rows.map((r) => r.user));
  }),
);
