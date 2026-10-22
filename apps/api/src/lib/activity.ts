import { prisma, type ResourceType } from "@collabspace/db";
import { ch } from "@collabspace/shared";
import { emit } from "./realtime.js";
import { logger } from "./logger.js";

export interface ActivityInput {
  workspaceId: string;
  projectId?: string | null;
  actorId?: string | null;
  type: string;
  resourceType?: ResourceType | null;
  resourceId?: string | null;
  resourceTitle?: string | null;
  payload?: Record<string, unknown>;
}

/** Records a meaningful workspace event and fans out a resource:updated event. Never throws. */
export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        resourceTitle: input.resourceTitle ?? null,
        payload: (input.payload ?? {}) as object,
      },
    });
    if (input.resourceType && input.resourceId) {
      const action = input.type.endsWith(".created")
        ? "created"
        : input.type.endsWith(".deleted")
          ? "deleted"
          : input.type.endsWith(".restored")
            ? "restored"
            : input.type.endsWith(".archived")
              ? "archived"
              : "updated";
      emit([ch.workspace(input.workspaceId), ...(input.projectId ? [ch.project(input.projectId)] : [])], {
        t: "resource:updated",
        p: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          workspaceId: input.workspaceId,
          projectId: input.projectId ?? null,
          action,
          actorId: input.actorId ?? undefined,
        },
      });
    }
  } catch (err) {
    logger.warn({ err, type: input.type }, "activity write failed");
  }
}
