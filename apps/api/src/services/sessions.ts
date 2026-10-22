import { prisma } from "@collabspace/db";
import type { Request, Response } from "express";
import { config } from "../config.js";
import { hashToken, randomToken } from "../lib/crypto.js";
import { clientIp } from "../lib/http.js";

export async function createSession(userId: string, req: Request, res: Response): Promise<string> {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 300) || null,
      ip: clientIp(req) ?? null,
      expiresAt: new Date(Date.now() + config.sessionTtlMs),
    },
  });
  setSessionCookie(res, token);
  return token;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.COOKIE_SECURE || config.isProd,
    path: "/",
    maxAge: config.sessionTtlMs,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookie, { httpOnly: true, sameSite: "lax", secure: config.COOKIE_SECURE || config.isProd, path: "/" });
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/** Resolve a raw session token into a user. Shared by API (cookie) and sync service (cookie on upgrade). */
export async function resolveSession(token: string): Promise<{ sessionId: string; user: Express.AuthUser } | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { id: true, email: true, name: true, avatarUrl: true, color: true, platformRole: true, emailVerifiedAt: true, onboardingDone: true, disabledAt: true, deletedAt: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.disabledAt || session.user.deletedAt) return null;
  // Sliding expiration: touch at most every 5 minutes.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    void prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + config.sessionTtlMs) } })
      .catch(() => {});
  }
  const { disabledAt: _d, deletedAt: _dd, ...user } = session.user;
  return { sessionId: session.id, user };
}
