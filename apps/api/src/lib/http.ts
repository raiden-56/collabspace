import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";
import { badRequest } from "./errors.js";

export type Handler<P = Record<string, string>> = (req: Request<P>, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** Wrap async handlers so rejections reach the error middleware. */
export function h<P = Record<string, string>>(fn: Handler<P>): RequestHandler<P> {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw result.error;
  return result.data;
}

export function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query ?? {});
  if (!result.success) throw result.error;
  return result.data;
}

export function requireParam(req: Request, name: string): string {
  const v = (req.params as Record<string, string | undefined>)[name];
  if (!v) throw badRequest(`Missing route parameter ${name}`);
  return v;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Cursor pagination over an ordered list: fetch limit+1 and slice. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data });
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ data });
}

export function noContent(res: Response): void {
  res.status(204).end();
}

export function clientIp(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? undefined;
}
