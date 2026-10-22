import { prisma, type AIJob, type Prisma } from "@collabspace/db";
import { ch } from "@collabspace/shared";
import { config } from "../../config.js";
import { logger } from "../../lib/logger.js";
import { emit } from "../../lib/realtime.js";
import { notify } from "../../lib/notify.js";
import { aiProvider, AIProviderError, parseJson } from "./provider.js";
import { loadDoc } from "../collab.js";
import { documentPlainText } from "@collabspace/shared/editor";

/**
 * Background job queue for AI work, persisted in the AIJob table.
 * A single in-process worker polls for QUEUED jobs (multi-instance safe via an atomic claim),
 * retries transient provider failures with backoff and emits realtime status events.
 * Swap `startJobWorker` for a BullMQ worker if Redis-backed scheduling is preferred — the job
 * handlers below are queue-agnostic.
 */

export const MAX_ATTEMPTS = 3;
const POLL_MS = 1500;
let timer: NodeJS.Timeout | null = null;
let running = false;

export interface MeetingSummaryContent {
  recap: string;
  topics: Array<{ title: string; points: string[] }>;
  decisions: Array<{ text: string; excerpt?: string }>;
  openQuestions: Array<{ text: string; excerpt?: string }>;
  actionItems: Array<{ text: string; suggestedOwner: string | null; suggestedDue: string | null; excerpt?: string }>;
  participants?: string[];
  generatedBy: string;
}

export async function enqueueMeetingSummary(input: { meetingId: string; transcriptId: string; userId: string; workspaceId: string; includeNotes: boolean }) {
  const provider = aiProvider();
  if (provider.name === "disabled") throw new AIProviderError("AI features are disabled on this server.", "disabled");
  const job = await prisma.aIJob.create({
    data: { workspaceId: input.workspaceId, userId: input.userId, type: "MEETING_SUMMARY", provider: provider.name, model: config.AI_MODEL, input: input as unknown as Prisma.InputJsonObject },
  });
  const summary = await prisma.meetingSummary.create({ data: { meetingId: input.meetingId, transcriptId: input.transcriptId, status: "PENDING", aiJobId: job.id, model: provider.name === "mock" ? "mock-v1" : config.AI_MODEL } });
  emit([ch.resource("MEETING", input.meetingId)], { t: "ai:job", p: { jobId: job.id, status: "QUEUED", type: "MEETING_SUMMARY", meetingId: input.meetingId } });
  kick();
  return { job, summary };
}

export async function enqueueActionDrafts(input: { workspaceId: string; userId: string; text: string; sourceRef: Record<string, unknown> }) {
  const provider = aiProvider();
  if (provider.name === "disabled") throw new AIProviderError("AI features are disabled on this server.", "disabled");
  const job = await prisma.aIJob.create({
    data: { workspaceId: input.workspaceId, userId: input.userId, type: "ACTION_DRAFTS", provider: provider.name, model: config.AI_MODEL, input: { text: input.text.slice(0, config.AI_MAX_INPUT_CHARS), sourceRef: input.sourceRef } as Prisma.InputJsonObject },
  });
  kick();
  return job;
}

function kick() {
  if (!running) return;
  setTimeout(() => void tick(), 10);
}

export function startJobWorker(): void {
  if (running) return;
  running = true;
  timer = setInterval(() => void tick(), POLL_MS);
  timer.unref();
  logger.info("AI job worker started");
}

export function stopJobWorker(): void {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

let busy = false;
async function tick(): Promise<void> {
  if (busy || !running) return;
  busy = true;
  try {
    // Atomic claim: only one worker instance wins a given job.
    const candidate = await prisma.aIJob.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" } });
    if (!candidate) return;
    const claimed = await prisma.aIJob.updateMany({ where: { id: candidate.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } } });
    if (claimed.count === 0) return;
    const job = await prisma.aIJob.findUniqueOrThrow({ where: { id: candidate.id } });
    await processJob(job);
  } catch (err) {
    logger.error({ err }, "job worker tick failed");
  } finally {
    busy = false;
  }
}

