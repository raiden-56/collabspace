import type { PlatformRole } from "@collabspace/db";

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      color: string;
      platformRole: PlatformRole;
      emailVerifiedAt: Date | null;
      onboardingDone: boolean;
    }
    interface Request {
      user?: AuthUser;
      sessionId?: string;
      /** Set when a request is authorized through a share link token */
      shareLink?: { id: string; resourceType: string; resourceId: string; level: "VIEWER" | "COMMENTER" | "EDITOR" };
    }
  }
}

export {};
