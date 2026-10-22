import { prisma, type AccessLevel, type ResourceType, type Visibility, type WorkspaceRole } from "@collabspace/db";
import { computeResourceAccess, shareLinkIsActive, type EffectiveAccess, accessAtLeast, roleAtLeast } from "@collabspace/shared";
import { forbidden, notFound, unauthorized } from "../lib/errors.js";
import { hashToken } from "../lib/crypto.js";

export interface WorkspaceContext {
  workspaceId: string;
  role: WorkspaceRole | null;
  isPlatformAdmin: boolean;
}

/** Returns the user's membership role in a workspace (null if not a member). */
export async function workspaceRole(userId: string | undefined, workspaceId: string): Promise<WorkspaceRole | null> {
  if (!userId) return null;
  const m = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true } });
  return m?.role ?? null;
}

export async function requireWorkspaceRole(user: Express.AuthUser | undefined, workspaceId: string, min: WorkspaceRole = "GUEST"): Promise<WorkspaceRole> {
  if (!user) throw unauthorized();
  const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, select: { id: true } });
  if (!ws) throw notFound("Workspace");
  const role = await workspaceRole(user.id, workspaceId);
  if (!role) throw forbidden("You are not a member of this workspace");
  if (!roleAtLeast(role, min)) throw forbidden();
  return role;
}

export async function workspaceBySlug(slug: string) {
  const ws = await prisma.workspace.findFirst({ where: { slug, deletedAt: null } });
  if (!ws) throw notFound("Workspace");
  return ws;
}

export interface ResourceRecord {
  type: ResourceType;
  id: string;
  workspaceId: string;
  projectId: string | null;
  ownerId: string | null;
  visibility: Visibility;
  title: string;
}

/** Load the minimal record needed to authorize any resource type. */
export async function loadResource(type: ResourceType, id: string): Promise<ResourceRecord | null> {
  switch (type) {
    case "WORKSPACE": {
      const w = await prisma.workspace.findFirst({ where: { id, deletedAt: null }, select: { id: true, ownerId: true, name: true } });
      return w ? { type, id, workspaceId: w.id, projectId: null, ownerId: w.ownerId, visibility: "WORKSPACE", title: w.name } : null;
    }
    case "PROJECT": {
      const p = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { id: true, workspaceId: true, ownerId: true, visibility: true, name: true } });
      return p ? { type, id, workspaceId: p.workspaceId, projectId: p.id, ownerId: p.ownerId, visibility: p.visibility, title: p.name } : null;
    }
    case "CANVAS": {
      const c = await prisma.canvas.findFirst({ where: { id, deletedAt: null }, select: { id: true, workspaceId: true, projectId: true, createdById: true, visibility: true, title: true } });
      return c ? { type, id, workspaceId: c.workspaceId, projectId: c.projectId, ownerId: c.createdById, visibility: c.visibility, title: c.title } : null;
    }
    case "DOCUMENT": {
      const d = await prisma.document.findFirst({ where: { id, deletedAt: null }, select: { id: true, workspaceId: true, projectId: true, createdById: true, visibility: true, title: true } });
      return d ? { type, id, workspaceId: d.workspaceId, projectId: d.projectId, ownerId: d.createdById, visibility: d.visibility, title: d.title } : null;
    }
    case "BOARD": {
      const b = await prisma.board.findUnique({ where: { id }, select: { id: true, workspaceId: true, projectId: true, name: true, project: { select: { visibility: true, ownerId: true } } } });
      return b ? { type, id, workspaceId: b.workspaceId, projectId: b.projectId, ownerId: b.project.ownerId, visibility: b.project.visibility, title: b.name } : null;
    }
    case "TASK": {
      const t = await prisma.task.findFirst({ where: { id, deletedAt: null }, select: { id: true, workspaceId: true, projectId: true, reporterId: true, title: true, project: { select: { visibility: true } } } });
      return t ? { type, id, workspaceId: t.workspaceId, projectId: t.projectId, ownerId: null, visibility: t.project.visibility, title: t.title } : null;
    }
    case "MEETING": {
      const m = await prisma.meeting.findFirst({ where: { id, deletedAt: null }, select: { id: true, workspaceId: true, projectId: true, createdById: true, visibility: true, title: true } });
      return m ? { type, id, workspaceId: m.workspaceId, projectId: m.projectId, ownerId: m.createdById, visibility: m.visibility, title: m.title } : null;
    }
    case "FILE": {
      const f = await prisma.fileAsset.findFirst({ where: { id, deletedAt: null }, select: { id: true, workspaceId: true, projectId: true, uploaderId: true, name: true } });
      return f ? { type, id, workspaceId: f.workspaceId, projectId: f.projectId, ownerId: f.uploaderId, visibility: "WORKSPACE", title: f.name } : null;
    }
    case "CHANNEL": {
      const c = await prisma.channel.findUnique({ where: { id }, select: { id: true, workspaceId: true, projectId: true, createdById: true, type: true, name: true } });
      if (!c) return null;
      const visibility: Visibility = c.type === "PUBLIC" || c.type === "PROJECT" ? "WORKSPACE" : "PRIVATE";
      return { type, id, workspaceId: c.workspaceId, projectId: c.projectId, ownerId: c.createdById, visibility, title: c.name ?? "Conversation" };
    }
    default:
      return null;
  }
}

