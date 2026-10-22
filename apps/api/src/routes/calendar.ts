import { Router } from "express";
import { prisma } from "@collabspace/db";
import { CalendarEventInput, RescheduleInput } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, parseQuery, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { assertAccess, requireWorkspaceRole, visibleResourceWhere } from "../services/access.js";
import { applyTaskUpdate } from "./tasks.js";
import { findWorkspace } from "./workspaces.js";

export const calendarRouter = Router({ mergeParams: true });
calendarRouter.use(requireAuth);

export interface CalendarItem {
  id: string;
  kind: "task" | "meeting" | "milestone" | "event";
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  projectId?: string | null;
  color?: string | null;
  assigneeId?: string | null;
  href: string;
  meta?: Record<string, unknown>;
}

calendarRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const q = parseQuery(z.object({ from: z.string(), to: z.string(), projectId: z.string().optional(), assigneeId: z.string().optional(), types: z.string().optional() }), req.query);
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw badRequest("Invalid date range");
    const types = new Set((q.types ?? "task,meeting,milestone,event").split(","));
    const projWhere = await visibleResourceWhere(req.user!, ws.id, "PROJECT", role);
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const items: CalendarItem[] = [];

    if (types.has("task")) {
      const tasks = await prisma.task.findMany({
        where: { workspaceId: ws.id, deletedAt: null, archivedAt: null, dueDate: { gte: from, lte: to }, ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.assigneeId ? { assigneeId: q.assigneeId } : {}), project: { deletedAt: null, ...projWhere } },
        include: { project: { select: { key: true, color: true } }, assignee: { select: { id: true, name: true, avatarUrl: true, color: true } } },
      });
      for (const t of tasks) items.push({ id: t.id, kind: "task", title: `${t.project.key}-${t.number} ${t.title}`, start: t.startDate && t.startDate < t.dueDate! ? t.startDate : t.dueDate!, end: t.dueDate, allDay: true, projectId: t.projectId, color: t.project.color, assigneeId: t.assigneeId, href: `/app/${ws.slug}/tasks?task=${t.id}`, meta: { status: t.status, completed: Boolean(t.completedAt), priority: t.priority, assignee: t.assignee } });
    }
    if (types.has("meeting")) {
      const meetings = await prisma.meeting.findMany({
        where: { workspaceId: ws.id, deletedAt: null, startsAt: { gte: from, lte: to }, ...(q.projectId ? { projectId: q.projectId } : {}), ...(isAdmin ? {} : { OR: [{ visibility: "WORKSPACE", ...(role === "GUEST" ? { participants: { some: { userId: req.user!.id } } } : {}) }, { participants: { some: { userId: req.user!.id } } }, { createdById: req.user!.id }] }), ...(q.assigneeId ? { participants: { some: { userId: q.assigneeId } } } : {}) },
        include: { project: { select: { color: true } } },
      });
      for (const m of meetings) items.push({ id: m.id, kind: "meeting", title: m.title, start: m.startsAt, end: new Date(m.startsAt.getTime() + m.durationMin * 60_000), allDay: false, projectId: m.projectId, color: m.project?.color ?? "#9B7BFF", href: `/app/${ws.slug}/meetings/${m.id}`, meta: { status: m.status, durationMin: m.durationMin } });
    }
    if (types.has("milestone")) {
      const milestones = await prisma.milestone.findMany({ where: { dueDate: { gte: from, lte: to }, project: { workspaceId: ws.id, deletedAt: null, ...projWhere, ...(q.projectId ? { id: q.projectId } : {}) } }, include: { project: { select: { id: true, color: true, name: true } } } });
      for (const m of milestones) items.push({ id: m.id, kind: "milestone", title: `◆ ${m.title}`, start: m.dueDate, end: null, allDay: true, projectId: m.projectId, color: m.project.color, href: `/app/${ws.slug}/projects/${m.projectId}`, meta: { completed: Boolean(m.completedAt), project: m.project.name } });
    }
    if (types.has("event")) {
      const events = await prisma.calendarEvent.findMany({ where: { workspaceId: ws.id, startsAt: { lte: to }, endsAt: { gte: from } } });
      for (const e of events) items.push({ id: e.id, kind: "event", title: e.title, start: e.startsAt, end: e.endsAt, allDay: e.allDay, color: "#2FB7D9", href: `/app/${ws.slug}/calendar?event=${e.id}`, meta: { description: e.description } });
    }
    items.sort((a, b) => a.start.getTime() - b.start.getTime());
    ok(res, items);
  }),
);

