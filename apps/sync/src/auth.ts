import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { prisma, type AccessLevel, type ResourceType, type Visibility, type WorkspaceRole } from "@collabspace/db";
import { computeResourceAccess, shareLinkIsActive, type EffectiveAccess, accessAtLeast, type PresenceUser } from "@collabspace/shared";
import { config } from "./config.js";

/**
 * Authentication & authorization for WebSocket connections.
 * Mirrors the API: same HMAC session token hashing, same resource access rules
 * (computeResourceAccess from @collabspace/shared), same share-link semantics.
 * Knowing a room id is never sufficient — every join is checked against the database.
 */

export interface AuthedUser extends PresenceUser {
  email: string;
  platformRole: "USER" | "ADMIN";
}

export function hashToken(token: string): string {
  return createHmac("sha256", config.SESSION_SECRET).update(token).digest("hex");
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export async function authenticate(req: IncomingMessage): Promise<AuthedUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.sessionCookie];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, color: true, platformRole: true, disabledAt: true, deletedAt: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.disabledAt || session.user.deletedAt) return null;
  const u = session.user;
  return { userId: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, color: u.color, platformRole: u.platformRole };
}

export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // Non-browser clients (tests, server-side) send no Origin; they still need a valid session cookie.
  if (!origin) return true;
  return config.TRUSTED_ORIGINS.includes(origin);
}

interface ResourceRecord {
  workspaceId: string;
  projectId: string | null;
  ownerId: string | null;
  visibility: Visibility;
}

async function loadResource(type: ResourceType, id: string): Promise<ResourceRecord | null> {
  switch (type) {
    case "CANVAS": {
      const c = await prisma.canvas.findFirst({ where: { id, deletedAt: null }, select: { workspaceId: true, projectId: true, createdById: true, visibility: true } });
      return c ? { workspaceId: c.workspaceId, projectId: c.projectId, ownerId: c.createdById, visibility: c.visibility } : null;
    }
    case "DOCUMENT": {
      const d = await prisma.document.findFirst({ where: { id, deletedAt: null }, select: { workspaceId: true, projectId: true, createdById: true, visibility: true } });
      return d ? { workspaceId: d.workspaceId, projectId: d.projectId, ownerId: d.createdById, visibility: d.visibility } : null;
    }
    case "PROJECT": {
      const p = await prisma.project.findFirst({ where: { id, deletedAt: null }, select: { workspaceId: true, ownerId: true, visibility: true } });
      return p ? { workspaceId: p.workspaceId, projectId: id, ownerId: p.ownerId, visibility: p.visibility } : null;
    }
    case "MEETING": {
      const m = await prisma.meeting.findFirst({ where: { id, deletedAt: null }, select: { workspaceId: true, projectId: true, createdById: true, visibility: true } });
      return m ? { workspaceId: m.workspaceId, projectId: m.projectId, ownerId: m.createdById, visibility: m.visibility } : null;
    }
    case "TASK": {
      const t = await prisma.task.findFirst({ where: { id, deletedAt: null }, select: { workspaceId: true, projectId: true, project: { select: { visibility: true } } } });
      return t ? { workspaceId: t.workspaceId, projectId: t.projectId, ownerId: null, visibility: t.project.visibility } : null;
    }
    case "BOARD": {
      const b = await prisma.board.findUnique({ where: { id }, select: { workspaceId: true, projectId: true, project: { select: { visibility: true, ownerId: true } } } });
      return b ? { workspaceId: b.workspaceId, projectId: b.projectId, ownerId: b.project.ownerId, visibility: b.project.visibility } : null;
    }
    default:
      return null;
  }
}

export async function workspaceRole(userId: string | undefined, workspaceId: string): Promise<WorkspaceRole | null> {
  if (!userId) return null;
  const m = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true } });
  return m?.role ?? null;
}

/** Effective access of a user and/or share token on a resource. Same rules as the REST API. */
export async function resourceAccess(user: AuthedUser | null, type: ResourceType, id: string, shareToken?: string | null): Promise<EffectiveAccess> {
  const resource = await loadResource(type, id);
  if (!resource) return null;
  if (user?.platformRole === "ADMIN") return "OWNER";
  const role = await workspaceRole(user?.userId, resource.workspaceId);
  let explicitLevel: AccessLevel | null = null;
  let projectRole: "LEAD" | "MEMBER" | "VIEWER" | null = null;
  let projectVisibility: Visibility | null = null;
  if (user) {
    const grant = await prisma.resourcePermission.findUnique({ where: { resourceType_resourceId_userId: { resourceType: type, resourceId: id, userId: user.userId } }, select: { level: true } });
    explicitLevel = grant?.level ?? null;
    if (resource.projectId) {
      const [pm, project] = await Promise.all([
        prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: resource.projectId, userId: user.userId } }, select: { role: true } }),
        prisma.project.findUnique({ where: { id: resource.projectId }, select: { visibility: true } }),
      ]);
      projectRole = pm?.role ?? null;
      projectVisibility = project?.visibility ?? null;
      if (!explicitLevel && type !== "PROJECT") {
        const pg = await prisma.resourcePermission.findUnique({ where: { resourceType_resourceId_userId: { resourceType: "PROJECT", resourceId: resource.projectId, userId: user.userId } }, select: { level: true } });
        explicitLevel = pg?.level ?? null;
      }
    }
    if (type === "MEETING") {
      const mp = await prisma.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId: id, userId: user.userId } } });
      if (mp) explicitLevel = explicitLevel ?? "EDITOR";
    }
  }
  let shareLinkLevel: AccessLevel | null = null;
  if (shareToken) {
    const link = await prisma.shareLink.findUnique({ where: { tokenHash: hashToken(shareToken) } });
    if (link && link.resourceType === type && link.resourceId === id && shareLinkIsActive(link) && (!link.requireLogin || user)) shareLinkLevel = link.level;
  }
  return computeResourceAccess({
    workspaceRole: role,
    visibility: resource.visibility,
    isOwner: Boolean(user && resource.ownerId && resource.ownerId === user.userId),
    explicitLevel,
    projectRole,
    projectVisibility,
    shareLinkLevel,
  });
}

export async function canViewChannel(user: AuthedUser, channelId: string): Promise<boolean> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { workspaceId: true, type: true, projectId: true, resourceType: true, resourceId: true } });
  if (!channel) return false;
  const member = await prisma.channelMember.findUnique({ where: { channelId_userId: { channelId, userId: user.userId } } });
  if (member) return true;
  const role = await workspaceRole(user.userId, channel.workspaceId);
  if (!role) return false;
  if (channel.type === "PUBLIC") return role !== "GUEST";
  if (channel.type === "PROJECT" && channel.projectId) return accessAtLeast(await resourceAccess(user, "PROJECT", channel.projectId), "VIEWER");
  if (channel.type === "RESOURCE" && channel.resourceType && channel.resourceId) return accessAtLeast(await resourceAccess(user, channel.resourceType, channel.resourceId), "VIEWER");
  return role === "OWNER" || role === "ADMIN" ? channel.type !== "DIRECT" : false;
}
