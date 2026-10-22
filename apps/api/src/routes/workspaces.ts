import { Router } from "express";
import { prisma } from "@collabspace/db";
import { CreateWorkspaceInput, UpdateWorkspaceInput, CreateInvitationInput, UpdateMemberInput, Pagination, canChangeRole, isOverdue } from "@collabspace/shared";
import { config } from "../config.js";
import { h, parseBody, parseQuery, ok, created, noContent, requireParam, toPage } from "../lib/http.js";
import { hashToken, randomToken } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { sendMail, emailLayout, escapeHtml } from "../lib/email.js";
import { audit } from "../lib/audit.js";
import { recordActivity } from "../lib/activity.js";
import { notify } from "../lib/notify.js";
import { rateLimit } from "../lib/rateLimit.js";
import { requireWorkspaceRole, workspaceRole, visibleResourceWhere } from "../services/access.js";
import { createWorkspace, addMember, memberSelect, workspaceSummaryForUser } from "../services/workspaces.js";
import { createProjectFromTemplate } from "../services/projects.js";
import { createDemoContent } from "../services/demo.js";

export const workspacesRouter = Router();
export const invitationsRouter = Router();

/** Resolve a workspace by id or slug. */
export async function findWorkspace(idOrSlug: string) {
  const ws = await prisma.workspace.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], deletedAt: null } });
  if (!ws) throw notFound("Workspace");
  return ws;
}

workspacesRouter.use(requireAuth);

workspacesRouter.get(
  "/",
  h(async (req, res) => {
    ok(res, await workspaceSummaryForUser(req.user!.id));
  }),
);

workspacesRouter.post(
  "/",
  rateLimit({ name: "create-workspace", windowMs: 60 * 60_000, max: 20 }),
  h(async (req, res) => {
    const input = parseBody(CreateWorkspaceInput, req.body);
    const ws = await createWorkspace({ name: input.name, slug: input.slug, purpose: input.purpose, description: input.description, ownerId: req.user!.id, isDemo: input.demo });
    if (input.demo) await createDemoContent(ws.id, req.user!.id);
    else if (input.templateKey) await createProjectFromTemplate({ workspaceId: ws.id, ownerId: req.user!.id, templateKey: input.templateKey });
    await audit({ action: "workspace.create", workspaceId: ws.id, req });
    created(res, { ...ws, role: "OWNER" });
  }),
);

workspacesRouter.get(
  "/:workspaceId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const counts = await prisma.workspace.findUnique({ where: { id: ws.id }, select: { _count: { select: { members: true, projects: true, canvases: true, documents: true } } } });
    ok(res, { ...ws, role, counts: counts?._count });
  }),
);

workspacesRouter.patch(
  "/:workspaceId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "ADMIN");
    const input = parseBody(UpdateWorkspaceInput, req.body);
    const updated = await prisma.workspace.update({
      where: { id: ws.id },
      data: {
        name: input.name,
        description: input.description,
        purpose: input.purpose,
        logoUrl: input.logoUrl,
        ...(input.settings ? { settings: { ...((ws.settings as object) ?? {}), ...input.settings } as object } : {}),
      },
    });
    await audit({ action: "workspace.update", workspaceId: ws.id, req, metadata: { fields: Object.keys(input) } });
    ok(res, updated);
  }),
);

workspacesRouter.delete(
  "/:workspaceId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "OWNER");
    await prisma.workspace.update({ where: { id: ws.id }, data: { deletedAt: new Date() } });
    await audit({ action: "workspace.delete", workspaceId: ws.id, req });
    noContent(res);
  }),
);

// ---- Members ------------------------------------------------------------------

workspacesRouter.get(
  "/:workspaceId/members",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id);
    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: ws.id }, select: memberSelect, orderBy: { joinedAt: "asc" } });
    ok(res, members);
  }),
);

