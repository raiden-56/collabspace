import { Router } from "express";
import { prisma, type Prisma } from "@collabspace/db";
import {
  CreateTaskInput,
  UpdateTaskInput,
  MoveTaskInput,
  BulkTaskInput,
  TaskDependencyInput,
  TaskLabelInput,
  TaskQuery,
  UpdateBoardInput,
  wouldCreateCycle,
  positionBetween,
  isDoneStatus,
  validateStatusTransition,
  blockedTaskIds,
  ch,
} from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, parseQuery, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { notify } from "../lib/notify.js";
import { emit } from "../lib/realtime.js";
import { assertAccess, requireWorkspaceRole, visibleResourceWhere } from "../services/access.js";
import { nextTaskNumber } from "../services/projects.js";
import { runAutomations } from "../services/automation.js";
import { findWorkspace } from "./workspaces.js";

export const tasksRouter = Router();
export const projectTasksRouter = Router({ mergeParams: true });
export const workspaceTasksRouter = Router({ mergeParams: true });
export const boardsRouter = Router();
export const labelsRouter = Router({ mergeParams: true });

for (const r of [tasksRouter, projectTasksRouter, workspaceTasksRouter, boardsRouter, labelsRouter]) r.use(requireAuth);

export const taskInclude = {
  assignee: { select: { id: true, name: true, avatarUrl: true, color: true } },
  reporter: { select: { id: true, name: true, avatarUrl: true, color: true } },
  labels: { include: { label: true } },
  blockedBy: { include: { dependsOn: { select: { id: true, title: true, number: true, status: true, completedAt: true, projectId: true } } } },
  blocking: { include: { task: { select: { id: true, title: true, number: true, status: true, completedAt: true, projectId: true } } } },
  project: { select: { id: true, name: true, key: true, color: true, workspaceId: true } },
  _count: { select: { subtasks: { where: { deletedAt: null } }, attachments: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function shapeTask(t: TaskRow, doneStatuses?: Set<string>) {
  const blocked = t.blockedBy.some((d) => d.type === "BLOCKS" && !d.dependsOn.completedAt && !(doneStatuses?.has(d.dependsOn.status)));
  return {
    ...t,
    key: `${t.project.key}-${t.number}`,
    labels: t.labels.map((l) => l.label),
    blockedBy: t.blockedBy.map((d) => ({ ...d.dependsOn, type: d.type })),
    blocking: t.blocking.map((d) => ({ ...d.task, type: d.type })),
    subtaskCount: t._count.subtasks,
    attachmentCount: t._count.attachments,
    blocked,
  };
}

async function boardColumnsForProject(projectId: string) {
  const board = await prisma.board.findFirst({ where: { projectId, isDefault: true }, include: { columns: { orderBy: { position: "asc" } } } });
  return board?.columns ?? [];
}

function buildWhere(q: z.infer<typeof TaskQuery>): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = { deletedAt: null };
  if (!q.includeArchived) where.archivedAt = null;
  if (q.status) where.status = { in: q.status.split(",") };
  if (q.assigneeId) where.assigneeId = q.assigneeId === "none" ? null : q.assigneeId;
  if (q.priority) where.priority = q.priority;
  if (q.labelId) where.labels = { some: { labelId: q.labelId } };
  if (q.parentId) where.parentId = q.parentId === "none" ? null : q.parentId;
  if (q.q) where.OR = [{ title: { contains: q.q, mode: "insensitive" } }, { description: { contains: q.q, mode: "insensitive" } }];
  if (q.dueBefore || q.dueAfter) where.dueDate = { ...(q.dueBefore ? { lte: new Date(q.dueBefore) } : {}), ...(q.dueAfter ? { gte: new Date(q.dueAfter) } : {}) };
  return where;
}

function orderBy(q: z.infer<typeof TaskQuery>): Prisma.TaskOrderByWithRelationInput[] {
  const dir = q.order;
  switch (q.sort) {
    case "dueDate":
      return [{ dueDate: { sort: dir, nulls: "last" } }, { position: "asc" }];
    case "priority":
      return [{ priority: dir }, { position: "asc" }];
    case "createdAt":
      return [{ createdAt: dir }];
    case "updatedAt":
      return [{ updatedAt: dir }];
    case "title":
      return [{ title: dir }];
    default:
      return [{ position: dir }, { createdAt: "asc" }];
  }
}

// ---- Listing ------------------------------------------------------------------

projectTasksRouter.get(
  "/",
  h(async (req, res) => {
    const projectId = requireParam(req, "projectId");
    await assertAccess(req.user, "PROJECT", projectId, "VIEWER");
    const q = parseQuery(TaskQuery, req.query);
    const columns = await boardColumnsForProject(projectId);
    const doneStatuses = new Set(columns.filter((c) => c.isDone).map((c) => c.statusKey));
    const rows = await prisma.task.findMany({ where: { projectId, ...buildWhere(q) }, orderBy: orderBy(q), take: q.limit, include: taskInclude });
    ok(res, { tasks: rows.map((t) => shapeTask(t, doneStatuses)), columns });
  }),
);

workspaceTasksRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const q = parseQuery(TaskQuery.extend({ mine: z.coerce.boolean().optional(), projectId: z.string().optional() }), req.query);
    const projWhere = await visibleResourceWhere(req.user!, ws.id, "PROJECT", role);
    const rows = await prisma.task.findMany({
      where: {
        workspaceId: ws.id,
        ...buildWhere(q),
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.mine ? { OR: [{ assigneeId: req.user!.id }, { reporterId: req.user!.id, assigneeId: null }] } : {}),
        project: { deletedAt: null, ...projWhere },
      },
      orderBy: orderBy(q),
      take: q.limit,
      include: taskInclude,
    });
    ok(res, { tasks: rows.map((t) => shapeTask(t)) });
  }),
);

