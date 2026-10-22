import { prisma, type Prisma, type TaskPriority } from "@collabspace/db";
import { DEFAULT_BOARD_COLUMNS, PROJECT_TEMPLATES, projectKeyFromName } from "@collabspace/shared";
import { recordActivity } from "../lib/activity.js";
import { badRequest, conflict } from "../lib/errors.js";
import { seedCanvasFromTemplate, seedDocumentContent } from "./collab.js";
import { CANVAS_TEMPLATES } from "@collabspace/shared";

export async function uniqueProjectKey(workspaceId: string, desired: string): Promise<string> {
  let key = desired.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "PRJ";
  const base = key;
  for (let i = 2; i < 100; i++) {
    const exists = await prisma.project.findUnique({ where: { workspaceId_key: { workspaceId, key } } });
    if (!exists) return key;
    key = `${base.slice(0, 5)}${i}`;
  }
  throw conflict("Could not allocate a unique project key");
}

export interface CreateProjectOptions {
  workspaceId: string;
  ownerId: string;
  name: string;
  key?: string;
  description?: string;
  color?: string;
  icon?: string;
  visibility?: "WORKSPACE" | "PRIVATE";
  startDate?: Date | null;
  dueDate?: Date | null;
  memberIds?: string[];
  columns?: Array<{ name: string; statusKey: string; color: string; isDone?: boolean }>;
}

export async function createProject(opts: CreateProjectOptions) {
  const key = await uniqueProjectKey(opts.workspaceId, opts.key ?? projectKeyFromName(opts.name));
  const columns = opts.columns ?? [...DEFAULT_BOARD_COLUMNS];
  const memberIds = new Set([opts.ownerId, ...(opts.memberIds ?? [])]);
  const project = await prisma.project.create({
    data: {
      workspaceId: opts.workspaceId,
      ownerId: opts.ownerId,
      name: opts.name,
      key,
      description: opts.description ?? null,
      color: opts.color ?? "#5B8CFF",
      icon: opts.icon ?? null,
      visibility: opts.visibility ?? "WORKSPACE",
      startDate: opts.startDate ?? null,
      dueDate: opts.dueDate ?? null,
      members: { create: [...memberIds].map((userId) => ({ userId, role: userId === opts.ownerId ? "LEAD" : "MEMBER" })) },
      boards: {
        create: {
          workspaceId: opts.workspaceId,
          name: "Board",
          isDefault: true,
          columns: { create: columns.map((c, i) => ({ name: c.name, statusKey: c.statusKey, color: c.color, isDone: c.isDone ?? false, position: (i + 1) * 1000 })) },
        },
      },
      channels: { create: { workspaceId: opts.workspaceId, type: "PROJECT", name: opts.name, createdById: opts.ownerId, members: { create: [...memberIds].map((userId) => ({ userId })) } } },
    },
    include: { boards: { include: { columns: true } } },
  });
  await recordActivity({ workspaceId: opts.workspaceId, projectId: project.id, actorId: opts.ownerId, type: "project.created", resourceType: "PROJECT", resourceId: project.id, resourceTitle: project.name });
  return project;
}

export async function nextTaskNumber(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  const p = await tx.project.update({ where: { id: projectId }, data: { taskCounter: { increment: 1 } }, select: { taskCounter: true } });
  return p.taskCounter;
}

export interface TemplateInstantiation {
  workspaceId: string;
  ownerId: string;
  templateKey: string;
  name?: string;
  startDate?: Date | null;
}

