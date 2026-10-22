import { prisma, type Prisma, type ResourceType } from "@collabspace/db";
import { canvas as canvasLib, isOverdue } from "@collabspace/shared";
import { documentPlainText } from "@collabspace/shared/editor";
import { config } from "../../config.js";
import { aiProvider, AIProviderError, parseJson } from "./provider.js";
import { assertAccess, resolveAccess, visibleResourceWhere, workspaceRole } from "../access.js";
import { loadDoc } from "../collab.js";
import { accessAtLeast } from "@collabspace/shared";
import { forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";

/**
 * Contextual workspace assistant.
 * Context is built from records the *requesting user* is allowed to see (same access checks as the
 * REST API), so AI retrieval can never expose private resources. Consequential actions (create tasks)
 * are returned as proposals that the user must confirm.
 */

export interface ProposedAction {
  id: string;
  type: "create_task";
  status: "proposed" | "approved" | "rejected" | "done";
  payload: { title: string; projectId: string; description?: string; dueDate?: string | null };
  resultTaskId?: string;
}

const SYSTEM = `You are the CollabSpace workspace assistant. Answer using ONLY the context provided; it already reflects what the user may access.
Rules:
- Never fabricate task statuses, owners, deadlines or decisions. If the context lacks the information, say so.
- Be concise and concrete; reference tasks by their key (e.g. PRJ-12) and resources by title.
- If the user asks you to create tasks, do not create them: return them in proposedActions for confirmation.
- Output JSON: {"answer": string (markdown), "proposedActions": [{"type":"create_task","title":string,"projectId":string,"description"?:string,"dueDate"?:string|null}], "sources": string[] (titles you relied on)}.`;

export interface ChatInput {
  user: Express.AuthUser;
  workspaceId: string;
  conversationId?: string;
  message: string;
  context?: { resourceType: ResourceType; resourceId: string };
  projectId?: string;
}

export async function buildContext(user: Express.AuthUser, workspaceId: string, opts: { context?: { resourceType: ResourceType; resourceId: string }; projectId?: string; budget?: number }) {
  const budget = opts.budget ?? Math.min(config.AI_MAX_INPUT_CHARS, 40_000);
  const role = await workspaceRole(user.id, workspaceId);
  if (!role && user.platformRole !== "ADMIN") throw forbidden();
  const lines: string[] = [];
  const sources: string[] = [];
  const push = (s: string) => {
    if (lines.join("\n").length + s.length < budget) lines.push(s);
  };

  // Focused resource
  if (opts.context) {
    const { resource } = await assertAccess(user, opts.context.resourceType, opts.context.resourceId, "VIEWER");
    sources.push(resource.title);
    if (opts.context.resourceType === "DOCUMENT") {
      const doc = await loadDoc("document", resource.id);
      push(`DOCUMENT "${resource.title}":\n${documentPlainText(doc).slice(0, 12_000)}`);
    } else if (opts.context.resourceType === "CANVAS") {
      const snap = canvasLib.serializeCanvas(await loadDoc("canvas", resource.id));
      const frames = snap.objects.filter((o) => o.type === "frame");
      push(`CANVAS "${resource.title}" (${snap.objects.length} objects, ${frames.length} sections):`);
      for (const f of frames) {
        const children = snap.objects.filter((o) => o.parentId === f.id && (o.text || o.title));
        push(`SECTION "${f.title}": ${children.map((c) => c.text || c.title).join(" | ").slice(0, 1500)}`);
      }
      const loose = snap.objects.filter((o) => !o.parentId && o.type !== "frame" && (o.text || o.title || o.label));
      if (loose.length) push(`OTHER: ${loose.map((o) => o.text || o.title || o.label).join(" | ").slice(0, 3000)}`);
      const edges = snap.objects.filter((o) => o.type === "connector" && o.from && o.to && "objectId" in o.from && "objectId" in o.to);
      if (edges.length) {
        const byId = new Map(snap.objects.map((o) => [o.id, o]));
        push(`FLOWS: ${edges.map((e) => `${byId.get((e.from as { objectId: string }).objectId)?.text ?? "?"} → ${byId.get((e.to as { objectId: string }).objectId)?.text ?? "?"}${e.label ? ` (${e.label})` : ""}`).join("; ").slice(0, 2000)}`);
      }
    } else if (opts.context.resourceType === "MEETING") {
      const m = await prisma.meeting.findUniqueOrThrow({ where: { id: resource.id }, include: { transcripts: { orderBy: { createdAt: "desc" }, take: 1 }, decisions: true, actionItems: true, summaries: { where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1 } } });
      push(`MEETING "${m.title}" on ${m.startsAt.toISOString()} status=${m.status}`);
      const summary = m.summaries[0]?.content as { recap?: string } | null;
      if (summary?.recap) push(`SUMMARY: ${summary.recap}`);
      for (const d of m.decisions) push(`DECISION: ${d.text}`);
      for (const a of m.actionItems) push(`ACTION (${a.status}): ${a.text}${a.suggestedOwner ? ` — ${a.suggestedOwner}` : ""}`);
      if (m.transcripts[0]) push(`TRANSCRIPT:\n${m.transcripts[0].content.slice(0, 10_000)}`);
      if (m.notesDocumentId) push(`NOTES:\n${documentPlainText(await loadDoc("document", m.notesDocumentId)).slice(0, 5000)}`);
    } else if (opts.context.resourceType === "PROJECT") {
      opts.projectId = resource.id;
    }
  }

  // Project / workspace task context
  const projWhere = await visibleResourceWhere(user, workspaceId, "PROJECT", role);
  const projects = await prisma.project.findMany({ where: { workspaceId, deletedAt: null, ...(opts.projectId ? { id: opts.projectId } : {}), ...projWhere }, select: { id: true, name: true, key: true, status: true, dueDate: true }, take: 20 });
  const now = new Date();
  for (const p of projects) {
    sources.push(p.name);
    const tasks = await prisma.task.findMany({ where: { projectId: p.id, deletedAt: null, archivedAt: null }, orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }], take: 60, include: { assignee: { select: { name: true } } } });
    const open = tasks.filter((t) => !t.completedAt);
    push(`PROJECT "${p.name}" [${p.key}] status=${p.status} due=${p.dueDate?.toISOString().slice(0, 10) ?? "n/a"} open=${open.length} done=${tasks.length - open.length} id=${p.id}`);
    for (const t of tasks.slice(0, 40)) {
      push(`TASK ${p.key}-${t.number} "${t.title}" status=${t.status}${t.completedAt ? " done" : ""} priority=${t.priority} assignee=${t.assignee?.name ?? "unassigned"} due=${t.dueDate?.toISOString().slice(0, 10) ?? "none"}${isOverdue(t, now) ? " OVERDUE" : ""}`);
    }
  }
  // Upcoming meetings
  const meetings = await prisma.meeting.findMany({ where: { workspaceId, deletedAt: null, startsAt: { gte: new Date(now.getTime() - 7 * 86400_000) }, OR: [{ visibility: "WORKSPACE" }, { participants: { some: { userId: user.id } } }, { createdById: user.id }] }, take: 10, orderBy: { startsAt: "asc" }, select: { title: true, startsAt: true, status: true } });
  for (const m of meetings) push(`MEETING "${m.title}" ${m.startsAt.toISOString()} ${m.status}`);
  return { text: lines.join("\n"), sources: [...new Set(sources)], projects };
}