// ---- Create -------------------------------------------------------------------

projectTasksRouter.post(
  "/",
  h(async (req, res) => {
    const projectId = requireParam(req, "projectId");
    const { resource } = await assertAccess(req.user, "PROJECT", projectId, "EDITOR");
    const input = parseBody(CreateTaskInput, req.body);
    const columns = await boardColumnsForProject(projectId);
    const status = input.status ?? columns[0]?.statusKey ?? "todo";
    const err = validateStatusTransition(columns, status, status);
    if (err) throw badRequest(err);
    if (input.assigneeId) {
      const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: resource.workspaceId, userId: input.assigneeId } } });
      if (!member) throw badRequest("Assignee must be a workspace member");
    }
    if (input.parentId) {
      const parent = await prisma.task.findFirst({ where: { id: input.parentId, projectId, deletedAt: null } });
      if (!parent) throw badRequest("Parent task not found in this project");
    }
    const last = await prisma.task.findFirst({ where: { projectId, status, deletedAt: null }, orderBy: { position: "desc" }, select: { position: true } });
    const task = await prisma.$transaction(async (tx) => {
      const number = await nextTaskNumber(tx, projectId);
      return tx.task.create({
        data: {
          workspaceId: resource.workspaceId,
          projectId,
          number,
          title: input.title,
          description: input.description ?? "",
          status,
          priority: input.priority ?? "NONE",
          assigneeId: input.assigneeId ?? null,
          reporterId: req.user!.id,
          parentId: input.parentId ?? null,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          estimate: input.estimate ?? null,
          position: input.position ?? positionBetween(last?.position ?? null, null),
          completedAt: isDoneStatus(columns, status) ? new Date() : null,
          sourceType: input.source?.type ?? null,
          sourceId: input.source?.id ?? null,
          sourceMeta: (input.source?.meta ?? undefined) as Prisma.InputJsonValue | undefined,
          labels: input.labelIds?.length ? { create: input.labelIds.map((labelId) => ({ labelId })) } : undefined,
          activities: { create: { actorId: req.user!.id, type: "created", payload: {} } },
        },
        include: taskInclude,
      });
    });
    const shaped = shapeTask(task);
    await recordActivity({ workspaceId: resource.workspaceId, projectId, actorId: req.user!.id, type: "task.created", resourceType: "TASK", resourceId: task.id, resourceTitle: task.title, payload: { key: shaped.key, source: input.source?.type } });
    emit([ch.project(projectId), ch.workspace(resource.workspaceId)], { t: "task:updated", p: { workspaceId: resource.workspaceId, projectId, taskId: task.id, action: "created", task: shaped as unknown as Record<string, unknown>, actorId: req.user!.id } });
    if (task.assigneeId) {
      await runAutomations({ workspaceId: resource.workspaceId, trigger: "task.assigned", actorId: req.user!.id, task: shaped });
    }
    created(res, shaped);
  }),
);

