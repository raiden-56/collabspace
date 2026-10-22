import { Router } from "express";
import { prisma, type Prisma } from "@collabspace/db";
import { CreateMeetingInput, UpdateMeetingInput, TranscriptInput, SummarizeInput, ActionItemInput, ConvertActionItemsInput, DecisionInput, ch } from "@collabspace/shared";
import { z } from "zod";
import { h, parseBody, ok, created, noContent, requireParam } from "../lib/http.js";
import { badRequest, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { recordActivity } from "../lib/activity.js";
import { notify, notifyMany } from "../lib/notify.js";
import { emit } from "../lib/realtime.js";
import { audit } from "../lib/audit.js";
import { rateLimit } from "../lib/rateLimit.js";
import { assertAccess, requireWorkspaceRole } from "../services/access.js";
import { seedDocumentContent } from "../services/collab.js";
import { enqueueMeetingSummary } from "../services/ai/jobs.js";
import { aiStatus } from "../services/ai/provider.js";
import { runAutomations } from "../services/automation.js";
import { nextTaskNumber } from "../services/projects.js";
import { shapeTask, taskInclude } from "./tasks.js";
import { findWorkspace } from "./workspaces.js";

export const meetingsRouter = Router();
export const workspaceMeetingsRouter = Router({ mergeParams: true });
meetingsRouter.use(requireAuth);
workspaceMeetingsRouter.use(requireAuth);

const meetingInclude = {
  facilitator: { select: { id: true, name: true, avatarUrl: true, color: true } },
  createdBy: { select: { id: true, name: true, avatarUrl: true, color: true } },
  participants: { include: { user: { select: { id: true, name: true, avatarUrl: true, color: true, email: true } } } },
  project: { select: { id: true, name: true, key: true, color: true } },
  notesDocument: { select: { id: true, title: true } },
  _count: { select: { transcripts: true, actionItems: true, decisions: true } },
} satisfies Prisma.MeetingInclude;

workspaceMeetingsRouter.get(
  "/",
  h(async (req, res) => {
    const ws = await findWorkspace(requireParam(req, "workspaceId"));
    const role = await requireWorkspaceRole(req.user, ws.id);
    const isAdmin = role === "OWNER" || role === "ADMIN";
    const rows = await prisma.meeting.findMany({
      where: { workspaceId: ws.id, deletedAt: null, ...(isAdmin ? {} : { OR: [{ visibility: "WORKSPACE", ...(role === "GUEST" ? { participants: { some: { userId: req.user!.id } } } : {}) }, { participants: { some: { userId: req.user!.id } } }, { createdById: req.user!.id }] }), ...(req.query.projectId ? { projectId: String(req.query.projectId) } : {}) },
      orderBy: { startsAt: "desc" },
      take: 200,
      include: meetingInclude,
    });
    ok(res, rows);
  }),
);

meetingsRouter.post(
  "/",
  h(async (req, res) => {
    const input = parseBody(CreateMeetingInput, req.body);
    await requireWorkspaceRole(req.user, input.workspaceId, "MEMBER");
    if (input.projectId) await assertAccess(req.user, "PROJECT", input.projectId, "EDITOR");
    const participantIds = new Set([req.user!.id, ...(input.participantIds ?? []), ...(input.facilitatorId ? [input.facilitatorId] : [])]);
    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: input.workspaceId, userId: { in: [...participantIds] } }, select: { userId: true } });
    const validIds = new Set(members.map((m) => m.userId));
    const notes = await prisma.document.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId ?? null, title: `${input.title} — notes`, icon: "📝", createdById: req.user!.id, visibility: input.visibility } });
    await seedDocumentContent(notes.id, {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: input.title }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Notes" }] },
        { type: "paragraph" },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Decisions" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Action items" }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] },
      ],
    });
    const meeting = await prisma.meeting.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        title: input.title,
        description: input.description ?? null,
        startsAt: input.startsAt,
        durationMin: input.durationMin,
        facilitatorId: input.facilitatorId && validIds.has(input.facilitatorId) ? input.facilitatorId : req.user!.id,
        createdById: req.user!.id,
        notesDocumentId: notes.id,
        agenda: (input.agenda ?? []) as Prisma.InputJsonValue,
        visibility: input.visibility,
        linkedCanvasIds: input.linkedCanvasIds ?? [],
        linkedDocumentIds: input.linkedDocumentIds ?? [],
        participants: { create: [...validIds].map((userId) => ({ userId, status: userId === req.user!.id ? "ACCEPTED" : "INVITED" })) },
      },
      include: meetingInclude,
    });
    const ws = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { slug: true } });
    await notifyMany([...validIds].filter((u) => u !== req.user!.id), { type: "MEETING_INVITE", title: `${req.user!.name} invited you to "${meeting.title}"`, body: meeting.startsAt.toUTCString(), href: `/app/${ws?.slug}/meetings/${meeting.id}`, actorId: req.user!.id, workspaceId: input.workspaceId, resourceType: "MEETING", resourceId: meeting.id, email: true });
    await recordActivity({ workspaceId: input.workspaceId, projectId: meeting.projectId, actorId: req.user!.id, type: "meeting.created", resourceType: "MEETING", resourceId: meeting.id, resourceTitle: meeting.title });
    created(res, meeting);
  }),
);

