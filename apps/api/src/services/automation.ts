import { prisma, type AutomationRule, type Prisma } from "@collabspace/db";
import { notify } from "../lib/notify.js";
import { logger } from "../lib/logger.js";
import { emit } from "../lib/realtime.js";
import { ch } from "@collabspace/shared";

/**
 * Rules-based automation engine.
 * - Triggers fire from domain code (task assigned, status changed, meeting ended, resource shared, overdue scan).
 * - Conditions are simple field comparisons against the event payload.
 * - Actions with meaningful consequences (set_status, draft_summary) require approval unless the rule
 *   explicitly disables it; "suggest_status" always results in a pending approval.
 * - Loop prevention: executions carry a chain depth; automation-triggered events stop at MAX_DEPTH, and
 *   a rule never re-fires for the same (rule, resource) within a short window.
 * - Retry: failed executions are retried up to MAX_ATTEMPTS by the periodic scheduler.
 */

export const MAX_DEPTH = 3;
export const MAX_ATTEMPTS = 3;

export type Trigger = "task.assigned" | "task.overdue" | "task.subtasks_complete" | "meeting.ended" | "resource.shared" | "task.status_changed";

export interface AutomationEvent {
  workspaceId: string;
  trigger: Trigger;
  actorId?: string | null;
  depth?: number;
  task?: Record<string, unknown> & { id: string; title: string; assigneeId?: string | null; reporterId?: string; projectId: string; status: string; key?: string };
  meeting?: { id: string; title: string; createdById: string; projectId?: string | null };
  share?: { resourceType: string; resourceId: string; title: string; granteeId: string };
}

interface Condition {
  field: string;
  op: "eq" | "neq" | "in" | "contains";
  value: unknown;
}

function getField(event: AutomationEvent, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), event as unknown);
}

export function conditionsMatch(conditions: Condition[], event: AutomationEvent): boolean {
  return conditions.every((c) => {
    const v = getField(event, c.field);
    switch (c.op) {
      case "eq":
        return v === c.value;
      case "neq":
        return v !== c.value;
      case "in":
        return Array.isArray(c.value) && c.value.includes(v);
      case "contains":
        return typeof v === "string" && typeof c.value === "string" && v.toLowerCase().includes(c.value.toLowerCase());
    }
  });
}

export async function runAutomations(event: AutomationEvent): Promise<void> {
  const depth = event.depth ?? 0;
  if (depth >= MAX_DEPTH) {
    logger.warn({ trigger: event.trigger }, "automation chain depth exceeded — stopping");
    return;
  }
  const rules = await prisma.automationRule.findMany({ where: { workspaceId: event.workspaceId, trigger: event.trigger, enabled: true } });
  for (const rule of rules) {
    try {
      if (!conditionsMatch((rule.conditions as unknown as Condition[]) ?? [], event)) continue;
      const resourceId = event.task?.id ?? event.meeting?.id ?? event.share?.resourceId ?? "";
      // Debounce: skip if the same rule executed for the same resource within 60s.
      const recent = await prisma.automationExecution.findFirst({
        where: { ruleId: rule.id, createdAt: { gte: new Date(Date.now() - 60_000) }, triggerEvent: { path: ["resourceId"], equals: resourceId } },
      });
      if (recent) continue;
      await executeRule(rule, event, depth);
    } catch (err) {
      logger.warn({ err, rule: rule.id }, "automation rule failed");
    }
  }
}

async function executeRule(rule: AutomationRule, event: AutomationEvent, depth: number): Promise<void> {
  const actions = (rule.actions as Array<Record<string, unknown>>) ?? [];
  const needsApproval = rule.requiresApproval || actions.some((a) => a.type === "suggest_status" || a.type === "draft_summary" || a.type === "set_status");
  const triggerEvent = {
    trigger: event.trigger,
    resourceId: event.task?.id ?? event.meeting?.id ?? event.share?.resourceId ?? "",
    resourceTitle: event.task?.title ?? event.meeting?.title ?? event.share?.title ?? "",
    task: event.task ? { id: event.task.id, title: event.task.title, key: event.task.key, projectId: event.task.projectId, assigneeId: event.task.assigneeId, reporterId: event.task.reporterId, status: event.task.status } : undefined,
    meeting: event.meeting,
    share: event.share,
    actorId: event.actorId ?? null,
  };
  const exec = await prisma.automationExecution.create({
    data: { ruleId: rule.id, status: needsApproval ? "PENDING_APPROVAL" : "RUNNING", triggerEvent: triggerEvent as Prisma.InputJsonObject, depth, attempts: 1 },
  });
  if (needsApproval) {
    // Ask the most relevant person to approve.
    const approver = event.task?.assigneeId ?? event.task?.reporterId ?? event.meeting?.createdById ?? event.actorId;
    const ws = await prisma.workspace.findUnique({ where: { id: event.workspaceId }, select: { slug: true } });
    if (approver) {
      await notify({
        userId: approver,
        type: "AUTOMATION",
        title: `Automation suggestion: ${rule.name}`,
        body: describeActions(actions, triggerEvent.resourceTitle),
        href: `/app/${ws?.slug}/settings?tab=automation&execution=${exec.id}`,
        workspaceId: event.workspaceId,
        resourceType: event.task ? "TASK" : event.meeting ? "MEETING" : null,
        resourceId: triggerEvent.resourceId || null,
      });
    }
    return;
  }
  await performActions(exec.id, rule, actions, event, depth);
}

