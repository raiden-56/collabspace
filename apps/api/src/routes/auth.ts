import { Router } from "express";
import { prisma } from "@collabspace/db";
import {
  RegisterInput,
  LoginInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyEmailInput,
  pickUserColor,
} from "@collabspace/shared";
import { config } from "../config.js";
import { h, parseBody, ok, created, noContent, requireParam } from "../lib/http.js";
import { hashPassword, verifyPassword, randomToken, hashToken } from "../lib/crypto.js";
import { badRequest, conflict, notFound, unauthorized } from "../lib/errors.js";
import { rateLimit } from "../lib/rateLimit.js";
import { sendMail, emailLayout, escapeHtml } from "../lib/email.js";
import { audit } from "../lib/audit.js";
import { requireAuth } from "../middleware/auth.js";
import { createSession, clearSessionCookie, revokeSession } from "../services/sessions.js";
import { addMember, workspaceSummaryForUser } from "../services/workspaces.js";

export const authRouter = Router();

// Strict in production; lenient locally so test suites and demos are not throttled.
const loginLimiter = rateLimit({ name: "login", windowMs: 15 * 60_000, max: config.isProd ? 20 : 500 });
const registerLimiter = rateLimit({ name: "register", windowMs: 60 * 60_000, max: config.isProd ? 20 : 500 });
const forgotLimiter = rateLimit({ name: "forgot", windowMs: 60 * 60_000, max: config.isProd ? 10 : 200 });