meetingsRouter.get(
  "/:meetingId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    const { access } = await assertAccess(req.user, "MEETING", id, "VIEWER");
    const meeting = await prisma.meeting.findUniqueOrThrow({
      where: { id },
      include: {
        ...meetingInclude,
        transcripts: { orderBy: { createdAt: "desc" }, select: { id: true, source: true, language: true, createdAt: true, createdById: true, content: true } },
        summaries: { orderBy: { createdAt: "desc" }, take: 5, include: { aiJob: { select: { id: true, status: true, error: true, attempts: true } } } },
        decisions: { orderBy: { createdAt: "asc" } },
        actionItems: { orderBy: { createdAt: "asc" }, include: { task: { select: { id: true, title: true, status: true, number: true, project: { select: { key: true } } } } } },
        workspace: { select: { id: true, slug: true, name: true } },
      },
    });
    const [canvases, documents, history] = await Promise.all([
      meeting.linkedCanvasIds.length ? prisma.canvas.findMany({ where: { id: { in: meeting.linkedCanvasIds }, deletedAt: null }, select: { id: true, title: true } }) : [],
      meeting.linkedDocumentIds.length ? prisma.document.findMany({ where: { id: { in: meeting.linkedDocumentIds }, deletedAt: null }, select: { id: true, title: true, icon: true } }) : [],
      prisma.meeting.findMany({ where: { workspaceId: meeting.workspaceId, deletedAt: null, id: { not: id }, OR: [{ title: meeting.title }, ...(meeting.projectId ? [{ projectId: meeting.projectId }] : [])] }, orderBy: { startsAt: "desc" }, take: 8, select: { id: true, title: true, startsAt: true, status: true } }),
    ]);
    if (req.user) void prisma.recentItem.upsert({ where: { userId_resourceType_resourceId: { userId: req.user.id, resourceType: "MEETING", resourceId: id } }, update: { openedAt: new Date() }, create: { userId: req.user.id, resourceType: "MEETING", resourceId: id, workspaceId: meeting.workspaceId } }).catch(() => {});
    ok(res, { ...meeting, transcripts: meeting.transcripts.map((t) => ({ ...t, preview: t.content.slice(0, 400), length: t.content.length })), linked: { canvases, documents }, history, access, ai: aiStatus() });
  }),
);

meetingsRouter.get(
  "/:meetingId/transcripts/:transcriptId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "VIEWER");
    const t = await prisma.meetingTranscript.findFirst({ where: { id: requireParam(req, "transcriptId"), meetingId: id } });
    if (!t) throw notFound("Transcript");
    ok(res, t);
  }),
);