/** Create a project with real tasks, documents, boards, canvases and relationships from a template. */
export async function createProjectFromTemplate(opts: TemplateInstantiation) {
  const tpl = PROJECT_TEMPLATES.find((t) => t.key === opts.templateKey);
  if (!tpl) throw badRequest(`Unknown project template ${opts.templateKey}`);
  const start = opts.startDate ?? new Date();
  const project = await createProject({
    workspaceId: opts.workspaceId,
    ownerId: opts.ownerId,
    name: opts.name ?? tpl.name,
    description: tpl.description,
    color: tpl.color,
    icon: tpl.icon,
    columns: tpl.columns,
    startDate: start,
    dueDate: tpl.milestones?.length ? addDays(start, Math.max(...tpl.milestones.map((m) => m.dueOffsetDays))) : null,
  });

  // Labels (workspace-scoped, reuse existing)
  const labelIds = new Map<string, string>();
  for (const l of tpl.labels) {
    const label = await prisma.taskLabel.upsert({
      where: { workspaceId_name: { workspaceId: opts.workspaceId, name: l.name } },
      update: {},
      create: { workspaceId: opts.workspaceId, name: l.name, color: l.color },
    });
    labelIds.set(l.name, label.id);
  }

  // Tasks (two passes: create, then parents/dependencies)
  const taskIds = new Map<string, string>();
  await prisma.$transaction(async (tx) => {
    let pos = 1000;
    for (const t of tpl.tasks) {
      const number = await nextTaskNumber(tx, project.id);
      const status = t.status ?? "todo";
      const created = await tx.task.create({
        data: {
          workspaceId: opts.workspaceId,
          projectId: project.id,
          number,
          title: t.title,
          description: t.description ?? "",
          status,
          priority: (t.priority ?? "NONE") as TaskPriority,
          reporterId: opts.ownerId,
          position: pos,
          startDate: t.startOffsetDays != null ? addDays(start, t.startOffsetDays) : null,
          dueDate: t.dueOffsetDays != null ? addDays(start, t.dueOffsetDays) : null,
          completedAt: status === "done" ? new Date() : null,
          labels: { create: (t.labels ?? []).filter((n) => labelIds.has(n)).map((n) => ({ labelId: labelIds.get(n)! })) },
        },
      });
      taskIds.set(t.key, created.id);
      pos += 1000;
    }
    for (const t of tpl.tasks) {
      const id = taskIds.get(t.key)!;
      if (t.parentKey && taskIds.has(t.parentKey)) await tx.task.update({ where: { id }, data: { parentId: taskIds.get(t.parentKey)! } });
      for (const dep of t.dependsOn ?? []) {
        if (taskIds.has(dep)) await tx.taskDependency.create({ data: { taskId: id, dependsOnTaskId: taskIds.get(dep)!, type: "BLOCKS" } });
      }
    }
  });

  // Documents
  for (const d of tpl.documents) {
    const doc = await prisma.document.create({
      data: { workspaceId: opts.workspaceId, projectId: project.id, title: d.title, icon: d.icon ?? null, createdById: opts.ownerId, templateKey: tpl.key },
    });
    await seedDocumentContent(doc.id, d.content);
  }

  // Canvases
  for (const key of tpl.canvasTemplateKeys) {
    const ct = CANVAS_TEMPLATES.find((c) => c.key === key);
    if (!ct) continue;
    const canvas = await prisma.canvas.create({ data: { workspaceId: opts.workspaceId, projectId: project.id, title: ct.name, createdById: opts.ownerId, templateKey: key } });
    await seedCanvasFromTemplate(canvas.id, key, opts.ownerId);
  }

  // Milestones
  if (tpl.milestones?.length) {
    await prisma.milestone.createMany({ data: tpl.milestones.map((m) => ({ projectId: project.id, title: m.title, dueDate: addDays(start, m.dueOffsetDays) })) });
  }

  return prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: { boards: { include: { columns: true } } } });
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export async function projectDashboard(projectId: string) {
  const [tasks, members, recentActivity, documents, canvases, meetings, milestones] = await Promise.all([
    prisma.task.findMany({ where: { projectId, deletedAt: null }, select: { id: true, status: true, assigneeId: true, dueDate: true, completedAt: true, title: true, number: true, priority: true } }),
    prisma.projectMember.findMany({ where: { projectId }, include: { user: { select: { id: true, name: true, avatarUrl: true, color: true } } } }),
    prisma.activity.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 15, include: { actor: { select: { id: true, name: true, avatarUrl: true, color: true } } } }),
    prisma.document.findMany({ where: { projectId, deletedAt: null, archivedAt: null }, select: { id: true, title: true, icon: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.canvas.findMany({ where: { projectId, deletedAt: null, archivedAt: null }, select: { id: true, title: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
    prisma.meeting.findMany({ where: { projectId, deletedAt: null }, select: { id: true, title: true, startsAt: true, status: true }, orderBy: { startsAt: "desc" }, take: 10 }),
    prisma.milestone.findMany({ where: { projectId }, orderBy: { dueDate: "asc" } }),
  ]);
  const now = new Date();
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const completed = tasks.filter((t) => t.completedAt).length;
  const overdue = tasks.filter((t) => t.dueDate && !t.completedAt && t.dueDate < now);
  const upcoming = tasks.filter((t) => t.dueDate && !t.completedAt && t.dueDate >= now).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime()).slice(0, 8);
  const workload = members.map((m) => ({
    user: m.user,
    role: m.role,
    open: tasks.filter((t) => t.assigneeId === m.user.id && !t.completedAt).length,
    done: tasks.filter((t) => t.assigneeId === m.user.id && t.completedAt).length,
  }));
  return {
    totals: { tasks: tasks.length, completed, overdue: overdue.length, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    byStatus,
    workload,
    overdueTasks: overdue.slice(0, 8),
    upcomingDeadlines: upcoming,
    recentActivity,
    documents,
    canvases,
    meetings,
    milestones,
  };
}
