import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@collabspace/db";
import { logger } from "./logger.js";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Authentication required") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have access to this resource") => new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const tooMany = (message = "Too many requests, please slow down") => new AppError(429, "rate_limited", message);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, "unprocessable", message, details);

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details ?? undefined } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_error",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ error: { code: "conflict", message: "A record with these values already exists" } });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: { code: "not_found", message: "Resource not found" } });
      return;
    }
  }
  const anyErr = err as { type?: string; status?: number; message?: string };
  if (anyErr?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "payload_too_large", message: "Request body is too large" } });
    return;
  }
  if (anyErr?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "bad_json", message: "Malformed JSON body" } });
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
}