meetingsRouter.patch(
  "/:meetingId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    const { resource } = await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(UpdateMeetingInput, req.body);
    const before = await prisma.meeting.findUniqueOrThrow({ where: { id }, select: { status: true, title: true } });
    const meeting = await prisma.$transaction(async (tx) => {
      if (input.participantIds) {
        const members = await tx.workspaceMember.findMany({ where: { workspaceId: resource.workspaceId, userId: { in: input.participantIds } }, select: { userId: true } });
        const valid = members.map((m) => m.userId);
        await tx.meetingParticipant.deleteMany({ where: { meetingId: id, userId: { notIn: [...valid, resource.ownerId ?? ""] } } });
        for (const userId of valid) await tx.meetingParticipant.upsert({ where: { meetingId_userId: { meetingId: id, userId } }, update: {}, create: { meetingId: id, userId } });
      }
      return tx.meeting.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description,
          startsAt: input.startsAt,
          durationMin: input.durationMin,
          facilitatorId: input.facilitatorId,
          projectId: input.projectId,
          agenda: input.agenda as Prisma.InputJsonValue | undefined,
          visibility: input.visibility,
          linkedCanvasIds: input.linkedCanvasIds,
          linkedDocumentIds: input.linkedDocumentIds,
          status: input.status,
          endedAt: input.status === "COMPLETED" ? new Date() : undefined,
        },
        include: meetingInclude,
      });
    });
    if (input.title && meeting.notesDocumentId) await prisma.document.update({ where: { id: meeting.notesDocumentId }, data: { title: `${input.title} — notes` } });
    if (input.participantIds) {
      const ws = await prisma.workspace.findUnique({ where: { id: resource.workspaceId }, select: { slug: true } });
      const newOnes = meeting.participants.filter((p) => p.status === "INVITED" && p.userId !== req.user!.id).map((p) => p.userId);
      await notifyMany(newOnes, { type: "MEETING_INVITE", title: `You were invited to "${meeting.title}"`, href: `/app/${ws?.slug}/meetings/${id}`, actorId: req.user!.id, workspaceId: resource.workspaceId, resourceType: "MEETING", resourceId: id, groupKey: `meeting-invite:${id}` });
    }
    emit([ch.resource("MEETING", id)], { t: "meeting:updated", p: { meetingId: id, action: "updated" } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: meeting.projectId, actorId: req.user!.id, type: input.status && input.status !== before.status ? "meeting.status_changed" : "meeting.updated", resourceType: "MEETING", resourceId: id, resourceTitle: meeting.title, payload: { status: input.status } });
    if (input.status === "COMPLETED" && before.status !== "COMPLETED") {
      await runAutomations({ workspaceId: resource.workspaceId, trigger: "meeting.ended", actorId: req.user!.id, meeting: { id, title: meeting.title, createdById: meeting.createdById, projectId: meeting.projectId } });
    }
    ok(res, meeting);
  }),
);

meetingsRouter.delete(
  "/:meetingId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    const { resource } = await assertAccess(req.user, "MEETING", id, "EDITOR");
    await prisma.meeting.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "meeting.deleted", resourceType: "MEETING", resourceId: id, resourceTitle: resource.title });
    noContent(res);
  }),
);

meetingsRouter.post(
  "/:meetingId/rsvp",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "VIEWER");
    const { status } = parseBody(z.object({ status: z.enum(["ACCEPTED", "DECLINED", "TENTATIVE"]) }), req.body);
    const p = await prisma.meetingParticipant.upsert({ where: { meetingId_userId: { meetingId: id, userId: req.user!.id } }, update: { status }, create: { meetingId: id, userId: req.user!.id, status } });
    emit([ch.resource("MEETING", id)], { t: "meeting:updated", p: { meetingId: id, action: "rsvp" } });
    ok(res, p);
  }),
);

// ---- Transcripts & AI summary --------------------------------------------------