export async function processJob(job: AIJob): Promise<void> {
  emit([ch.user(job.userId)], { t: "ai:job", p: { jobId: job.id, status: "RUNNING", type: job.type } });
  try {
    let output: unknown;
    let usage: { inputTokens?: number; outputTokens?: number; model?: string } = {};
    if (job.type === "MEETING_SUMMARY") {
      const r = await runMeetingSummary(job);
      output = r.content;
      usage = r.usage;
    } else if (job.type === "ACTION_DRAFTS") {
      const r = await runActionDrafts(job);
      output = r.content;
      usage = r.usage;
    } else {
      throw new AIProviderError(`Unsupported job type ${job.type}`, "provider_error");
    }
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: "COMPLETED", output: output as Prisma.InputJsonValue, finishedAt: new Date(), inputTokens: usage.inputTokens ?? null, outputTokens: usage.outputTokens ?? null, model: usage.model ?? job.model } });
    emit([ch.user(job.userId)], { t: "ai:job", p: { jobId: job.id, status: "COMPLETED", type: job.type, meetingId: (job.input as { meetingId?: string }).meetingId } });
  } catch (err) {
    const e = err as AIProviderError;
    const retry = Boolean(e.retryable) && job.attempts < MAX_ATTEMPTS;
    logger.warn({ err: e.message, jobId: job.id, retry }, "AI job failed");
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: retry ? "QUEUED" : "FAILED", error: e.message, finishedAt: retry ? null : new Date() } });
    if (!retry && job.type === "MEETING_SUMMARY") {
      await prisma.meetingSummary.updateMany({ where: { aiJobId: job.id }, data: { status: "FAILED", error: e.message } });
      const meetingId = (job.input as { meetingId: string }).meetingId;
      emit([ch.resource("MEETING", meetingId), ch.user(job.userId)], { t: "ai:job", p: { jobId: job.id, status: "FAILED", type: job.type, meetingId } });
    } else if (!retry) {
      emit([ch.user(job.userId)], { t: "ai:job", p: { jobId: job.id, status: "FAILED", type: job.type } });
    } else {
      // backoff before the next tick picks it up again
      await new Promise((r) => setTimeout(r, 1000 * job.attempts));
    }
  }
}

const SUMMARY_SYSTEM = `You are CollabSpace's meeting assistant. You produce faithful, concise summaries of meeting transcripts and notes.
Rules:
- Never invent decisions, owners, deadlines or facts that are not supported by the source. If an owner or deadline is not stated, use null.
- Every decision, open question and action item must include a short verbatim "excerpt" from the source that supports it.
- Group discussion points by topic. Keep the recap under 120 words.
- Output JSON with keys: recap (string), topics ([{title, points[]}]), decisions ([{text, excerpt}]), openQuestions ([{text, excerpt}]), actionItems ([{text, suggestedOwner|null, suggestedDue|null, excerpt}]), participants (string[]).`;

async function runMeetingSummary(job: AIJob) {
  const input = job.input as { meetingId: string; transcriptId: string; includeNotes: boolean };
  await prisma.meetingSummary.updateMany({ where: { aiJobId: job.id }, data: { status: "RUNNING" } });
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: input.meetingId }, include: { transcripts: { where: { id: input.transcriptId } }, participants: { include: { user: { select: { name: true } } } }, workspace: { select: { slug: true } } } });
  const transcript = meeting.transcripts[0];
  if (!transcript) throw new AIProviderError("Transcript not found", "provider_error");
  let notes = "";
  if (input.includeNotes && meeting.notesDocumentId) {
    const doc = await loadDoc("document", meeting.notesDocumentId);
    notes = documentPlainText(doc);
  }
  const agenda = Array.isArray(meeting.agenda) ? (meeting.agenda as Array<{ title: string }>).map((a) => `- ${a.title}`).join("\n") : "";
  const source = [transcript.content, notes ? `\n--- Collaborative notes ---\n${notes}` : ""].join("").slice(0, config.AI_MAX_INPUT_CHARS);
  const prompt = `TASK: meeting_summary\nMeeting: ${meeting.title}\nDate: ${meeting.startsAt.toISOString()}\nParticipants: ${meeting.participants.map((p) => p.user.name).join(", ") || "unknown"}\nAgenda:\n${agenda || "(none)"}\n\n<source>\n${source}\n</source>`;
  const result = await aiProvider().complete({ system: SUMMARY_SYSTEM, prompt, json: true, maxTokens: 3000 });
  const content = normalizeSummary(parseJson<Partial<MeetingSummaryContent>>(result.text), result.provider);

  await prisma.$transaction(async (tx) => {
    await tx.meetingSummary.updateMany({ where: { aiJobId: job.id }, data: { status: "COMPLETED", content: content as unknown as Prisma.InputJsonObject, model: result.model } });
    // Draft action items for review (never auto-created as tasks).
    for (const item of content.actionItems) {
      await tx.meetingActionItem.create({
        data: { meetingId: meeting.id, text: item.text, suggestedOwner: item.suggestedOwner, suggestedDue: parseRelativeDue(item.suggestedDue, meeting.startsAt), excerpt: item.excerpt ?? null, status: "DRAFT", source: `ai:${result.provider}` },
      });
    }
    for (const d of content.decisions) {
      await tx.meetingDecision.create({ data: { meetingId: meeting.id, text: d.text, source: `ai:${result.provider}` } });
    }
  });
  emit([ch.resource("MEETING", meeting.id)], { t: "meeting:updated", p: { meetingId: meeting.id, action: "summary" } });
  const recipients = new Set([meeting.createdById, ...meeting.participants.map((p) => p.userId)]);
  for (const uid of recipients) {
    await notify({ userId: uid, type: "MEETING_SUMMARY", title: `Summary ready: ${meeting.title}`, body: content.recap.slice(0, 160), href: `/app/${meeting.workspace.slug}/meetings/${meeting.id}`, workspaceId: meeting.workspaceId, resourceType: "MEETING", resourceId: meeting.id, actorId: uid === job.userId ? null : job.userId, email: true });
  }
  return { content, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: result.model } };
}