function describeActions(actions: Array<Record<string, unknown>>, title: string): string {
  return actions
    .map((a) => {
      switch (a.type) {
        case "suggest_status":
        case "set_status":
          return `Move "${title}" to ${String(a.status).replace("_", " ")}`;
        case "draft_summary":
          return `Prepare an AI draft summary for "${title}"`;
        case "notify":
          return `Notify ${a.target}`;
        case "add_label":
          return `Add a label to "${title}"`;
        default:
          return String(a.type);
      }
    })
    .join("; ");
}

export async function performActions(executionId: string, rule: AutomationRule, actions: Array<Record<string, unknown>>, event: AutomationEvent, depth: number): Promise<void> {
  const results: Array<Record<string, unknown>> = [];
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: event.workspaceId }, select: { slug: true } });
    for (const a of actions) {
      switch (a.type) {
        case "notify": {
          const target = a.target as string;
          let userId: string | null | undefined;
          if (target === "assignee") userId = event.task?.assigneeId ?? event.task?.reporterId;
          else if (target === "reporter") userId = event.task?.reporterId;
          else if (target === "actor") userId = event.share?.granteeId ?? event.actorId;
          else if (target === "project_lead" && event.task) {
            const lead = await prisma.projectMember.findFirst({ where: { projectId: event.task.projectId, role: "LEAD" } });
            userId = lead?.userId;
          }
          if (userId) {
            const title = (a.message as string | undefined) ?? defaultMessage(event);
            await notify({
              userId,
              type: event.trigger === "task.assigned" ? "TASK_ASSIGNED" : event.trigger === "task.overdue" ? "TASK_DUE" : event.trigger === "resource.shared" ? "SHARE_ACCESS" : "AUTOMATION",
              title,
              body: event.task?.title ?? event.share?.title ?? event.meeting?.title ?? null,
              href: event.task ? `/app/${ws?.slug}/tasks?task=${event.task.id}` : event.share ? `/app/${ws?.slug}/${event.share.resourceType.toLowerCase() === "canvas" ? "canvas" : "docs"}/${event.share.resourceId}` : event.meeting ? `/app/${ws?.slug}/meetings/${event.meeting.id}` : null,
              actorId: event.actorId ?? null,
              workspaceId: event.workspaceId,
              resourceType: event.task ? "TASK" : event.meeting ? "MEETING" : event.share ? (event.share.resourceType as "CANVAS" | "DOCUMENT") : null,
              resourceId: event.task?.id ?? event.meeting?.id ?? event.share?.resourceId ?? null,
              email: event.trigger === "task.assigned" || event.trigger === "resource.shared",
            });
            results.push({ type: "notify", userId });
          }
          break;
        }
        case "set_status":
        case "suggest_status": {
          if (!event.task) break;
          const { applyTaskUpdate } = await import("../routes/tasks.js");
          const actor = await prisma.user.findUnique({ where: { id: event.actorId ?? event.task.reporterId ?? "" } });
          if (actor) {
            await applyTaskUpdate(event.task.id, { status: a.status as string }, actor as unknown as Express.AuthUser);
            results.push({ type: "set_status", status: a.status });
          }
          break;
        }
        case "add_label": {
          if (!event.task) break;
          await prisma.taskLabelAssignment.createMany({ data: [{ taskId: event.task.id, labelId: a.labelId as string }], skipDuplicates: true });
          results.push({ type: "add_label" });
          break;
        }
        case "draft_summary": {
          if (!event.meeting) break;
          const { enqueueMeetingSummary } = await import("./ai/jobs.js");
          const transcript = await prisma.meetingTranscript.findFirst({ where: { meetingId: event.meeting.id }, orderBy: { createdAt: "desc" } });
          if (transcript) {
            await enqueueMeetingSummary({ meetingId: event.meeting.id, transcriptId: transcript.id, userId: event.meeting.createdById, workspaceId: event.workspaceId, includeNotes: true });
            results.push({ type: "draft_summary", transcriptId: transcript.id });
          } else results.push({ type: "draft_summary", skipped: "no transcript" });
          break;
        }
      }
    }
    await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "SUCCEEDED", result: results as Prisma.InputJsonValue, finishedAt: new Date() } });
    emit([ch.workspace(event.workspaceId)], { t: "resource:updated", p: { resourceType: "AUTOMATION", resourceId: rule.id, workspaceId: event.workspaceId, action: "updated" } });
  } catch (err) {
    await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "FAILED", error: (err as Error).message, finishedAt: new Date() } });
    throw err;
  }
}

