import { Router } from "express";
import { prisma } from "@collabspace/db";
import { CreateShareLinkInput, GrantPermissionInput, UpdatePermissionInput, ResourceTypeSchema, shareLinkIsActive, canShare } from "@collabspace/shared";
import { z } from "zod";
import { config } from "../config.js";
import { h, parseBody, parseQuery, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { hashToken, randomToken } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { recordActivity } from "../lib/activity.js";
import { rateLimit } from "../lib/rateLimit.js";
import { assertAccess, loadResource } from "../services/access.js";
import { runAutomations } from "../services/automation.js";

export const shareLinksRouter = Router();
export const sharedRouter = Router();
export const permissionsRouter = Router();
shareLinksRouter.use(requireAuth);
permissionsRouter.use(requireAuth);

const SHAREABLE = new Set(["CANVAS", "DOCUMENT", "PROJECT", "BOARD", "MEETING", "FILE"]);

shareLinksRouter.post(
  "/",
  h(async (req, res) => {
    const input = parseBody(CreateShareLinkInput, req.body);
    if (!SHAREABLE.has(input.resourceType)) throw badRequest("This resource type cannot be shared by link");
    const { resource, access } = await assertAccess(req.user, input.resourceType, input.resourceId, "EDITOR");
    if (!canShare(access)) throw forbidden();
    if (input.level === "EDITOR" && !input.requireLogin) throw badRequest("Edit access through a link requires sign-in");
    const token = randomToken(24);
    const link = await prisma.shareLink.create({
      data: {
        workspaceId: resource.workspaceId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 6),
        level: input.level,
        requireLogin: input.requireLogin,
        expiresAt: input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 60 * 60_000) : null,
        createdById: req.user!.id,
      },
    });
    await audit({ action: "share.link_created", workspaceId: resource.workspaceId, req, resourceType: input.resourceType, resourceId: input.resourceId, metadata: { level: input.level, requireLogin: input.requireLogin, expiresAt: link.expiresAt } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "share.link_created", resourceType: input.resourceType, resourceId: input.resourceId, resourceTitle: resource.title, payload: { level: input.level } });
    // The raw token is only returned once.
    created(res, { ...link, url: `${config.APP_URL}/share/${token}` });
  }),
);

shareLinksRouter.get(
  "/",
  h(async (req, res) => {
    const q = parseQuery(z.object({ resourceType: ResourceTypeSchema, resourceId: z.string() }), req.query);
    const { access } = await assertAccess(req.user, q.resourceType, q.resourceId, "EDITOR");
    if (!canShare(access)) throw forbidden();
    const links = await prisma.shareLink.findMany({ where: { resourceType: q.resourceType, resourceId: q.resourceId }, orderBy: { createdAt: "desc" }, include: { createdBy: { select: { id: true, name: true } } } });
    ok(res, links.map((l) => ({ ...l, active: shareLinkIsActive(l) })));
  }),
);

shareLinksRouter.delete(
  "/:shareLinkId",
  h(async (req, res) => {
    const id = requireParam(req, "shareLinkId");
    const link = await prisma.shareLink.findUnique({ where: { id } });
    if (!link) throw notFound("Share link");
    const { access, resource } = await assertAccess(req.user, link.resourceType, link.resourceId, "EDITOR");
    if (!canShare(access)) throw forbidden();
    await prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit({ action: "share.link_revoked", workspaceId: resource.workspaceId, req, resourceType: link.resourceType, resourceId: link.resourceId });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "share.link_revoked", resourceType: link.resourceType, resourceId: link.resourceId, resourceTitle: resource.title });
    noContent(res);
  }),
);

shareLinksRouter.patch(
  "/:shareLinkId",
  h(async (req, res) => {
    const id = requireParam(req, "shareLinkId");
    const link = await prisma.shareLink.findUnique({ where: { id } });
    if (!link) throw notFound("Share link");
    const { access } = await assertAccess(req.user, link.resourceType, link.resourceId, "EDITOR");
    if (!canShare(access)) throw forbidden();
    const input = parseBody(z.object({ level: z.enum(["VIEWER", "COMMENTER", "EDITOR"]).optional(), expiresInHours: z.number().int().min(1).nullable().optional(), requireLogin: z.boolean().optional() }), req.body);
    const requireLogin = input.requireLogin ?? link.requireLogin;
    if ((input.level ?? link.level) === "EDITOR" && !requireLogin) throw badRequest("Edit access through a link requires sign-in");
    ok(res, await prisma.shareLink.update({ where: { id }, data: { level: input.level, requireLogin, expiresAt: input.expiresInHours === undefined ? undefined : input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3600_000) : null } }));
  }),
);

