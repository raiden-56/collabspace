import type { RequestHandler } from "express";
import { getRedis, redisReady } from "./redis.js";
import { tooMany } from "./errors.js";
import { clientIp } from "./http.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const memory = new Map<string, Bucket>();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of memory) if (b.resetAt <= now) memory.delete(k);
}, 60_000).unref();

export interface RateLimitOptions {
  /** Window in milliseconds */
  windowMs: number;
  /** Max requests per window */
  max: number;
  /** Key prefix, e.g. "login" */
  name: string;
  /** Key function; defaults to user id or IP */
  keyFn?: (req: Parameters<RequestHandler>[0]) => string;
}

/**
 * Fixed-window rate limiter. Uses Redis when available (multi-instance safe), otherwise memory.
 */
export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    try {
      const subject = opts.keyFn ? opts.keyFn(req) : (req.user?.id ?? clientIp(req) ?? "anon");
      const key = `rl:${opts.name}:${subject}`;
      const now = Date.now();
      let count: number;
      let resetAt: number;
      const redis = getRedis();
      if (redis && redisReady()) {
        const ttl = Math.ceil(opts.windowMs / 1000);
        const multi = redis.multi().incr(key).ttl(key);
        const results = await multi.exec();
        count = Number(results?.[0]?.[1] ?? 1);
        let remainingTtl = Number(results?.[1]?.[1] ?? -1);
        if (remainingTtl < 0) {
          await redis.expire(key, ttl);
          remainingTtl = ttl;
        }
        resetAt = now + remainingTtl * 1000;
      } else {
        let b = memory.get(key);
        if (!b || b.resetAt <= now) {
          b = { count: 0, resetAt: now + opts.windowMs };
          memory.set(key, b);
        }
        b.count += 1;
        count = b.count;
        resetAt = b.resetAt;
      }
      res.setHeader("X-RateLimit-Limit", String(opts.max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, opts.max - count)));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      if (count > opts.max) {
        res.setHeader("Retry-After", String(Math.ceil((resetAt - now) / 1000)));
        next(tooMany());
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