function defaultMessage(event: AutomationEvent): string {
  switch (event.trigger) {
    case "task.assigned":
      return `You were assigned ${event.task?.key ?? "a task"}`;
    case "task.overdue":
      return `${event.task?.key ?? "A task"} is overdue`;
    case "resource.shared":
      return `${event.share?.title ?? "A resource"} was shared with you`;
    case "task.subtasks_complete":
      return `All subtasks of ${event.task?.key ?? "a task"} are complete`;
    default:
      return "Automation notification";
  }
}

/** Approve or reject a pending execution (called from the automation routes). */
export async function resolveExecution(executionId: string, approve: boolean): Promise<void> {
  const exec = await prisma.automationExecution.findUniqueOrThrow({ where: { id: executionId }, include: { rule: true } });
  if (exec.status !== "PENDING_APPROVAL") return;
  if (!approve) {
    await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "REJECTED", finishedAt: new Date() } });
    return;
  }
  const te = exec.triggerEvent as { trigger: Trigger; task?: AutomationEvent["task"]; meeting?: AutomationEvent["meeting"]; share?: AutomationEvent["share"]; actorId?: string | null };
  await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "RUNNING" } });
  const actions = ((exec.rule.actions as Array<Record<string, unknown>>) ?? []).map((a) => (a.type === "suggest_status" ? { ...a, type: "set_status" } : a));
  await performActions(executionId, exec.rule, actions, { workspaceId: exec.rule.workspaceId, trigger: te.trigger, task: te.task, meeting: te.meeting, share: te.share, actorId: te.actorId, depth: exec.depth + 1 }, exec.depth + 1);
}

/** Periodic scan: fire task.overdue once per task when the due date passes. */
export async function scanOverdueTasks(): Promise<number> {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, completedAt: null, dueDate: { lt: now, gte: since } },
    select: { id: true, title: true, number: true, workspaceId: true, projectId: true, assigneeId: true, reporterId: true, status: true, project: { select: { key: true } } },
  });
  let fired = 0;
  for (const t of tasks) {
    const already = await prisma.taskActivity.findFirst({ where: { taskId: t.id, type: "overdue_notified" } });
    if (already) continue;
    await prisma.taskActivity.create({ data: { taskId: t.id, type: "overdue_notified", payload: {} } });
    await runAutomations({ workspaceId: t.workspaceId, trigger: "task.overdue", task: { ...t, key: `${t.project.key}-${t.number}` } });
    fired += 1;
  }
  return fired;
}

/** Retry failed executions that have attempts left. */
export async function retryFailedExecutions(): Promise<number> {
  const failed = await prisma.automationExecution.findMany({ where: { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } }, include: { rule: true }, take: 20 });
  let retried = 0;
  for (const exec of failed) {
    const te = exec.triggerEvent as { trigger: Trigger; task?: AutomationEvent["task"]; meeting?: AutomationEvent["meeting"]; share?: AutomationEvent["share"]; actorId?: string | null };
    await prisma.automationExecution.update({ where: { id: exec.id }, data: { status: "RUNNING", attempts: { increment: 1 }, error: null } });
    try {
      await performActions(exec.id, exec.rule, (exec.rule.actions as Array<Record<string, unknown>>) ?? [], { workspaceId: exec.rule.workspaceId, trigger: te.trigger, task: te.task, meeting: te.meeting, share: te.share, actorId: te.actorId, depth: exec.depth }, exec.depth);
    } catch {
      /* recorded as FAILED by performActions */
    }
    retried += 1;
  }
  return retried;
}