// ---- Read / update / delete ----------------------------------------------------

tasksRouter.get(
  "/:taskId",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    const { access } = await assertAccess(req.user, "TASK", id, "VIEWER");
    const task = await prisma.task.findUniqueOrThrow({
      where: { id },
      include: {
        ...taskInclude,
        subtasks: { where: { deletedAt: null }, orderBy: { position: "asc" }, include: { assignee: { select: { id: true, name: true, avatarUrl: true, color: true } } } },
        attachments: { include: { file: { select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true } } } },
        activities: { orderBy: { createdAt: "desc" }, take: 50, include: { actor: { select: { id: true, name: true, avatarUrl: true, color: true } } } },
        parent: { select: { id: true, title: true, number: true } },
      },
    });
    const columns = await boardColumnsForProject(task.projectId);
    const ws = await prisma.workspace.findUnique({ where: { id: task.workspaceId }, select: { slug: true } });
    ok(res, { ...shapeTask(task, new Set(columns.filter((c) => c.isDone).map((c) => c.statusKey))), subtasks: task.subtasks, attachments: task.attachments.map((a) => a.file), activities: task.activities, parent: task.parent, columns, access, workspaceSlug: ws?.slug });
  }),
);

export async function applyTaskUpdate(taskId: string, input: z.infer<typeof UpdateTaskInput>, actor: Express.AuthUser) {
  const existing = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: { project: { select: { workspaceId: true, key: true } } } });
  const columns = await boardColumnsForProject(existing.projectId);
  const data: Prisma.TaskUncheckedUpdateInput = {};
  const activities: Array<{ type: string; payload: Record<string, unknown> }> = [];

  if (input.title !== undefined && input.title !== existing.title) {
    data.title = input.title;
    activities.push({ type: "title", payload: { from: existing.title, to: input.title } });
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.priority !== undefined && input.priority !== existing.priority) {
    data.priority = input.priority;
    activities.push({ type: "priority", payload: { from: existing.priority, to: input.priority } });
  }
  if (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId) {
    if (input.assigneeId) {
      const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: existing.workspaceId, userId: input.assigneeId } } });
      if (!member) throw badRequest("Assignee must be a workspace member");
    }
    data.assigneeId = input.assigneeId;
    activities.push({ type: "assignee", payload: { from: existing.assigneeId, to: input.assigneeId } });
  }
  if (input.startDate !== undefined) data.startDate = input.startDate;
  if (input.dueDate !== undefined && (input.dueDate?.getTime() ?? null) !== (existing.dueDate?.getTime() ?? null)) {
    data.dueDate = input.dueDate;
    activities.push({ type: "dueDate", payload: { from: existing.dueDate, to: input.dueDate } });
  }
  if (input.estimate !== undefined) data.estimate = input.estimate;
  if (input.parentId !== undefined) {
    if (input.parentId === taskId) throw badRequest("A task cannot be its own parent");
    data.parentId = input.parentId;
  }
  let status = existing.status;
  if (input.status !== undefined && input.status !== existing.status) {
    const err = validateStatusTransition(columns, existing.status, input.status);
    if (err) throw badRequest(err);
    status = input.status;
    data.status = status;
    activities.push({ type: "status", payload: { from: existing.status, to: status } });
  }
  const nowDone = input.completed ?? (status !== existing.status ? isDoneStatus(columns, status) : undefined);
  if (nowDone !== undefined && nowDone !== Boolean(existing.completedAt)) {
    data.completedAt = nowDone ? new Date() : null;
    if (nowDone && !isDoneStatus(columns, status)) {
      const doneCol = columns.find((c) => c.isDone);
      if (doneCol) {
        data.status = doneCol.statusKey;
        status = doneCol.statusKey;
      }
    }
    if (!nowDone && isDoneStatus(columns, status)) {
      const firstOpen = columns.find((c) => !c.isDone);
      if (firstOpen) {
        data.status = firstOpen.statusKey;
        status = firstOpen.statusKey;
      }
    }
    activities.push({ type: nowDone ? "completed" : "reopened", payload: {} });
  }
  if (input.archived !== undefined) data.archivedAt = input.archived ? new Date() : null;

  const task = await prisma.$transaction(async (tx) => {
    if (input.labelIds) {
      await tx.taskLabelAssignment.deleteMany({ where: { taskId } });
      if (input.labelIds.length) await tx.taskLabelAssignment.createMany({ data: input.labelIds.map((labelId) => ({ taskId, labelId })), skipDuplicates: true });
    }
    return tx.task.update({
      where: { id: taskId },
      data: { ...data, activities: activities.length ? { create: activities.map((a) => ({ actorId: actor.id, type: a.type, payload: a.payload as Prisma.InputJsonValue })) } : undefined },
      include: taskInclude,
    });
  });
  const shaped = shapeTask(task, new Set(columns.filter((c) => c.isDone).map((c) => c.statusKey)));
  const ws = await prisma.workspace.findUnique({ where: { id: task.workspaceId }, select: { slug: true } });
  const href = `/app/${ws?.slug}/tasks?task=${task.id}`;

  for (const a of activities) {
    await recordActivity({ workspaceId: task.workspaceId, projectId: task.projectId, actorId: actor.id, type: `task.${a.type}`, resourceType: "TASK", resourceId: task.id, resourceTitle: task.title, payload: { ...a.payload, key: shaped.key } });
  }
  emit([ch.project(task.projectId), ch.workspace(task.workspaceId)], { t: "task:updated", p: { workspaceId: task.workspaceId, projectId: task.projectId, taskId: task.id, action: "updated", task: shaped as unknown as Record<string, unknown>, actorId: actor.id } });

  if (activities.some((a) => a.type === "assignee") && task.assigneeId) {
    await runAutomations({ workspaceId: task.workspaceId, trigger: "task.assigned", actorId: actor.id, task: shaped });
  }
  if (activities.some((a) => a.type === "status" || a.type === "completed")) {
    await runAutomations({ workspaceId: task.workspaceId, trigger: "task.status_changed", actorId: actor.id, task: shaped });
    const watchers = [task.assigneeId, task.reporterId].filter((u): u is string => Boolean(u) && u !== actor.id);
    await Promise.all(watchers.map((userId) => notify({ userId, type: "TASK_STATUS", title: `${shaped.key} moved to ${status.replace("_", " ")}`, body: task.title, href, actorId: actor.id, workspaceId: task.workspaceId, resourceType: "TASK", resourceId: task.id, groupKey: `task-status:${task.id}` })));
    // Parent task: all subtasks complete?
    if (task.parentId && task.completedAt) {
      const open = await prisma.task.count({ where: { parentId: task.parentId, deletedAt: null, completedAt: null } });
      if (open === 0) {
        const parent = await prisma.task.findUnique({ where: { id: task.parentId }, include: taskInclude });
        if (parent && !parent.completedAt) await runAutomations({ workspaceId: task.workspaceId, trigger: "task.subtasks_complete", actorId: actor.id, task: shapeTask(parent) });
      }
    }
  }
  return shaped;
}