async function issueToken(userId: string, purpose: "EMAIL_VERIFY" | "PASSWORD_RESET", ttlMs: number): Promise<string> {
  const token = randomToken(32);
  await prisma.verificationToken.create({ data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
  const token = await issueToken(user.id, "EMAIL_VERIFY", 24 * 60 * 60_000);
  const url = `${config.APP_URL}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Verify your CollabSpace email",
    text: `Hi ${user.name},\n\nConfirm your email address: ${url}\n\nThis link expires in 24 hours.`,
    html: emailLayout("Confirm your email", `<p>Hi ${escapeHtml(user.name)}, please confirm your email address to finish setting up your account.</p>`, { label: "Verify email", url }),
  });
  return token;
}

authRouter.post(
  "/register",
  registerLimiter,
  h(async (req, res) => {
    const input = parseBody(RegisterInput, req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict("An account with this email already exists");
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: { email: input.email, name: input.name, passwordHash, color: pickUserColor(input.email) },
    });
    await audit({ action: "auth.register", actorId: user.id, req });

    let joinedWorkspace: { id: string; slug: string } | null = null;
    if (input.inviteToken) {
      const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(input.inviteToken) }, include: { workspace: true } });
      if (inv && inv.status === "PENDING" && inv.expiresAt > new Date() && inv.email.toLowerCase() === input.email) {
        await addMember(inv.workspaceId, user.id, inv.role);
        await prisma.invitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
        // Email ownership proven by holding the invitation token sent to that address.
        await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
        joinedWorkspace = { id: inv.workspace.id, slug: inv.workspace.slug };
      }
    }
    const verificationToken = joinedWorkspace ? null : await sendVerificationEmail(user);
    await createSession(user.id, req, res);
    created(res, {
      user: publicUser(user),
      joinedWorkspace,
      // In non-production the token is returned so local testing works without an inbox.
      ...(config.isProd ? {} : { devVerificationToken: verificationToken }),
    });
  }),
);

authRouter.post(
  "/login",
  loginLimiter,
  h(async (req, res) => {
    const input = parseBody(LoginInput, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const valid = user?.passwordHash ? await verifyPassword(user.passwordHash, input.password) : false;
    if (!user || !valid || user.deletedAt) {
      await audit({ action: "auth.login_failed", metadata: { email: input.email }, req });
      throw unauthorized("Invalid email or password");
    }
    if (user.disabledAt) throw unauthorized("This account has been disabled");
    await createSession(user.id, req, res);
    await audit({ action: "auth.login", actorId: user.id, req });
    ok(res, { user: publicUser(user) });
  }),
);

authRouter.post(
  "/logout",
  h(async (req, res) => {
    const token = (req.cookies as Record<string, string | undefined>)?.[config.sessionCookie];
    if (token) await revokeSession(token);
    clearSessionCookie(res);
    noContent(res);
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  h(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    const workspaces = await workspaceSummaryForUser(user.id);
    const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
    ok(res, { user: publicUser(user), workspaces, unreadNotifications: unread });
  }),
);

authRouter.post(
  "/forgot-password",
  forgotLimiter,
  h(async (req, res) => {
    const input = parseBody(ForgotPasswordInput, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    let devToken: string | null = null;
    if (user && !user.deletedAt) {
      const token = await issueToken(user.id, "PASSWORD_RESET", 60 * 60_000);
      const url = `${config.APP_URL}/reset-password?token=${token}`;
      await sendMail({
        to: user.email,
        subject: "Reset your CollabSpace password",
        text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
        html: emailLayout("Reset your password", `<p>Click the button below to choose a new password. The link expires in one hour.</p>`, { label: "Reset password", url }),
      });
      devToken = token;
      await audit({ action: "auth.forgot_password", actorId: user.id, req });
    }
    // Always respond identically to avoid leaking which emails exist.
    ok(res, { message: "If an account exists for that email, a reset link has been sent.", ...(config.isProd ? {} : { devResetToken: devToken }) });
  }),
);

authRouter.post(
  "/reset-password",
  forgotLimiter,
  h(async (req, res) => {
    const input = parseBody(ResetPasswordInput, req.body);
    const row = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!row || row.purpose !== "PASSWORD_RESET" || row.usedAt || row.expiresAt < new Date()) throw badRequest("This reset link is invalid or has expired");
    const passwordHash = await hashPassword(input.password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash, emailVerifiedAt: new Date() } }),
      prisma.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit({ action: "auth.password_reset", actorId: row.userId, req });
    ok(res, { message: "Password updated. Please sign in with your new password." });
  }),
);

authRouter.post(
  "/verify-email",
  h(async (req, res) => {
    const input = parseBody(VerifyEmailInput, req.body);
    const row = await prisma.verificationToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!row || row.purpose !== "EMAIL_VERIFY" || row.usedAt || row.expiresAt < new Date()) throw badRequest("This verification link is invalid or has expired");
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.verificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    ok(res, { verified: true });
  }),
);

authRouter.post(
  "/resend-verification",
  requireAuth,
  rateLimit({ name: "resend-verify", windowMs: 60 * 60_000, max: 5 }),
  h(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound("User");
    if (user.emailVerifiedAt) return ok(res, { alreadyVerified: true });
    const token = await sendVerificationEmail(user);
    ok(res, { sent: true, ...(config.isProd ? {} : { devVerificationToken: token }) });
  }),
);

authRouter.get(
  "/sessions",
  requireAuth,
  h(async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    ok(res, sessions.map((s) => ({ ...s, current: s.id === req.sessionId })));
  }),
);

authRouter.delete(
  "/sessions/:sessionId",
  requireAuth,
  h(async (req, res) => {
    const id = requireParam(req, "sessionId");
    await prisma.session.updateMany({ where: { id, userId: req.user!.id }, data: { revokedAt: new Date() } });
    if (id === req.sessionId) clearSessionCookie(res);
    noContent(res);
  }),
);

export function publicUser(u: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  platformRole: string;
  emailVerifiedAt: Date | null;
  onboardingDone: boolean;
  timezone?: string;
  preferences?: unknown;
  createdAt?: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    color: u.color,
    platformRole: u.platformRole,
    emailVerified: Boolean(u.emailVerifiedAt),
    onboardingDone: u.onboardingDone,
    timezone: u.timezone,
    preferences: u.preferences ?? {},
    createdAt: u.createdAt,
  };
}