export interface AccessResult {
  resource: ResourceRecord;
  access: EffectiveAccess;
  role: WorkspaceRole | null;
}

/**
 * Resolve effective access of a user (and/or share token) on a resource.
 * Resources inherit from their project (private project → members only) and workspace role.
 */
export async function resolveAccess(user: Express.AuthUser | undefined, type: ResourceType, id: string, shareToken?: string): Promise<AccessResult> {
  const resource = await loadResource(type, id);
  if (!resource) throw notFound(humanType(type));

  if (user?.platformRole === "ADMIN") return { resource, access: "OWNER", role: "OWNER" };

  const role = await workspaceRole(user?.id, resource.workspaceId);

  let explicitLevel: AccessLevel | null = null;
  let projectRole: "LEAD" | "MEMBER" | "VIEWER" | null = null;
  let projectVisibility: Visibility | null = null;
  let isOwner = Boolean(user && resource.ownerId && resource.ownerId === user.id);

  if (user) {
    const grant = await prisma.resourcePermission.findUnique({
      where: { resourceType_resourceId_userId: { resourceType: type, resourceId: id, userId: user.id } },
      select: { level: true },
    });
    explicitLevel = grant?.level ?? null;

    if (resource.projectId) {
      const [pm, project] = await Promise.all([
        prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: resource.projectId, userId: user.id } }, select: { role: true } }),
        prisma.project.findUnique({ where: { id: resource.projectId }, select: { visibility: true, ownerId: true } }),
      ]);
      projectRole = pm?.role ?? null;
      projectVisibility = project?.visibility ?? null;
      if (project?.ownerId === user.id && type === "PROJECT") isOwner = true;
      // Project-level explicit grants cascade to the project's resources.
      if (!explicitLevel && type !== "PROJECT") {
        const pg = await prisma.resourcePermission.findUnique({
          where: { resourceType_resourceId_userId: { resourceType: "PROJECT", resourceId: resource.projectId, userId: user.id } },
          select: { level: true },
        });
        explicitLevel = pg?.level ?? null;
      }
    }

    // Channels: membership is the grant.
    if (type === "CHANNEL" && resource.visibility === "PRIVATE") {
      const cm = await prisma.channelMember.findUnique({ where: { channelId_userId: { channelId: id, userId: user.id } } });
      if (cm) explicitLevel = "EDITOR";
    }
    // Meetings: participants can edit.
    if (type === "MEETING") {
      const mp = await prisma.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId: id, userId: user.id } } });
      if (mp) explicitLevel = explicitLevel ?? "EDITOR";
    }
    // Tasks: assignee/reporter can always edit their task.
    if (type === "TASK") {
      const t = await prisma.task.findUnique({ where: { id }, select: { assigneeId: true, reporterId: true } });
      if (t && (t.assigneeId === user.id || t.reporterId === user.id)) explicitLevel = "EDITOR";
    }
  }

  let shareLinkLevel: AccessLevel | null = null;
  if (shareToken) {
    const link = await prisma.shareLink.findUnique({ where: { tokenHash: hashToken(shareToken) } });
    if (link && link.resourceType === type && link.resourceId === id && shareLinkIsActive(link) && (!link.requireLogin || user)) {
      shareLinkLevel = link.level;
      void prisma.shareLink.update({ where: { id: link.id }, data: { accessCount: { increment: 1 }, lastAccessAt: new Date() } }).catch(() => {});
    }
  }

  const access = computeResourceAccess({
    workspaceRole: role,
    visibility: resource.visibility,
    isOwner,
    explicitLevel,
    projectRole,
    projectVisibility,
    shareLinkLevel,
  });
  return { resource, access, role };
}