tasksRouter.patch(
  "/:taskId",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    await assertAccess(req.user, "TASK", id, "EDITOR");
    const input = parseBody(UpdateTaskInput, req.body);
    ok(res, await applyTaskUpdate(id, input, req.user!));
  }),
);

tasksRouter.post(
  "/:taskId/move",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    await assertAccess(req.user, "TASK", id, "EDITOR");
    const input = parseBody(MoveTaskInput, req.body);
    const [before, after] = await Promise.all([
      input.beforeId ? prisma.task.findUnique({ where: { id: input.beforeId }, select: { position: true } }) : null,
      input.afterId ? prisma.task.findUnique({ where: { id: input.afterId }, select: { position: true } }) : null,
    ]);
    const existing = await prisma.task.findUniqueOrThrow({ where: { id }, select: { status: true, projectId: true } });
    let position: number;
    if (!input.beforeId && !input.afterId) {
      const last = await prisma.task.findFirst({ where: { projectId: existing.projectId, status: input.status, deletedAt: null, id: { not: id } }, orderBy: { position: "desc" }, select: { position: true } });
      position = positionBetween(last?.position ?? null, null);
    } else {
      position = positionBetween(before?.position ?? null, after?.position ?? null);
    }
    await prisma.task.update({ where: { id }, data: { position } });
    const shaped = await applyTaskUpdate(id, { status: input.status !== existing.status ? input.status : undefined }, req.user!);
    emit([ch.project(existing.projectId)], { t: "task:updated", p: { workspaceId: shaped.workspaceId, projectId: existing.projectId, taskId: id, action: "moved", task: shaped as unknown as Record<string, unknown>, actorId: req.user!.id } });
    ok(res, shaped);
  }),
);