meetingsRouter.post(
  "/:meetingId/transcripts",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    const { resource } = await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(TranscriptInput, req.body);
    const t = await prisma.meetingTranscript.create({ data: { meetingId: id, content: input.content, source: input.source, language: input.language ?? null, createdById: req.user!.id } });
    await audit({ action: "meeting.transcript_added", workspaceId: resource.workspaceId, req, resourceType: "MEETING", resourceId: id, metadata: { source: input.source, chars: input.content.length } });
    emit([ch.resource("MEETING", id)], { t: "meeting:updated", p: { meetingId: id, action: "transcript" } });
    created(res, { ...t, preview: t.content.slice(0, 400), length: t.content.length });
  }),
);

meetingsRouter.post(
  "/:meetingId/summarize",
  rateLimit({ name: "ai-summarize", windowMs: 60 * 60_000, max: 30 }),
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    const { resource } = await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(SummarizeInput, req.body);
    const transcript = input.transcriptId
      ? await prisma.meetingTranscript.findFirst({ where: { id: input.transcriptId, meetingId: id } })
      : await prisma.meetingTranscript.findFirst({ where: { meetingId: id }, orderBy: { createdAt: "desc" } });
    if (!transcript) throw badRequest("Add a transcript or paste meeting notes before generating a summary");
    const inFlight = await prisma.meetingSummary.findFirst({ where: { meetingId: id, status: { in: ["PENDING", "RUNNING"] } } });
    if (inFlight) throw badRequest("A summary is already being generated for this meeting");
    const { job, summary } = await enqueueMeetingSummary({ meetingId: id, transcriptId: transcript.id, userId: req.user!.id, workspaceId: resource.workspaceId, includeNotes: input.includeNotes });
    await audit({ action: "ai.meeting_summary_requested", workspaceId: resource.workspaceId, req, resourceType: "MEETING", resourceId: id, metadata: { jobId: job.id, provider: job.provider } });
    res.status(202).json({ data: { jobId: job.id, summaryId: summary.id, status: "QUEUED", ai: aiStatus() } });
  }),
);

meetingsRouter.patch(
  "/:meetingId/summaries/:summaryId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(z.object({ editedContent: z.record(z.string(), z.unknown()) }), req.body);
    const s = await prisma.meetingSummary.findFirst({ where: { id: requireParam(req, "summaryId"), meetingId: id } });
    if (!s) throw notFound("Summary");
    ok(res, await prisma.meetingSummary.update({ where: { id: s.id }, data: { editedContent: input.editedContent as Prisma.InputJsonObject } }));
  }),
);

// ---- Decisions & action items -------------------------------------------------

meetingsRouter.post(
  "/:meetingId/decisions",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(DecisionInput, req.body);
    const d = await prisma.meetingDecision.create({ data: { meetingId: id, text: input.text } });
    emit([ch.resource("MEETING", id)], { t: "meeting:updated", p: { meetingId: id, action: "decision" } });
    created(res, d);
  }),
);

meetingsRouter.delete(
  "/:meetingId/decisions/:decisionId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "EDITOR");
    await prisma.meetingDecision.deleteMany({ where: { id: requireParam(req, "decisionId"), meetingId: id } });
    noContent(res);
  }),
);

meetingsRouter.post(
  "/:meetingId/action-items",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(ActionItemInput, req.body);
    const item = await prisma.meetingActionItem.create({ data: { meetingId: id, text: input.text, suggestedOwner: input.suggestedOwner ?? null, suggestedDue: input.suggestedDue ?? null, excerpt: input.excerpt ?? null, source: "manual", status: "APPROVED" } });
    emit([ch.resource("MEETING", id)], { t: "meeting:updated", p: { meetingId: id, action: "action-item" } });
    created(res, item);
  }),
);

meetingsRouter.patch(
  "/:meetingId/action-items/:itemId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(ActionItemInput.partial().extend({ status: z.enum(["DRAFT", "APPROVED", "REJECTED"]).optional() }), req.body);
    const item = await prisma.meetingActionItem.findFirst({ where: { id: requireParam(req, "itemId"), meetingId: id } });
    if (!item) throw notFound("Action item");
    const updated = await prisma.meetingActionItem.update({ where: { id: item.id }, data: { text: input.text, suggestedOwner: input.suggestedOwner, suggestedDue: input.suggestedDue, status: input.status } });
    emit([ch.resource("MEETING", id)], { t: "meeting:updated", p: { meetingId: id, action: "action-item" } });
    ok(res, updated);
  }),
);