calendarRouter.post(
  "/events",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const input = parseBody(CalendarEventInput, req.body);
    if (input.endsAt < input.startsAt) throw badRequest("End must be after start");
    created(res, await prisma.calendarEvent.create({ data: { workspaceId: ws.id, title: input.title, description: input.description ?? null, startsAt: input.startsAt, endsAt: input.endsAt, allDay: input.allDay, createdById: req.user!.id } }));
  }),
);

calendarRouter.delete(
  "/events/:eventId",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const e = await prisma.calendarEvent.findFirst({ where: { id: requireParam(req, "eventId"), workspaceId: ws.id } });
    if (!e) throw notFound("Event");
    if (e.createdById !== req.user!.id && role !== "ADMIN" && role !== "OWNER") throw badRequest("Only the creator can delete this event");
    await prisma.calendarEvent.delete({ where: { id: e.id } });
    noContent(res);
  }),
);

/** Drag-to-reschedule with conflict detection (meetings overlapping for shared participants). */
calendarRouter.post(
  "/reschedule",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    await requireWorkspaceRole(req.user, ws.id, "MEMBER");
    const input = parseBody(RescheduleInput, req.body);
    switch (input.kind) {
      case "task": {
        await assertAccess(req.user, "TASK", input.id, "EDITOR");
        const task = await applyTaskUpdate(input.id, { dueDate: input.end ?? input.start ?? null, ...(input.start && input.end ? { startDate: input.start } : {}) }, req.user!);
        return ok(res, { ok: true, item: task });
      }
      case "meeting": {
        await assertAccess(req.user, "MEETING", input.id, "EDITOR");
        if (!input.start) throw badRequest("start is required");
        const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: input.id }, include: { participants: true } });
        const duration = input.end ? Math.max(5, Math.round((input.end.getTime() - input.start.getTime()) / 60_000)) : meeting.durationMin;
        const end = new Date(input.start.getTime() + duration * 60_000);
        const participantIds = meeting.participants.map((p) => p.userId);
        const conflicts = await prisma.meeting.findMany({
          where: { id: { not: meeting.id }, workspaceId: ws.id, deletedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, startsAt: { lt: end }, participants: { some: { userId: { in: participantIds } } } },
          select: { id: true, title: true, startsAt: true, durationMin: true, participants: { select: { userId: true } } },
        });
        const real = conflicts.filter((c) => new Date(c.startsAt.getTime() + c.durationMin * 60_000) > input.start!);
        if (real.length && !input.confirmConflicts) {
          res.status(409).json({ error: { code: "conflict", message: "This time overlaps with another meeting for some participants", details: { conflicts: real.map((c) => ({ id: c.id, title: c.title, startsAt: c.startsAt, overlappingParticipants: c.participants.filter((p) => participantIds.includes(p.userId)).length })) } } });
          return;
        }
        const updated = await prisma.meeting.update({ where: { id: input.id }, data: { startsAt: input.start, durationMin: duration } });
        return ok(res, { ok: true, item: updated });
      }
      case "milestone": {
        const m = await prisma.milestone.findUnique({ where: { id: input.id } });
        if (!m) throw notFound("Milestone");
        await assertAccess(req.user, "PROJECT", m.projectId, "EDITOR");
        if (!input.start) throw badRequest("start is required");
        return ok(res, { ok: true, item: await prisma.milestone.update({ where: { id: m.id }, data: { dueDate: input.start } }) });
      }
      case "event": {
        const e = await prisma.calendarEvent.findFirst({ where: { id: input.id, workspaceId: ws.id } });
        if (!e) throw notFound("Event");
        if (!input.start) throw badRequest("start is required");
        const length = e.endsAt.getTime() - e.startsAt.getTime();
        return ok(res, { ok: true, item: await prisma.calendarEvent.update({ where: { id: e.id }, data: { startsAt: input.start, endsAt: input.end ?? new Date(input.start.getTime() + length) } }) });
      }
    }
  }),
);