tasksRouter.delete(
  "/:taskId",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    const { resource } = await assertAccess(req.user, "TASK", id, "EDITOR");
    await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "task.deleted", resourceType: "TASK", resourceId: id, resourceTitle: resource.title });
    emit([ch.project(resource.projectId!), ch.workspace(resource.workspaceId)], { t: "task:updated", p: { workspaceId: resource.workspaceId, projectId: resource.projectId!, taskId: id, action: "deleted", actorId: req.user!.id } });
    noContent(res);
  }),
);

// ---- Dependencies -------------------------------------------------------------

tasksRouter.post(
  "/:taskId/dependencies",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    const { resource } = await assertAccess(req.user, "TASK", id, "EDITOR");
    const input = parseBody(TaskDependencyInput, req.body);
    const other = await prisma.task.findFirst({ where: { id: input.dependsOnTaskId, workspaceId: resource.workspaceId, deletedAt: null } });
    if (!other) throw notFound("Dependency task");
    const edges = await prisma.taskDependency.findMany({ where: { type: "BLOCKS", task: { workspaceId: resource.workspaceId } }, select: { taskId: true, dependsOnTaskId: true } });
    if (input.type === "BLOCKS" && wouldCreateCycle(edges, id, input.dependsOnTaskId)) throw conflict("This dependency would create a cycle");
    const dep = await prisma.taskDependency.upsert({
      where: { taskId_dependsOnTaskId: { taskId: id, dependsOnTaskId: input.dependsOnTaskId } },
      update: { type: input.type },
      create: { taskId: id, dependsOnTaskId: input.dependsOnTaskId, type: input.type },
    });
    await prisma.taskActivity.create({ data: { taskId: id, actorId: req.user!.id, type: "dependency_added", payload: { dependsOnTaskId: input.dependsOnTaskId, type: input.type } } });
    const task = await prisma.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    emit([ch.project(task.projectId)], { t: "task:updated", p: { workspaceId: task.workspaceId, projectId: task.projectId, taskId: id, action: "updated", task: shapeTask(task) as unknown as Record<string, unknown>, actorId: req.user!.id } });
    created(res, { dependency: dep, task: shapeTask(task) });
  }),
);

