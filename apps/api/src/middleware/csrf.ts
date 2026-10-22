import type { RequestHandler } from "express";
import { config } from "../config.js";
import { forbidden } from "../lib/errors.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated, state-changing requests:
 * the session cookie is SameSite=Lax, and in addition every unsafe request must carry an
 * Origin (or Referer) header that matches a trusted origin. Browsers always send Origin on
 * cross-site POSTs, so a forged form submission from another site is rejected here.
 * Non-browser clients (tests, CLIs) send no Origin and no cookie — they are unaffected.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE.has(req.method)) return next();
  const hasCookie = Boolean((req.cookies as Record<string, string | undefined>)?.[config.sessionCookie]);
  if (!hasCookie) return next();
  const origin = req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : undefined);
  if (!origin) {
    // Same-origin fetches from the Next.js proxy always include Origin; a missing header with a
    // cookie present is suspicious except for custom header requests (which cannot be forged cross-site).
    if (req.headers["x-requested-with"] === "fetch") return next();
    return next(forbidden("Missing Origin header"));
  }
  if (!config.TRUSTED_ORIGINS.includes(origin) && origin !== config.API_URL) return next(forbidden("Untrusted request origin"));
  next();
};

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