workspacesRouter.patch(
  "/:workspaceId/members/:userId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const actorRole = await requireWorkspaceRole(req.user, ws.id, "ADMIN");
    const userId = requireParam(req, "userId");
    const input = parseBody(UpdateMemberInput, req.body);
    const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId } } });
    if (!target) throw notFound("Member");
    if (!canChangeRole(actorRole, target.role, input.role)) throw forbidden("You cannot change this member's role");
    if (target.role === "OWNER" && input.role !== "OWNER") {
      const owners = await prisma.workspaceMember.count({ where: { workspaceId: ws.id, role: "OWNER" } });
      if (owners <= 1) throw badRequest("A workspace needs at least one owner");
    }
    const updated = await prisma.workspaceMember.update({ where: { id: target.id }, data: { role: input.role }, select: memberSelect });
    if (input.role === "OWNER") await prisma.workspace.update({ where: { id: ws.id }, data: { ownerId: userId } });
    await audit({ action: "workspace.member_role", workspaceId: ws.id, req, resourceType: "USER", resourceId: userId, metadata: { role: input.role } });
    await recordActivity({ workspaceId: ws.id, actorId: req.user!.id, type: "member.role_changed", payload: { userId, role: input.role } });
    ok(res, updated);
  }),
);

workspacesRouter.delete(
  "/:workspaceId/members/:userId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const userId = requireParam(req, "userId");
    const actorRole = await requireWorkspaceRole(req.user, ws.id);
    const self = userId === req.user!.id;
    if (!self && !canChangeRole(actorRole, "MEMBER", "MEMBER")) throw forbidden();
    const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId } } });
    if (!target) throw notFound("Member");
    if (target.role === "OWNER") throw badRequest("Transfer ownership before removing an owner");
    await prisma.$transaction([
      prisma.workspaceMember.delete({ where: { id: target.id } }),
      prisma.channelMember.deleteMany({ where: { userId, channel: { workspaceId: ws.id } } }),
      prisma.projectMember.deleteMany({ where: { userId, project: { workspaceId: ws.id } } }),
      prisma.resourcePermission.deleteMany({ where: { userId, workspaceId: ws.id } }),
    ]);
    await audit({ action: self ? "workspace.leave" : "workspace.member_removed", workspaceId: ws.id, req, resourceType: "USER", resourceId: userId });
    await recordActivity({ workspaceId: ws.id, actorId: req.user!.id, type: "member.removed", payload: { userId } });
    noContent(res);
  }),
);

// ---- Invitations -----------------------------------------------------------

workspacesRouter.get(
  "/:workspaceId/invitations",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "ADMIN");
    const rows = await prisma.invitation.findMany({
      where: { workspaceId: ws.id, status: "PENDING", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, createdAt: true, expiresAt: true, invitedBy: { select: { id: true, name: true } } },
    });
    ok(res, rows);
  }),
);

workspacesRouter.post(
  "/:workspaceId/invitations",
  rateLimit({ name: "invite", windowMs: 60 * 60_000, max: 100 }),
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "ADMIN");
    const input = parseBody(CreateInvitationInput, req.body);
    const results: Array<{ email: string; status: string; inviteUrl?: string }> = [];
    for (const email of input.emails) {
      const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existingUser) {
        const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: existingUser.id } } });
        if (member) {
          results.push({ email, status: "already_member" });
          continue;
        }
      }
      const token = randomToken(24);
      await prisma.invitation.updateMany({ where: { workspaceId: ws.id, email, status: "PENDING" }, data: { status: "REVOKED" } });
      await prisma.invitation.create({
        data: { workspaceId: ws.id, email, role: input.role, tokenHash: hashToken(token), invitedById: req.user!.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000) },
      });
      const url = `${config.APP_URL}/invite/${token}`;
      await sendMail({
        to: email,
        subject: `${req.user!.name} invited you to ${ws.name} on CollabSpace`,
        text: `${req.user!.name} invited you to join the "${ws.name}" workspace.\n\nAccept: ${url}\n\nThis invitation expires in 7 days.`,
        html: emailLayout(`Join ${escapeHtml(ws.name)}`, `<p>${escapeHtml(req.user!.name)} invited you to collaborate in <strong>${escapeHtml(ws.name)}</strong>.</p>`, { label: "Accept invitation", url }),
      });
      if (existingUser) {
        await notify({ userId: existingUser.id, type: "WORKSPACE_INVITE", title: `You were invited to ${ws.name}`, body: `${req.user!.name} invited you to join.`, href: `/invite/${token}`, actorId: req.user!.id });
      }
      results.push({ email, status: "sent", ...(config.isProd ? {} : { inviteUrl: url }) });
    }
    await audit({ action: "workspace.invite", workspaceId: ws.id, req, metadata: { count: input.emails.length, role: input.role } });
    created(res, results);
  }),
);