tasksRouter.delete(
  "/:taskId/dependencies/:dependsOnTaskId",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    await assertAccess(req.user, "TASK", id, "EDITOR");
    await prisma.taskDependency.deleteMany({ where: { taskId: id, dependsOnTaskId: requireParam(req, "dependsOnTaskId") } });
    const task = await prisma.task.findUniqueOrThrow({ where: { id }, include: taskInclude });
    emit([ch.project(task.projectId)], { t: "task:updated", p: { workspaceId: task.workspaceId, projectId: task.projectId, taskId: id, action: "updated", task: shapeTask(task) as unknown as Record<string, unknown>, actorId: req.user!.id } });
    ok(res, shapeTask(task));
  }),
);

projectTasksRouter.get(
  "/graph",
  h(async (req, res) => {
    const projectId = requireParam(req, "projectId");
    await assertAccess(req.user, "PROJECT", projectId, "VIEWER");
    const tasks = await prisma.task.findMany({ where: { projectId, deletedAt: null }, select: { id: true, title: true, number: true, status: true, completedAt: true, startDate: true, dueDate: true, assigneeId: true } });
    const edges = await prisma.taskDependency.findMany({ where: { task: { projectId }, type: "BLOCKS" }, select: { taskId: true, dependsOnTaskId: true } });
    const blocked = blockedTaskIds(edges, (id) => Boolean(tasks.find((t) => t.id === id)?.completedAt));
    ok(res, { tasks: tasks.map((t) => ({ ...t, blocked: blocked.has(t.id) })), edges });
  }),
);

// ---- Attachments ------------------------------------------------------------

tasksRouter.post(
  "/:taskId/attachments",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    const { resource } = await assertAccess(req.user, "TASK", id, "EDITOR");
    const { fileId } = parseBody(z.object({ fileId: z.string() }), req.body);
    const file = await prisma.fileAsset.findFirst({ where: { id: fileId, workspaceId: resource.workspaceId, deletedAt: null } });
    if (!file) throw notFound("File");
    await prisma.taskAttachment.upsert({ where: { taskId_fileId: { taskId: id, fileId } }, update: {}, create: { taskId: id, fileId } });
    await prisma.taskActivity.create({ data: { taskId: id, actorId: req.user!.id, type: "attachment_added", payload: { fileId, name: file.name } } });
    created(res, { id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes });
  }),
);

tasksRouter.delete(
  "/:taskId/attachments/:fileId",
  h(async (req, res) => {
    const id = requireParam(req, "taskId");
    await assertAccess(req.user, "TASK", id, "EDITOR");
    await prisma.taskAttachment.deleteMany({ where: { taskId: id, fileId: requireParam(req, "fileId") } });
    noContent(res);
  }),
);

// ---- Bulk ---------------------------------------------------------------------

workspaceTasksRouter.post(
  "/bulk",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const input = parseBody(BulkTaskInput, req.body);
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const taskId of input.taskIds) {
      try {
        await assertAccess(req.user, "TASK", taskId, "EDITOR");
        if (input.patch.delete) {
          await prisma.task.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
        } else {
          if (input.patch.addLabelIds?.length) await prisma.taskLabelAssignment.createMany({ data: input.patch.addLabelIds.map((labelId) => ({ taskId, labelId })), skipDuplicates: true });
          await applyTaskUpdate(taskId, { status: input.patch.status, priority: input.patch.priority, assigneeId: input.patch.assigneeId, dueDate: input.patch.dueDate, archived: input.patch.archived }, req.user!);
        }
        results.push({ id: taskId, ok: true });
      } catch (err) {
        results.push({ id: taskId, ok: false, error: (err as Error).message });
      }
    }
    ok(res, results);
  }),
);

// ---- Labels -------------------------------------------------------------------

labelsRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id);
    ok(res, await prisma.taskLabel.findMany({ where: { workspaceId: ws.id }, orderBy: { name: "asc" } }));
  }),
);

