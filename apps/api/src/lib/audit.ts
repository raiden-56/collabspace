import { prisma } from "@collabspace/db";
import type { Request } from "express";
import { clientIp } from "./http.js";
import { logger } from "./logger.js";

export interface AuditInput {
  action: string;
  workspaceId?: string | null;
  actorId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  req?: Request;
}

/** Append-only audit trail. Never throws. Avoid putting private content in metadata. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        workspaceId: input.workspaceId ?? null,
        actorId: input.actorId ?? input.req?.user?.id ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        ip: input.req ? (clientIp(input.req) ?? null) : null,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch (err) {
    logger.warn({ err, action: input.action }, "audit log write failed");
  }
}