workspacesRouter.delete(
  "/:workspaceId/invitations/:invitationId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "ADMIN");
    await prisma.invitation.updateMany({ where: { id: requireParam(req, "invitationId"), workspaceId: ws.id }, data: { status: "REVOKED" } });
    noContent(res);
  }),
);

invitationsRouter.get(
  "/:token",
  h(async (req, res) => {
    const inv = await prisma.invitation.findUnique({
      where: { tokenHash: hashToken(requireParam(req, "token")) },
      include: { workspace: { select: { id: true, name: true, slug: true, logoUrl: true } }, invitedBy: { select: { name: true } } },
    });
    if (!inv) throw notFound("Invitation");
    const expired = inv.status !== "PENDING" || inv.expiresAt < new Date();
    ok(res, { email: inv.email, role: inv.role, workspace: inv.workspace, invitedBy: inv.invitedBy.name, expired, status: inv.status });
  }),
);

invitationsRouter.post(
  "/:token/accept",
  requireAuth,
  h(async (req, res) => {
    const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(requireParam(req, "token")) }, include: { workspace: true } });
    if (!inv || inv.status !== "PENDING" || inv.expiresAt < new Date()) throw badRequest("This invitation is no longer valid");
    if (inv.email.toLowerCase() !== req.user!.email.toLowerCase()) throw conflict(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
    await addMember(inv.workspaceId, req.user!.id, inv.role);
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    if (!req.user!.emailVerifiedAt) await prisma.user.update({ where: { id: req.user!.id }, data: { emailVerifiedAt: new Date() } });
    await audit({ action: "workspace.invite_accepted", workspaceId: inv.workspaceId, req });
    await recordActivity({ workspaceId: inv.workspaceId, actorId: req.user!.id, type: "member.joined", payload: { userId: req.user!.id } });
    await notify({ userId: inv.invitedById, type: "PROJECT_UPDATE", title: `${req.user!.name} joined ${inv.workspace.name}`, href: `/app/${inv.workspace.slug}/members`, actorId: req.user!.id, workspaceId: inv.workspaceId });
    ok(res, { workspace: { id: inv.workspace.id, slug: inv.workspace.slug, name: inv.workspace.name } });
  }),
);

// ---- Overview, activity, analytics -------------------------------------------

workspacesRouter.get(
  "/:workspaceId/overview",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const projWhere = await visibleResourceWhere(req.user!, ws.id, "PROJECT", role);
    const [projects, myTasks, upcomingMeetings, recentDocs, recentCanvases, activity] = await Promise.all([
      prisma.project.findMany({ where: { workspaceId: ws.id, deletedAt: null, archivedAt: null, ...projWhere }, orderBy: { updatedAt: "desc" }, take: 8, include: { _count: { select: { tasks: { where: { deletedAt: null } } } } } }),
      prisma.task.findMany({ where: { workspaceId: ws.id, assigneeId: req.user!.id, deletedAt: null, completedAt: null }, orderBy: [{ dueDate: "asc" }], take: 10, include: { project: { select: { id: true, name: true, key: true, color: true } } } }),
      prisma.meeting.findMany({ where: { workspaceId: ws.id, deletedAt: null, startsAt: { gte: new Date(Date.now() - 60 * 60_000) }, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, OR: [{ visibility: "WORKSPACE" }, { participants: { some: { userId: req.user!.id } } }, { createdById: req.user!.id }] }, orderBy: { startsAt: "asc" }, take: 5 }),
      prisma.document.findMany({ where: { workspaceId: ws.id, deletedAt: null, archivedAt: null, ...(await visibleResourceWhere(req.user!, ws.id, "DOCUMENT", role)) }, orderBy: { updatedAt: "desc" }, take: 6, select: { id: true, title: true, icon: true, updatedAt: true, projectId: true } }),
      prisma.canvas.findMany({ where: { workspaceId: ws.id, deletedAt: null, archivedAt: null, ...(await visibleResourceWhere(req.user!, ws.id, "CANVAS", role)) }, orderBy: { updatedAt: "desc" }, take: 6, select: { id: true, title: true, updatedAt: true, projectId: true } }),
      prisma.activity.findMany({ where: { workspaceId: ws.id }, orderBy: { createdAt: "desc" }, take: 12, include: { actor: { select: { id: true, name: true, avatarUrl: true, color: true } } } }),
    ]);
    const now = new Date();
    const doneByProject = await prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: projects.map((p) => p.id) }, deletedAt: null, completedAt: { not: null } }, _count: { _all: true } });
    const doneMap = new Map(doneByProject.map((d) => [d.projectId, d._count._all]));
    ok(res, {
      projects: projects.map((p) => ({ ...p, taskCount: p._count.tasks, completedTasks: doneMap.get(p.id) ?? 0 })),
      myTasks: myTasks.map((t) => ({ ...t, overdue: isOverdue(t, now) })),
      upcomingMeetings,
      recentDocuments: recentDocs,
      recentCanvases,
      activity,
    });
  }),
);