export async function assertAccess(user: Express.AuthUser | undefined, type: ResourceType, id: string, need: AccessLevel, shareToken?: string): Promise<AccessResult> {
  const result = await resolveAccess(user, type, id, shareToken);
  if (!accessAtLeast(result.access, need)) {
    if (!user) throw unauthorized();
    // Do not leak existence of private resources: 404 for view, 403 for higher levels on visible ones.
    if (need === "VIEWER" || !accessAtLeast(result.access, "VIEWER")) throw notFound(humanType(type));
    throw forbidden();
  }
  return result;
}

export function humanType(type: ResourceType): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

/** Filter helper for list queries: ids of private resources the user can see via explicit grants. */
export async function grantedResourceIds(userId: string, type: ResourceType, workspaceId: string): Promise<string[]> {
  const rows = await prisma.resourcePermission.findMany({ where: { userId, resourceType: type, workspaceId }, select: { resourceId: true } });
  return rows.map((r) => r.resourceId);
}

/** Project ids where the user is a member (for private-project filtering). */
export async function memberProjectIds(userId: string, workspaceId: string): Promise<string[]> {
  const rows = await prisma.projectMember.findMany({ where: { userId, project: { workspaceId } }, select: { projectId: true } });
  return rows.map((r) => r.projectId);
}

/**
 * Prisma `where` fragment restricting a resource list (canvas/document/meeting) to what the user may see.
 * Admins/owners: everything. Members: WORKSPACE-visible (outside private projects they're not in) + own + granted.
 * Guests: own + granted + member projects.
 */
export async function visibleResourceWhere(user: Express.AuthUser, workspaceId: string, type: ResourceType, role: WorkspaceRole | null) {
  if (role === "OWNER" || role === "ADMIN" || user.platformRole === "ADMIN") return {};
  const [granted, projects] = await Promise.all([grantedResourceIds(user.id, type, workspaceId), memberProjectIds(user.id, workspaceId)]);
  const ownerField = type === "PROJECT" ? "ownerId" : "createdById";
  const base: Record<string, unknown>[] = [{ [ownerField]: user.id }, { id: { in: granted } }];
  if (type === "PROJECT") {
    // Projects: members see all workspace-visible projects; guests only the projects they belong to.
    if (role === "MEMBER") base.push({ visibility: "WORKSPACE" });
    base.push({ id: { in: projects } });
    return { OR: base };
  }
  if (role === "MEMBER") {
    base.push({
      visibility: "WORKSPACE",
      OR: [{ projectId: null }, { project: { visibility: "WORKSPACE" } }, { projectId: { in: projects } }],
    });
  } else {
    base.push({ visibility: "WORKSPACE", projectId: { in: projects } });
  }
  return { OR: base };
}