export async function assistantChat(input: ChatInput) {
  const provider = aiProvider();
  if (provider.name === "disabled") throw new AIProviderError("AI features are disabled on this server.", "disabled");
  const role = await workspaceRole(input.user.id, input.workspaceId);
  if (!role) throw forbidden();

  let conversation = input.conversationId ? await prisma.aIConversation.findFirst({ where: { id: input.conversationId, userId: input.user.id } }) : null;
  if (input.conversationId && !conversation) throw notFound("Conversation");
  if (!conversation) {
    conversation = await prisma.aIConversation.create({ data: { workspaceId: input.workspaceId, userId: input.user.id, title: input.message.slice(0, 80), resourceType: input.context?.resourceType ?? null, resourceId: input.context?.resourceId ?? null } });
  }
  await prisma.aIMessage.create({ data: { conversationId: conversation.id, userId: input.user.id, role: "user", content: input.message } });

  const history = await prisma.aIMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 8 });
  const ctx = await buildContext(input.user, input.workspaceId, { context: input.context ?? (conversation.resourceType && conversation.resourceId ? { resourceType: conversation.resourceType, resourceId: conversation.resourceId } : undefined), projectId: input.projectId });
  const prompt = `TASK: assistant\nToday: ${new Date().toISOString().slice(0, 10)}\nUser: ${input.user.name}\n\n<context>\n${ctx.text}\n</context>\n\n<history>\n${history
    .reverse()
    .slice(0, -1)
    .map((m) => `${m.role}: ${m.content.slice(0, 600)}`)
    .join("\n")}\n</history>\n\n<question>${input.message}</question>`;

  await audit({ action: "ai.chat", workspaceId: input.workspaceId, actorId: input.user.id, metadata: { provider: provider.name, contextType: input.context?.resourceType ?? null, contextChars: ctx.text.length } });
  const result = await provider.complete({ system: SYSTEM, prompt, json: true, maxTokens: 1500 });
  const parsed = parseJson<{ answer?: string; proposedActions?: Array<Record<string, unknown>>; sources?: string[] }>(result.text);

  const validProjects = new Set(ctx.projects.map((p) => p.id));
  const proposed: ProposedAction[] = (parsed.proposedActions ?? [])
    .filter((a) => a && a.type === "create_task" && typeof a.title === "string" && typeof a.projectId === "string" && validProjects.has(a.projectId as string))
    .slice(0, 10)
    .map((a, i) => ({ id: `a${i + 1}`, type: "create_task", status: "proposed", payload: { title: String(a.title).slice(0, 300), projectId: String(a.projectId), description: typeof a.description === "string" ? a.description.slice(0, 2000) : undefined, dueDate: typeof a.dueDate === "string" ? a.dueDate : null } }));

  const reply = await prisma.aIMessage.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: (parsed.answer ?? "I could not produce an answer.").slice(0, 8000),
      proposedActions: proposed.length ? (proposed as unknown as Prisma.InputJsonArray) : undefined,
      sources: (parsed.sources?.length ? parsed.sources : ctx.sources).slice(0, 20) as Prisma.InputJsonArray,
    },
  });
  await prisma.aIConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  return { conversationId: conversation.id, message: reply, provider: result.provider, model: result.model };
}

