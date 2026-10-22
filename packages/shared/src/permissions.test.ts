import { describe, expect, it } from "vitest";
import { computeResourceAccess, canEdit, canView, canChangeRole, shareLinkIsActive } from "./permissions";

describe("computeResourceAccess", () => {
  it("gives admins and owners full access", () => {
    expect(computeResourceAccess({ workspaceRole: "ADMIN", visibility: "PRIVATE", isOwner: false })).toBe("OWNER");
    expect(computeResourceAccess({ workspaceRole: "OWNER", visibility: "PRIVATE", isOwner: false })).toBe("OWNER");
  });
  it("gives creators full access", () => {
    expect(computeResourceAccess({ workspaceRole: "GUEST", visibility: "PRIVATE", isOwner: true })).toBe("OWNER");
  });
  it("members can edit workspace-visible resources", () => {
    expect(computeResourceAccess({ workspaceRole: "MEMBER", visibility: "WORKSPACE", isOwner: false })).toBe("EDITOR");
  });
  it("members cannot see private resources without a grant", () => {
    expect(computeResourceAccess({ workspaceRole: "MEMBER", visibility: "PRIVATE", isOwner: false })).toBeNull();
    expect(
      computeResourceAccess({ workspaceRole: "MEMBER", visibility: "PRIVATE", isOwner: false, explicitLevel: "COMMENTER" }),
    ).toBe("COMMENTER");
  });
  it("guests need explicit grants or project membership", () => {
    expect(computeResourceAccess({ workspaceRole: "GUEST", visibility: "WORKSPACE", isOwner: false })).toBeNull();
    expect(computeResourceAccess({ workspaceRole: "GUEST", visibility: "WORKSPACE", isOwner: false, projectRole: "VIEWER" })).toBe("VIEWER");
    expect(computeResourceAccess({ workspaceRole: "GUEST", visibility: "WORKSPACE", isOwner: false, explicitLevel: "EDITOR" })).toBe("EDITOR");
  });
  it("private projects restrict workspace-visible resources to project members", () => {
    expect(
      computeResourceAccess({ workspaceRole: "MEMBER", visibility: "WORKSPACE", isOwner: false, projectVisibility: "PRIVATE", projectRole: null }),
    ).toBeNull();
    expect(
      computeResourceAccess({ workspaceRole: "MEMBER", visibility: "WORKSPACE", isOwner: false, projectVisibility: "PRIVATE", projectRole: "VIEWER" }),
    ).toBe("VIEWER");
    expect(
      computeResourceAccess({ workspaceRole: "MEMBER", visibility: "WORKSPACE", isOwner: false, projectVisibility: "PRIVATE", projectRole: "MEMBER" }),
    ).toBe("EDITOR");
  });
  it("share links grant access to non-members", () => {
    const a = computeResourceAccess({ workspaceRole: null, visibility: "PRIVATE", isOwner: false, shareLinkLevel: "VIEWER" });
    expect(canView(a)).toBe(true);
    expect(canEdit(a)).toBe(false);
  });
  it("non-members without links get nothing", () => {
    expect(computeResourceAccess({ workspaceRole: null, visibility: "WORKSPACE", isOwner: false })).toBeNull();
  });
});

describe("canChangeRole", () => {
  it("admins cannot promote to owner or demote owners", () => {
    expect(canChangeRole("ADMIN", "MEMBER", "OWNER")).toBe(false);
    expect(canChangeRole("ADMIN", "OWNER", "MEMBER")).toBe(false);
    expect(canChangeRole("ADMIN", "MEMBER", "ADMIN")).toBe(true);
    expect(canChangeRole("OWNER", "MEMBER", "OWNER")).toBe(true);
    expect(canChangeRole("MEMBER", "GUEST", "MEMBER")).toBe(false);
  });
});

describe("shareLinkIsActive", () => {
  it("respects expiry and revocation", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(shareLinkIsActive({ level: "VIEWER", expiresAt: null, revokedAt: null, requireLogin: false }, now)).toBe(true);
    expect(shareLinkIsActive({ level: "VIEWER", expiresAt: "2025-12-31T00:00:00Z", revokedAt: null, requireLogin: false }, now)).toBe(false);
    expect(shareLinkIsActive({ level: "VIEWER", expiresAt: null, revokedAt: new Date(), requireLogin: false }, now)).toBe(false);
  });
});