/** Resolve a share token to the resource (public or login-required). Rate limited to slow down guessing. */
sharedRouter.get(
  "/:token",
  rateLimit({ name: "share-resolve", windowMs: 60_000, max: 60 }),
  h(async (req, res) => {
    const token = requireParam(req, "token");
    const link = await prisma.shareLink.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!link || !shareLinkIsActive(link)) throw notFound("Shared resource");
    if (link.requireLogin && !req.user) {
      res.status(401).json({ error: { code: "login_required", message: "Sign in to open this shared resource" } });
      return;
    }
    const resource = await loadResource(link.resourceType, link.resourceId);
    if (!resource) throw notFound("Shared resource");
    const ws = await prisma.workspace.findUnique({ where: { id: resource.workspaceId }, select: { slug: true, name: true } });
    await prisma.shareLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastAccessAt: new Date() } });
    ok(res, { resourceType: link.resourceType, resourceId: link.resourceId, title: resource.title, level: link.level, workspace: ws, expiresAt: link.expiresAt, requireLogin: link.requireLogin });
  }),
);

// ---- Direct user grants ---------------------------------------------------------

const grantInclude = { user: { select: { id: true, name: true, email: true, avatarUrl: true, color: true } }, grantedBy: { select: { id: true, name: true } } } as const;

permissionsRouter.get(
  "/",
  h(async (req, res) => {
    const q = parseQuery(z.object({ resourceType: ResourceTypeSchema, resourceId: z.string() }), req.query);
    const { resource, access } = await assertAccess(req.user, q.resourceType, q.resourceId, "VIEWER");
    const grants = await prisma.resourcePermission.findMany({ where: { resourceType: q.resourceType, resourceId: q.resourceId }, include: grantInclude, orderBy: { createdAt: "asc" } });
    ok(res, { grants, visibility: resource.visibility, ownerId: resource.ownerId, canManage: canShare(access) });
  }),
);

permissionsRouter.post(
  "/",
  h(async (req, res) => {
    const input = parseBody(GrantPermissionInput, req.body);
    const { resource, access } = await assertAccess(req.user, input.resourceType, input.resourceId, "EDITOR");
    if (!canShare(access)) throw forbidden();
    let userId = input.userId;
    if (!userId && input.email) {
      const u = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
      if (!u) throw notFound("User with that email");
      userId = u.id;
    }
    if (!userId) throw badRequest("userId or email is required");
    const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: resource.workspaceId, userId } } });
    if (!member) throw badRequest("The user must be a workspace member or guest first — invite them to the workspace");
    const grant = await prisma.resourcePermission.upsert({
      where: { resourceType_resourceId_userId: { resourceType: input.resourceType, resourceId: input.resourceId, userId } },
      update: { level: input.level, grantedById: req.user!.id },
      create: { workspaceId: resource.workspaceId, resourceType: input.resourceType, resourceId: input.resourceId, userId, level: input.level, grantedById: req.user!.id },
      include: grantInclude,
    });
    await audit({ action: "share.granted", workspaceId: resource.workspaceId, req, resourceType: input.resourceType, resourceId: input.resourceId, metadata: { userId, level: input.level } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "share.granted", resourceType: input.resourceType, resourceId: input.resourceId, resourceTitle: resource.title, payload: { userId, level: input.level } });
    await runAutomations({ workspaceId: resource.workspaceId, trigger: "resource.shared", actorId: req.user!.id, share: { resourceType: input.resourceType, resourceId: input.resourceId, title: resource.title, granteeId: userId } });
    created(res, grant);
  }),
);

permissionsRouter.patch(
  "/:permissionId",
  h(async (req, res) => {
    const id = requireParam(req, "permissionId");
    const grant = await prisma.resourcePermission.findUnique({ where: { id } });
    if (!grant) throw notFound("Permission");
    const { access } = await assertAccess(req.user, grant.resourceType, grant.resourceId, "EDITOR");
    if (!canShare(access)) throw forbidden();
    const input = parseBody(UpdatePermissionInput, req.body);
    ok(res, await prisma.resourcePermission.update({ where: { id }, data: { level: input.level }, include: grantInclude }));
  }),
);

permissionsRouter.delete(
  "/:permissionId",
  h(async (req, res) => {
    const id = requireParam(req, "permissionId");
    const grant = await prisma.resourcePermission.findUnique({ where: { id } });
    if (!grant) throw notFound("Permission");
    const { access, resource } = await assertAccess(req.user, grant.resourceType, grant.resourceId, "EDITOR");
    if (!canShare(access) && grant.userId !== req.user!.id) throw forbidden();
    await prisma.resourcePermission.delete({ where: { id } });
    await audit({ action: "share.revoked", workspaceId: resource.workspaceId, req, resourceType: grant.resourceType, resourceId: grant.resourceId, metadata: { userId: grant.userId } });
    noContent(res);
  }),
);