export async function confirmAction(user: Express.AuthUser, messageId: string, actionId: string, approve: boolean) {
  const message = await prisma.aIMessage.findUnique({ where: { id: messageId }, include: { conversation: true } });
  if (!message || message.conversation.userId !== user.id) throw notFound("Message");
  const actions = (message.proposedActions as unknown as ProposedAction[] | null) ?? [];
  const action = actions.find((a) => a.id === actionId);
  if (!action) throw notFound("Action");
  if (action.status !== "proposed") return { action, actions };
  if (!approve) {
    action.status = "rejected";
  } else {
    const access = await resolveAccess(user, "PROJECT", action.payload.projectId);
    if (!accessAtLeast(access.access, "EDITOR")) throw forbidden("You cannot create tasks in that project");
    const { nextTaskNumber } = await import("../projects.js");
    const board = await prisma.board.findFirst({ where: { projectId: action.payload.projectId, isDefault: true }, include: { columns: { orderBy: { position: "asc" } } } });
    const task = await prisma.$transaction(async (tx) => {
      const number = await nextTaskNumber(tx, action.payload.projectId);
      return tx.task.create({
        data: {
          workspaceId: message.conversation.workspaceId,
          projectId: action.payload.projectId,
          number,
          title: action.payload.title,
          description: action.payload.description ?? "",
          status: board?.columns[0]?.statusKey ?? "todo",
          reporterId: user.id,
          dueDate: action.payload.dueDate ? new Date(action.payload.dueDate) : null,
          position: Date.now(),
          sourceType: "ai",
          sourceId: message.id,
          sourceMeta: { conversationId: message.conversationId, actionId },
          activities: { create: { actorId: user.id, type: "created", payload: { from: "ai-assistant" } } },
        },
      });
    });
    action.status = "done";
    action.resultTaskId = task.id;
    await audit({ action: "ai.action_confirmed", workspaceId: message.conversation.workspaceId, actorId: user.id, resourceType: "TASK", resourceId: task.id, metadata: { messageId, actionId } });
  }
  await prisma.aIMessage.update({ where: { id: messageId }, data: { proposedActions: actions as unknown as Prisma.InputJsonArray } });
  return { action, actions };
}