labelsRouter.post(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const input = parseBody(TaskLabelInput, req.body);
    created(res, await prisma.taskLabel.upsert({ where: { workspaceId_name: { workspaceId: ws.id, name: input.name } }, update: { color: input.color }, create: { workspaceId: ws.id, name: input.name, color: input.color ?? "#9B7BFF" } }));
  }),
);

labelsRouter.delete(
  "/:labelId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "ADMIN");
    await prisma.taskLabel.deleteMany({ where: { id: requireParam(req, "labelId"), workspaceId: ws.id } });
    noContent(res);
  }),
);

// ---- Boards -------------------------------------------------------------------

boardsRouter.get(
  "/:boardId",
  h(async (req, res) => {
    const id = requireParam(req, "boardId");
    const { access } = await assertAccess(req.user, "BOARD", id, "VIEWER");
    const board = await prisma.board.findUniqueOrThrow({ where: { id }, include: { columns: { orderBy: { position: "asc" } }, project: { select: { id: true, name: true, key: true, color: true, workspaceId: true, workspace: { select: { slug: true } } } } } });
    const tasks = await prisma.task.findMany({ where: { projectId: board.projectId, deletedAt: null, archivedAt: null }, orderBy: [{ position: "asc" }], include: taskInclude });
    const done = new Set(board.columns.filter((c) => c.isDone).map((c) => c.statusKey));
    ok(res, { ...board, tasks: tasks.map((t) => shapeTask(t, done)), access });
  }),
);

boardsRouter.patch(
  "/:boardId",
  h(async (req, res) => {
    const id = requireParam(req, "boardId");
    await assertAccess(req.user, "BOARD", id, "EDITOR");
    const input = parseBody(UpdateBoardInput, req.body);
    const board = await prisma.board.findUniqueOrThrow({ where: { id }, include: { columns: true } });
    await prisma.$transaction(async (tx) => {
      if (input.name) await tx.board.update({ where: { id }, data: { name: input.name } });
      if (input.columns) {
        const keys = new Set(input.columns.map((c) => c.statusKey));
        if (keys.size !== input.columns.length) throw badRequest("Column status keys must be unique");
        if (!input.columns.some((c) => c.isDone)) throw badRequest("At least one column must be marked as done");
        const keepIds = new Set(input.columns.map((c) => c.id).filter(Boolean));
        for (const existing of board.columns) {
          if (!keepIds.has(existing.id) && !keys.has(existing.statusKey)) {
            const inUse = await tx.task.count({ where: { projectId: board.projectId, status: existing.statusKey, deletedAt: null } });
            if (inUse > 0) throw badRequest(`Column "${existing.name}" still has ${inUse} task(s). Move them first.`);
            await tx.boardColumn.delete({ where: { id: existing.id } });
          }
        }
        for (const [i, c] of input.columns.entries()) {
          const data = { name: c.name, statusKey: c.statusKey, color: c.color ?? "#A0A9BC", isDone: c.isDone ?? false, wipLimit: c.wipLimit ?? null, position: (i + 1) * 1000 };
          const existingByKey = board.columns.find((x) => x.id === c.id || x.statusKey === c.statusKey);
          if (existingByKey) {
            if (existingByKey.statusKey !== c.statusKey) await tx.task.updateMany({ where: { projectId: board.projectId, status: existingByKey.statusKey }, data: { status: c.statusKey } });
            await tx.boardColumn.update({ where: { id: existingByKey.id }, data });
          } else await tx.boardColumn.create({ data: { ...data, boardId: id } });
        }
      }
    });
    const updated = await prisma.board.findUniqueOrThrow({ where: { id }, include: { columns: { orderBy: { position: "asc" } } } });
    emit([ch.project(board.projectId)], { t: "resource:updated", p: { resourceType: "BOARD", resourceId: id, projectId: board.projectId, action: "updated", actorId: req.user!.id } });
    ok(res, updated);
  }),
);
