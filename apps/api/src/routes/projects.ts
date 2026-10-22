import { Router } from "express";
import { prisma } from "@collabspace/db";
import { CreateProjectInput, UpdateProjectInput, ProjectMemberInput, MilestoneInput } from "@collabspace/shared";
import { h, parseBody, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { recordActivity } from "../lib/activity.js";
import { notify } from "../lib/notify.js";
import { assertAccess, requireWorkspaceRole, visibleResourceWhere } from "../services/access.js";
import { createProject, createProjectFromTemplate, projectDashboard } from "../services/projects.js";
import { findWorkspace } from "./workspaces.js";

export const projectsRouter = Router();
export const workspaceProjectsRouter = Router({ mergeParams: true });

projectsRouter.use(requireAuth);
workspaceProjectsRouter.use(requireAuth);

const projectInclude = {
  owner: { select: { id: true, name: true, avatarUrl: true, color: true } },
  members: { include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } },
  boards: { where: { isDefault: true }, select: { id: true } },
  _count: { select: { tasks: { where: { deletedAt: null } }, documents: { where: { deletedAt: null } }, canvases: { where: { deletedAt: null } }, meetings: { where: { deletedAt: null } } } },
} as const;

workspaceProjectsRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const where = await visibleResourceWhere(req.user!, ws.id, "PROJECT", role);
    const includeArchived = req.query.includeArchived === "true";
    const projects = await prisma.project.findMany({
      where: { workspaceId: ws.id, deletedAt: null, ...(includeArchived ? {} : { archivedAt: null }), ...where },
      orderBy: [{ updatedAt: "desc" }],
      include: projectInclude,
    });
    const taskStats = await prisma.task.groupBy({ by: ["projectId"], where: { workspaceId: ws.id, deletedAt: null, completedAt: { not: null } }, _count: { _all: true } });
    const doneMap = new Map(taskStats.map((s) => [s.projectId, s._count._all]));
    ok(res, projects.map((p) => ({ ...p, boardId: p.boards[0]?.id ?? null, counts: p._count, completedTasks: doneMap.get(p.id) ?? 0 })));
  }),
);

workspaceProjectsRouter.post(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const input = parseBody(CreateProjectInput, req.body);
    const project = input.templateKey
      ? await createProjectFromTemplate({ workspaceId: ws.id, ownerId: req.user!.id, templateKey: input.templateKey, name: input.name, startDate: input.startDate ?? undefined })
      : await createProject({ workspaceId: ws.id, ownerId: req.user!.id, ...input, startDate: input.startDate ?? null, dueDate: input.dueDate ?? null });
    if (input.templateKey && (input.description || input.visibility || input.color)) {
      await prisma.project.update({ where: { id: project.id }, data: { description: input.description, visibility: input.visibility, color: input.color } });
    }
    await audit({ action: "project.create", workspaceId: ws.id, req, resourceType: "PROJECT", resourceId: project.id });
    const full = await prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: projectInclude });
    created(res, { ...full, boardId: full.boards[0]?.id ?? null, counts: full._count });
  }),
);

projectsRouter.get(
  "/:projectId",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    const { access } = await assertAccess(req.user, "PROJECT", id, "VIEWER");
    const project = await prisma.project.findUniqueOrThrow({ where: { id }, include: { ...projectInclude, workspace: { select: { id: true, slug: true, name: true } } } });
    const dashboard = await projectDashboard(id);
    ok(res, { ...project, boardId: project.boards[0]?.id ?? null, counts: project._count, access, dashboard });
  }),
);

projectsRouter.patch(
  "/:projectId",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    const { resource } = await assertAccess(req.user, "PROJECT", id, "EDITOR");
    const input = parseBody(UpdateProjectInput, req.body);
    if (input.ownerId) {
      const { access } = await assertAccess(req.user, "PROJECT", id, "EDITOR");
      if (access !== "OWNER") throw forbidden("Only the project owner or a workspace admin can transfer ownership");
      const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: resource.workspaceId, userId: input.ownerId } } });
      if (!member) throw badRequest("New owner must be a workspace member");
    }
    const project = await prisma.project.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        color: input.color,
        icon: input.icon,
        status: input.status,
        visibility: input.visibility,
        startDate: input.startDate,
        dueDate: input.dueDate,
        ownerId: input.ownerId,
        archivedAt: input.status === "ARCHIVED" ? new Date() : input.status ? null : undefined,
      },
      include: projectInclude,
    });
    if (input.ownerId) await prisma.projectMember.upsert({ where: { projectId_userId: { projectId: id, userId: input.ownerId } }, update: { role: "LEAD" }, create: { projectId: id, userId: input.ownerId, role: "LEAD" } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: id, actorId: req.user!.id, type: input.status ? "project.status_changed" : "project.updated", resourceType: "PROJECT", resourceId: id, resourceTitle: project.name, payload: { fields: Object.keys(input), status: input.status } });
    if (input.status) {
      const memberIds = project.members.map((m) => m.userId).filter((u) => u !== req.user!.id);
      const ws = await prisma.workspace.findUnique({ where: { id: resource.workspaceId }, select: { slug: true } });
      await Promise.all(memberIds.map((userId) => notify({ userId, type: "PROJECT_UPDATE", title: `${project.name} is now ${input.status!.toLowerCase().replace("_", " ")}`, href: `/app/${ws?.slug}/projects/${id}`, actorId: req.user!.id, workspaceId: resource.workspaceId, resourceType: "PROJECT", resourceId: id })));
    }
    ok(res, { ...project, boardId: project.boards[0]?.id ?? null, counts: project._count });
  }),
);