meetingsRouter.delete(
  "/:meetingId/action-items/:itemId",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    await assertAccess(req.user, "MEETING", id, "EDITOR");
    await prisma.meetingActionItem.deleteMany({ where: { id: requireParam(req, "itemId"), meetingId: id } });
    noContent(res);
  }),
);

/** Convert reviewed action items into real tasks (explicit user approval step). */
meetingsRouter.post(
  "/:meetingId/action-items/convert",
  h(async (req, res) => {
    const id = requireParam(req, "meetingId");
    const { resource } = await assertAccess(req.user, "MEETING", id, "EDITOR");
    const input = parseBody(ConvertActionItemsInput, req.body);
    const ws = await prisma.workspace.findUnique({ where: { id: resource.workspaceId }, select: { slug: true } });
    const results: Array<{ itemId: string; task: Record<string, unknown> }> = [];
    for (const it of input.items) {
      await assertAccess(req.user, "PROJECT", it.projectId, "EDITOR");
      const item = await prisma.meetingActionItem.findFirst({ where: { id: it.id, meetingId: id } });
      if (!item || item.status === "CONVERTED") continue;
      const board = await prisma.board.findFirst({ where: { projectId: it.projectId, isDefault: true }, include: { columns: { orderBy: { position: "asc" } } } });
      const task = await prisma.$transaction(async (tx) => {
        const number = await nextTaskNumber(tx, it.projectId);
        const t = await tx.task.create({
          data: {
            workspaceId: resource.workspaceId,
            projectId: it.projectId,
            number,
            title: it.title,
            description: `From meeting "${resource.title}"${item.excerpt ? `:\n\n> ${item.excerpt}` : ""}`,
            status: board?.columns[0]?.statusKey ?? "todo",
            reporterId: req.user!.id,
            assigneeId: it.assigneeId ?? null,
            dueDate: it.dueDate ?? item.suggestedDue ?? null,
            position: Date.now(),
            sourceType: "meeting-action",
            sourceId: item.id,
            sourceMeta: { meetingId: id, meetingTitle: resource.title, excerpt: item.excerpt },
            activities: { create: { actorId: req.user!.id, type: "created", payload: { from: "meeting-action", meetingId: id } } },
          },
          include: taskInclude,
        });
        await tx.meetingActionItem.update({ where: { id: item.id }, data: { status: "CONVERTED", taskId: t.id } });
        return t;
      });
      const shaped = shapeTask(task);
      results.push({ itemId: item.id, task: shaped });
      emit([ch.project(it.projectId), ch.workspace(resource.workspaceId)], { t: "task:updated", p: { workspaceId: resource.workspaceId, projectId: it.projectId, taskId: task.id, action: "created", task: shaped as unknown as Record<string, unknown>, actorId: req.user!.id } });
      if (task.assigneeId) {
        await notify({ userId: task.assigneeId, type: "TASK_ASSIGNED", title: `You were assigned ${shaped.key}`, body: task.title, href: `/app/${ws?.slug}/tasks?task=${task.id}`, actorId: req.user!.id, workspaceId: resource.workspaceId, resourceType: "TASK", resourceId: task.id, email: true });
      }
    }
    await recordActivity({ workspaceId: resource.workspaceId, projectId: resource.projectId, actorId: req.user!.id, type: "meeting.actions_converted", resourceType: "MEETING", resourceId: id, resourceTitle: resource.title, payload: { count: results.length } });
    await audit({ action: "ai.action_items_converted", workspaceId: resource.workspaceId, req, resourceType: "MEETING", resourceId: id, metadata: { count: results.length } });
    emit([ch.resource("MEETING", id)], { t: "meeting:updated", p: { meetingId: id, action: "action-item" } });
    ok(res, results);
  }),
);