const ACTIONS_SYSTEM = `You extract action items from meeting notes, documents or brainstorming text.
Rules: only include items clearly implied by the text; never invent owners or deadlines (use null when unstated); include a verbatim excerpt for each. Output JSON: {"actionItems":[{text, suggestedOwner|null, suggestedDue|null, excerpt}]}.`;

async function runActionDrafts(job: AIJob) {
  const input = job.input as { text: string; sourceRef: Record<string, unknown> };
  const prompt = `TASK: action_drafts\n<source>\n${input.text}\n</source>`;
  const result = await aiProvider().complete({ system: ACTIONS_SYSTEM, prompt, json: true, maxTokens: 2000 });
  const parsed = parseJson<{ actionItems?: MeetingSummaryContent["actionItems"] }>(result.text);
  const items = (parsed.actionItems ?? []).filter((a) => a && typeof a.text === "string").slice(0, 30).map((a) => ({ text: String(a.text).slice(0, 500), suggestedOwner: a.suggestedOwner ?? null, suggestedDue: a.suggestedDue ?? null, excerpt: a.excerpt ?? null }));
  return { content: { actionItems: items, generatedBy: result.provider, sourceRef: input.sourceRef }, usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens, model: result.model } };
}

export function normalizeSummary(raw: Partial<MeetingSummaryContent>, provider: string): MeetingSummaryContent {
  const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    recap: str(raw.recap, 2000) || "No recap generated.",
    topics: Array.isArray(raw.topics) ? raw.topics.slice(0, 12).map((t) => ({ title: str(t?.title, 120) || "Topic", points: Array.isArray(t?.points) ? t.points.map((p) => str(p, 300)).filter(Boolean).slice(0, 10) : [] })) : [],
    decisions: Array.isArray(raw.decisions) ? raw.decisions.slice(0, 20).map((d) => ({ text: str(d?.text), excerpt: str(d?.excerpt) || undefined })).filter((d) => d.text) : [],
    openQuestions: Array.isArray(raw.openQuestions) ? raw.openQuestions.slice(0, 20).map((d) => ({ text: str(d?.text), excerpt: str(d?.excerpt) || undefined })).filter((d) => d.text) : [],
    actionItems: Array.isArray(raw.actionItems)
      ? raw.actionItems.slice(0, 30).map((a) => ({ text: str(a?.text), suggestedOwner: a?.suggestedOwner ? str(a.suggestedOwner, 120) : null, suggestedDue: a?.suggestedDue ? str(a.suggestedDue, 60) : null, excerpt: str(a?.excerpt) || undefined })).filter((a) => a.text)
      : [],
    participants: Array.isArray(raw.participants) ? raw.participants.map((p) => str(p, 80)).filter(Boolean) : [],
    generatedBy: provider,
  };
}

/** Turn "friday" / "next week" / ISO strings into a date relative to the meeting, or null. */
export function parseRelativeDue(value: string | null | undefined, from: Date): Date | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const iso = Date.parse(value);
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(value)) return new Date(iso);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = days.indexOf(v);
  const d = new Date(from);
  if (idx >= 0) {
    const diff = (idx - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  }
  if (v === "tomorrow") {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (v === "next week") {
    d.setDate(d.getDate() + 7);
    return d;
  }
  if (v === "eod" || v === "today") return d;
  return null;
}