workspacesRouter.get(
  "/:workspaceId/activity",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id);
    const q = parseQuery(Pagination.extend({ projectId: Pagination.shape.cursor, type: Pagination.shape.cursor }), req.query);
    const rows = await prisma.activity.findMany({
      where: { workspaceId: ws.id, ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.type ? { type: { startsWith: q.type } } : {}) },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, name: true, avatarUrl: true, color: true } } },
    });
    ok(res, toPage(rows, q.limit));
  }),
);

workspacesRouter.get(
  "/:workspaceId/analytics",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id);
    const since = new Date(Date.now() - 42 * 24 * 60 * 60_000);
    const [tasks, completedRecent, members, projects, actionItems, activityCounts] = await Promise.all([
      prisma.task.findMany({ where: { workspaceId: ws.id, deletedAt: null }, select: { id: true, status: true, assigneeId: true, dueDate: true, completedAt: true, projectId: true, priority: true } }),
      prisma.task.findMany({ where: { workspaceId: ws.id, deletedAt: null, completedAt: { gte: since } }, select: { completedAt: true } }),
      prisma.workspaceMember.findMany({ where: { workspaceId: ws.id }, select: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } }),
      prisma.project.findMany({ where: { workspaceId: ws.id, deletedAt: null }, select: { id: true, name: true, color: true, key: true, status: true, dueDate: true } }),
      prisma.meetingActionItem.groupBy({ by: ["status"], where: { meeting: { workspaceId: ws.id } }, _count: { _all: true } }),
      prisma.activity.groupBy({ by: ["type"], where: { workspaceId: ws.id, createdAt: { gte: since } }, _count: { _all: true } }),
    ]);
    const now = new Date();
    const byStatus: Record<string, number> = {};
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const overdue = tasks.filter((t) => isOverdue(t, now)).length;
    const completedByDay: Record<string, number> = {};
    for (let i = 41; i >= 0; i--) completedByDay[new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10)] = 0;
    for (const t of completedRecent) {
      const k = t.completedAt!.toISOString().slice(0, 10);
      if (k in completedByDay) completedByDay[k]! += 1;
    }
    const workload = members.map((m) => {
      const mine = tasks.filter((t) => t.assigneeId === m.user.id);
      return { user: m.user, open: mine.filter((t) => !t.completedAt).length, overdue: mine.filter((t) => isOverdue(t, now)).length, completed: mine.filter((t) => t.completedAt).length };
    });
    const projectProgress = projects.map((p) => {
      const mine = tasks.filter((t) => t.projectId === p.id);
      const done = mine.filter((t) => t.completedAt).length;
      return { ...p, total: mine.length, done, percent: mine.length ? Math.round((done / mine.length) * 100) : 0 };
    });
    ok(res, {
      definitions: {
        completedOverTime: "Tasks with completedAt in each day (last 6 weeks).",
        overdue: "Open tasks whose due date is in the past.",
        workload: "Open / overdue / completed tasks per assignee.",
        actionItems: "Meeting action items by review status.",
      },
      totals: { tasks: tasks.length, completed: tasks.filter((t) => t.completedAt).length, overdue, byStatus },
      completedOverTime: Object.entries(completedByDay).map(([date, count]) => ({ date, count })),
      workload,
      projectProgress,
      actionItems: actionItems.map((a) => ({ status: a.status, count: a._count._all })),
      collaboration: activityCounts.map((a) => ({ type: a.type, count: a._count._all })).sort((a, b) => b.count - a.count).slice(0, 12),
    });
  }),
);

export { workspaceRole };