projectsRouter.delete(
  "/:projectId",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    const { resource, access } = await assertAccess(req.user, "PROJECT", id, "EDITOR");
    if (access !== "OWNER") throw forbidden("Only the project owner or a workspace admin can delete a project");
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit({ action: "project.delete", workspaceId: resource.workspaceId, req, resourceType: "PROJECT", resourceId: id });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: id, actorId: req.user!.id, type: "project.deleted", resourceType: "PROJECT", resourceId: id, resourceTitle: resource.title });
    noContent(res);
  }),
);

projectsRouter.post(
  "/:projectId/members",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    const { resource } = await assertAccess(req.user, "PROJECT", id, "EDITOR");
    const input = parseBody(ProjectMemberInput, req.body);
    const wm = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: resource.workspaceId, userId: input.userId } } });
    if (!wm) throw badRequest("User must be a workspace member first");
    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId: input.userId } },
      update: { role: input.role },
      create: { projectId: id, userId: input.userId, role: input.role },
      include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } },
    });
    const channel = await prisma.channel.findFirst({ where: { projectId: id, type: "PROJECT" } });
    if (channel) await prisma.channelMember.upsert({ where: { channelId_userId: { channelId: channel.id, userId: input.userId } }, update: {}, create: { channelId: channel.id, userId: input.userId } });
    const ws = await prisma.workspace.findUnique({ where: { id: resource.workspaceId }, select: { slug: true } });
    await notify({ userId: input.userId, type: "PROJECT_UPDATE", title: `You were added to ${resource.title}`, href: `/app/${ws?.slug}/projects/${id}`, actorId: req.user!.id, workspaceId: resource.workspaceId, resourceType: "PROJECT", resourceId: id });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: id, actorId: req.user!.id, type: "project.member_added", resourceType: "PROJECT", resourceId: id, resourceTitle: resource.title, payload: { userId: input.userId } });
    created(res, member);
  }),
);

projectsRouter.delete(
  "/:projectId/members/:userId",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    const userId = requireParam(req, "userId");
    const { resource } = await assertAccess(req.user, "PROJECT", id, "EDITOR");
    if (resource.ownerId === userId) throw badRequest("The project owner cannot be removed");
    await prisma.projectMember.deleteMany({ where: { projectId: id, userId } });
    noContent(res);
  }),
);

projectsRouter.get(
  "/:projectId/milestones",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    await assertAccess(req.user, "PROJECT", id, "VIEWER");
    ok(res, await prisma.milestone.findMany({ where: { projectId: id }, orderBy: { dueDate: "asc" } }));
  }),
);

projectsRouter.post(
  "/:projectId/milestones",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    await assertAccess(req.user, "PROJECT", id, "EDITOR");
    const input = parseBody(MilestoneInput, req.body);
    created(res, await prisma.milestone.create({ data: { projectId: id, title: input.title, description: input.description ?? null, dueDate: input.dueDate, completedAt: input.completedAt ?? null } }));
  }),
);

projectsRouter.patch(
  "/:projectId/milestones/:milestoneId",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    await assertAccess(req.user, "PROJECT", id, "EDITOR");
    const input = parseBody(MilestoneInput.partial(), req.body);
    const m = await prisma.milestone.findFirst({ where: { id: requireParam(req, "milestoneId"), projectId: id } });
    if (!m) throw notFound("Milestone");
    ok(res, await prisma.milestone.update({ where: { id: m.id }, data: { title: input.title, description: input.description, dueDate: input.dueDate, completedAt: input.completedAt } }));
  }),
);

projectsRouter.delete(
  "/:projectId/milestones/:milestoneId",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    await assertAccess(req.user, "PROJECT", id, "EDITOR");
    await prisma.milestone.deleteMany({ where: { id: requireParam(req, "milestoneId"), projectId: id } });
    noContent(res);
  }),
);

projectsRouter.get(
  "/:projectId/resources",
  h(async (req, res) => {
    const id = requireParam(req, "projectId");
    await assertAccess(req.user, "PROJECT", id, "VIEWER");
    const [documents, canvases, meetings, files] = await Promise.all([
      prisma.document.findMany({ where: { projectId: id, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, icon: true, updatedAt: true, archivedAt: true } }),
      prisma.canvas.findMany({ where: { projectId: id, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, updatedAt: true, archivedAt: true } }),
      prisma.meeting.findMany({ where: { projectId: id, deletedAt: null }, orderBy: { startsAt: "desc" }, select: { id: true, title: true, startsAt: true, status: true } }),
      prisma.fileAsset.findMany({ where: { projectId: id, deletedAt: null, status: "READY" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true } }),
    ]);
    ok(res, { documents, canvases, meetings, files });
  }),
);
