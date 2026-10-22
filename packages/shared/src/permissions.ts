/**
 * Pure permission logic shared by the API, the sync service and (for UI hints only) the web app.
 * The server is always authoritative — the frontend uses these helpers only to hide controls.
 */

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
export type AccessLevel = "VIEWER" | "COMMENTER" | "EDITOR";
export type Visibility = "WORKSPACE" | "PRIVATE";
export type ProjectRole = "LEAD" | "MEMBER" | "VIEWER";

export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  GUEST: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export const ACCESS_RANK: Record<AccessLevel, number> = {
  VIEWER: 1,
  COMMENTER: 2,
  EDITOR: 3,
};

export type EffectiveAccess = AccessLevel | "OWNER" | null;

export function accessAtLeast(have: EffectiveAccess, need: AccessLevel): boolean {
  if (have === null) return false;
  if (have === "OWNER") return true;
  return ACCESS_RANK[have] >= ACCESS_RANK[need];
}

export function maxAccess(a: EffectiveAccess, b: EffectiveAccess): EffectiveAccess {
  if (a === "OWNER" || b === "OWNER") return "OWNER";
  if (a === null) return b;
  if (b === null) return a;
  return ACCESS_RANK[a] >= ACCESS_RANK[b] ? a : b;
}

export function roleAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  if (!role) return false;
  return WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[min];
}

export function canManageWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return roleAtLeast(role, "ADMIN");
}

export function canChangeRole(
  actorRole: WorkspaceRole | null | undefined,
  targetCurrentRole: WorkspaceRole,
  targetNewRole: WorkspaceRole,
): boolean {
  if (!actorRole) return false;
  if (actorRole === "OWNER") return true;
  if (actorRole !== "ADMIN") return false;
  // Admins cannot touch owners nor promote anyone to owner.
  if (targetCurrentRole === "OWNER" || targetNewRole === "OWNER") return false;
  return true;
}

export interface ResourceAccessInput {
  /** Workspace role of the user, or null if not a member */
  workspaceRole: WorkspaceRole | null;
  /** Resource visibility */
  visibility: Visibility;
  /** True if the user created / owns the resource */
  isOwner: boolean;
  /** Explicit grant on the resource, if any */
  explicitLevel?: AccessLevel | null;
  /** Project membership (if the resource belongs to a project) */
  projectRole?: ProjectRole | null;
  /** Project visibility (if the resource belongs to a project) */
  projectVisibility?: Visibility | null;
  /** Access granted via a valid share link, if any */
  shareLinkLevel?: AccessLevel | null;
}

/**
 * Compute effective access for a resource.
 * Rules (least privilege):
 *  - Workspace OWNER/ADMIN: full access to everything in the workspace.
 *  - Resource owner (creator): full access.
 *  - Explicit grant: the granted level (max with other sources).
 *  - WORKSPACE-visible resource: MEMBER → EDITOR, GUEST → nothing (guests need explicit grants).
 *    If the resource sits in a PRIVATE project, only project members get access via visibility:
 *    LEAD/MEMBER → EDITOR, VIEWER → VIEWER.
 *  - PRIVATE resource: only owner, explicit grants, admins.
 *  - Share link: adds the link level (never above EDITOR), available even to non-members.
 */
export function computeResourceAccess(input: ResourceAccessInput): EffectiveAccess {
  let access: EffectiveAccess = null;

  if (input.workspaceRole === "OWNER" || input.workspaceRole === "ADMIN") return "OWNER";
  if (input.isOwner) return "OWNER";

  if (input.explicitLevel) access = maxAccess(access, input.explicitLevel);

  if (input.visibility === "WORKSPACE" && input.workspaceRole === "MEMBER") {
    if (input.projectVisibility === "PRIVATE") {
      if (input.projectRole === "LEAD" || input.projectRole === "MEMBER") {
        access = maxAccess(access, "EDITOR");
      } else if (input.projectRole === "VIEWER") {
        access = maxAccess(access, "VIEWER");
      }
    } else {
      access = maxAccess(access, "EDITOR");
    }
  }

  if (input.visibility === "WORKSPACE" && input.workspaceRole === "GUEST") {
    // Guests only see what they were explicitly granted or what their project membership allows.
    if (input.projectRole === "LEAD" || input.projectRole === "MEMBER") access = maxAccess(access, "EDITOR");
    else if (input.projectRole === "VIEWER") access = maxAccess(access, "VIEWER");
  }

  if (input.shareLinkLevel) access = maxAccess(access, input.shareLinkLevel);

  return access;
}

export function canView(access: EffectiveAccess): boolean {
  return accessAtLeast(access, "VIEWER");
}
export function canComment(access: EffectiveAccess): boolean {
  return accessAtLeast(access, "COMMENTER");
}
export function canEdit(access: EffectiveAccess): boolean {
  return accessAtLeast(access, "EDITOR");
}
export function canShare(access: EffectiveAccess): boolean {
  return access === "OWNER" || access === "EDITOR";
}
export function canDelete(access: EffectiveAccess): boolean {
  return access === "OWNER";
}

export interface ShareLinkLike {
  level: AccessLevel;
  expiresAt: Date | string | null;
  revokedAt: Date | string | null;
  requireLogin: boolean;
}

export function shareLinkIsActive(link: ShareLinkLike, now: Date = new Date()): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}
