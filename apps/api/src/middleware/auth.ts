import type { NextFunction, Request, RequestHandler, Response } from "express";
import { config } from "../config.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { resolveSession } from "../services/sessions.js";

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export const attachUser: RequestHandler = async (req, _res, next) => {
  try {
    const token = (req.cookies as Record<string, string | undefined>)?.[config.sessionCookie];
    if (token) {
      const resolved = await resolveSession(token);
      if (resolved) {
        req.user = resolved.user;
        req.sessionId = resolved.sessionId;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  next();
}

export function requireVerified(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (!req.user.emailVerifiedAt && config.isProd) return next(forbidden("Please verify your email address first"));
  next();
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.platformRole !== "ADMIN") return next(forbidden("Platform administrator access required"));
  next();
}

/** Allow anonymous access when a share token is supplied; the route must still call assertAccess with it. */
export function requireAuthUnlessShare(req: Request, _res: Response, next: NextFunction): void {
  if (req.user || (req.method === "GET" && typeof req.query.share === "string" && req.query.share.length > 0)) return next();
  next(unauthorized());
}
