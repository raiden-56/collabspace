import { Router } from "express";
import { prisma } from "@collabspace/db";
import { AIChatInput, AIActionDraftInput, AIConfirmActionInput, canvas as canvasLib } from "@collabspace/shared";
import { documentPlainText } from "@collabspace/shared/editor";
import { z } from "zod";
import { h, parseBody, parseQuery, ok, requireParam } from "../lib/http.js";
import { AppError, notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { audit } from "../lib/audit.js";
import { assertAccess, requireWorkspaceRole } from "../services/access.js";
import { assistantChat, confirmAction } from "../services/ai/assistant.js";
import { enqueueActionDrafts } from "../services/ai/jobs.js";
import { aiStatus, AIProviderError } from "../services/ai/provider.js";
import { loadDoc } from "../services/collab.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

function mapAiError(err: unknown): never {
  if (err instanceof AIProviderError) {
    const status = err.code === "disabled" || err.code === "not_configured" ? 503 : err.code === "rate_limited" ? 429 : 502;
    throw new AppError(status, `ai_${err.code}`, err.message);
  }
  throw err;
}

aiRouter.get(
  "/status",
  h(async (_req, res) => {
    ok(res, aiStatus());
  }),
);

aiRouter.post(
  "/chat",
  rateLimit({ name: "ai-chat", windowMs: 60 * 60_000, max: 120 }),
  h(async (req, res) => {
    const input = parseBody(AIChatInput, req.body);
    await requireWorkspaceRole(req.user, input.workspaceId);
    try {
      ok(res, await assistantChat({ user: req.user!, ...input }));
    } catch (err) {
      mapAiError(err);
    }
  }),
);

aiRouter.get(
  "/conversations",
  h(async (req, res) => {
    const q = parseQuery(z.object({ workspaceId: z.string() }), req.query);
    await requireWorkspaceRole(req.user, q.workspaceId);
    ok(res, await prisma.aIConversation.findMany({ where: { userId: req.user!.id, workspaceId: q.workspaceId }, orderBy: { updatedAt: "desc" }, take: 30 }));
  }),
);

aiRouter.get(
  "/conversations/:conversationId",
  h(async (req, res) => {
    const id = requireParam(req, "conversationId");
    const c = await prisma.aIConversation.findFirst({ where: { id, userId: req.user!.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    if (!c) throw notFound("Conversation");
    ok(res, c);
  }),
);

aiRouter.delete(
  "/conversations/:conversationId",
  h(async (req, res) => {
    await prisma.aIConversation.deleteMany({ where: { id: requireParam(req, "conversationId"), userId: req.user!.id } });
    res.status(204).end();
  }),
);

aiRouter.post(
  "/confirm",
  h(async (req, res) => {
    const input = parseBody(AIConfirmActionInput, req.body);
    ok(res, await confirmAction(req.user!, input.messageId, input.actionId, input.approve));
  }),
);

/** Draft action items from text or an accessible resource. Runs as a background job; poll /ai/jobs/:id. */
aiRouter.post(
  "/action-drafts",
  rateLimit({ name: "ai-drafts", windowMs: 60 * 60_000, max: 60 }),
  h(async (req, res) => {
    const input = parseBody(AIActionDraftInput, req.body);
    await requireWorkspaceRole(req.user, input.workspaceId, "MEMBER");
    let text = "";
    let sourceRef: Record<string, unknown> = { kind: input.source.kind };
    if (input.source.kind === "text") text = input.source.text;
    else if (input.source.kind === "meeting") {
      await assertAccess(req.user, "MEETING", input.source.meetingId, "VIEWER");
      const t = await prisma.meetingTranscript.findFirst({ where: { meetingId: input.source.meetingId }, orderBy: { createdAt: "desc" } });
      const m = await prisma.meeting.findUnique({ where: { id: input.source.meetingId }, select: { notesDocumentId: true } });
      const notes = m?.notesDocumentId ? documentPlainText(await loadDoc("document", m.notesDocumentId)) : "";
      text = [t?.content ?? "", notes].filter(Boolean).join("\n\n");
      sourceRef = { kind: "meeting", meetingId: input.source.meetingId };
    } else if (input.source.kind === "document") {
      await assertAccess(req.user, "DOCUMENT", input.source.documentId, "VIEWER");
      text = documentPlainText(await loadDoc("document", input.source.documentId));
      sourceRef = { kind: "document", documentId: input.source.documentId };
    } else if (input.source.kind === "canvas") {
      await assertAccess(req.user, "CANVAS", input.source.canvasId, "VIEWER");
      text = canvasLib.canvasText(canvasLib.serializeCanvas(await loadDoc("canvas", input.source.canvasId)));
      sourceRef = { kind: "canvas", canvasId: input.source.canvasId };
    }
    if (!text.trim()) throw new AppError(400, "empty_source", "There is no text to analyze yet");
    try {
      const job = await enqueueActionDrafts({ workspaceId: input.workspaceId, userId: req.user!.id, text, sourceRef: { ...sourceRef, projectId: input.projectId } });
      await audit({ action: "ai.action_drafts_requested", workspaceId: input.workspaceId, req, metadata: { jobId: job.id, source: sourceRef.kind, chars: text.length } });
      res.status(202).json({ data: { jobId: job.id, status: job.status, ai: aiStatus() } });
    } catch (err) {
      mapAiError(err);
    }
  }),
);

aiRouter.get(
  "/jobs/:jobId",
  h(async (req, res) => {
    const id = requireParam(req, "jobId");
    const job = await prisma.aIJob.findFirst({ where: { id, userId: req.user!.id } });
    if (!job) {
      // Workspace members may read jobs attached to meetings they can access.
      const any = await prisma.aIJob.findUnique({ where: { id }, include: { summary: { select: { meetingId: true } } } });
      if (!any?.summary) throw notFound("Job");
      await assertAccess(req.user, "MEETING", any.summary.meetingId, "VIEWER");
      return ok(res, any);
    }
    ok(res, job);
  }),
);

aiRouter.get(
  "/jobs",
  h(async (req, res) => {
    const q = parseQuery(z.object({ workspaceId: z.string() }), req.query);
    await requireWorkspaceRole(req.user, q.workspaceId);
    ok(res, await prisma.aIJob.findMany({ where: { workspaceId: q.workspaceId, userId: req.user!.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, type: true, status: true, provider: true, model: true, error: true, createdAt: true, finishedAt: true, inputTokens: true, outputTokens: true } }));
  }),
);
