/**
 * In-browser stand-in for the REST API used in guest mode. `lib/api.ts` routes every request here
 * instead of calling fetch; responses have the same shapes as apps/api (the `data` payload).
 *
 * Reads are derived from the in-memory sample data (./data.ts). Writes update that state where it
 * is practical (tasks, comments, chat, meetings, favorites, …) and otherwise just report success.
 * Unknown endpoints get an empty response instead of an error. Nothing leaves the browser and the
 * state resets on reload.
 */
import { buildCanvasTemplate, CANVAS_TEMPLATES, DOCUMENT_TEMPLATES, PROJECT_TEMPLATES, DEFAULT_BOARD_COLUMNS, positionBetween } from "@collabspace/shared";
import { ApiError } from "../api";
import type { ActivityDto, BoardDto, CalendarItem, CanvasDto, ChannelDto, CommentDto, DocumentDto, FileAssetDto, MeetingDto, MessageDto, NotificationDto, ProjectDashboard, ProjectDto, SearchHit, SummaryContent, TaskDto, TaskLite, TemplateDto, ThreadDto, UserRef, WorkspaceDto } from "../api";
import { createGuestData, tiptapText, type ActivityRec, type CanvasRec, type DocumentRec, type GuestData, type Json, type MeetingRec, type ProjectRec, type TaskRec } from "./data";

let state: GuestData | null = null;
const db = (): GuestData => (state ??= createGuestData());

/** Forget all in-memory changes (called when the guest session ends). */
export function resetGuestData() {
  state = null;
}

/** Seed content for the local collaborative copies (see ./collab.ts). */
export function guestDocumentContent(id: string): Json | null {
  return db().documents.find((d) => d.id === id)?.content ?? null;
}
export function guestCanvasSnapshot(id: string) {
  return db().canvases.find((c) => c.id === id)?.snapshot ?? null;
}

export interface GuestRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

/** Answer one API request from the sample data. Throws ApiError like the real client does. */
export async function handleGuestRequest<T>(req: GuestRequest): Promise<T> {
  // A short delay keeps loading states and optimistic updates behaving like they do over a network.
  await new Promise((r) => setTimeout(r, 40 + Math.random() * 80));
  const [pathname, rawQuery] = req.path.split("?");
  const query = { ...Object.fromEntries(new URLSearchParams(rawQuery ?? "")), ...req.query };
  const result = route(req.method.toUpperCase(), pathname ?? "/", query, (req.body ?? {}) as Json);
  // Unknown read: an empty result that works for list consumers (`[]`) and page consumers (`.items`).
  if (result === EMPTY) return Object.assign([], { items: [], nextCursor: null, hasMore: false, hits: [] }) as T;
  // Hand out copies so callers can't mutate the store by accident.
  return (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as T;
}

// ---- routing -------------------------------------------------------------------------------------------

type Q = Record<string, string>;
const EMPTY = Symbol("empty");
type Handler = (p: Record<string, string>, q: Q, body: Json) => unknown;
const routes: Array<{ method: string; parts: string[]; handler: Handler }> = [];
const on = (method: string, pattern: string, handler: Handler) => routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });

function route(method: string, pathname: string, query: Q, body: Json): unknown {
  const segs = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== segs.length) continue;
    const params: Record<string, string> = {};
    if (r.parts.every((part, i) => (part.startsWith(":") ? ((params[part.slice(1)] = segs[i]!), true) : part === segs[i]))) return r.handler(params, query, body);
  }
  return method === "GET" ? EMPTY : { ok: true };
}

const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
const unavailable = (what: string) => new ApiError(403, "guest_mode", `${what} isn't available in guest mode. Sign up to try it for real.`);
function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw notFound(what);
  return value;
}
const now = () => new Date().toISOString();
let seq = 0;
const newId = (prefix: string) => `${prefix}_g${Date.now().toString(36)}${(++seq).toString(36)}`;
/** Prefer a pre-rendered ID so the new resource's page exists in the static export. */
function spareId(kind: keyof GuestData["spareIds"], prefix: string): string {
  return db().spareIds[kind].shift() ?? newId(prefix);
}
const truthy = (v: string | undefined) => v === "true" || v === "1";
const ws = () => db().workspace;
const href = (path: string) => `/app/${ws().slug}${path}`;

// ---- joins / DTO builders ------------------------------------------------------------------------------

function userRef(id: string | null | undefined): UserRef | null {
  const u = id ? db().users.find((x) => x.id === id) : undefined;
  return u ? { id: u.id, name: u.name, avatarUrl: u.avatarUrl, color: u.color } : null;
}
const userRefStrict = (id: string): UserRef => userRef(id) ?? { id, name: "Former member", avatarUrl: null, color: "#A0A9BC" };
const userWithEmail = (id: string) => {
  const u = db().users.find((x) => x.id === id);
  return { ...userRefStrict(id), email: u?.email ?? "" };
};
const meId = () => db().me.id;
const wsLite = () => ({ id: ws().id, slug: ws().slug, name: ws().name });

function projectLite(id: string | null) {
  const p = id ? db().projects.find((x) => x.id === id) : undefined;
  return p ? { id: p.id, name: p.name, key: p.key, color: p.color, workspaceId: ws().id } : null;
}
const boardOf = (projectId: string) => db().boards.find((b) => b.projectId === projectId);
function isDoneStatus(projectId: string, status: string): boolean {
  return boardOf(projectId)?.columns.find((c) => c.statusKey === status)?.isDone ?? status === "done";
}
const liveTasks = () => db().tasks.filter((t) => !t.archivedAt);
const isOverdue = (t: TaskRec) => Boolean(t.dueDate && !t.completedAt && new Date(t.dueDate) < new Date());

function taskLite(t: TaskRec): TaskLite {
  return { id: t.id, title: t.title, number: t.number, status: t.status, dueDate: t.dueDate, completedAt: t.completedAt, priority: t.priority, assigneeId: t.assigneeId };
}
function taskDto(t: TaskRec): TaskDto {
  const s = db();
  const project = s.projects.find((p) => p.id === t.projectId);
  const byId = (id: string) => s.tasks.find((x) => x.id === id);
  const blockedBy = s.dependencies.filter((d) => d.taskId === t.id).map((d) => byId(d.dependsOnTaskId)).filter((x): x is TaskRec => Boolean(x));
  const blocking = s.dependencies.filter((d) => d.dependsOnTaskId === t.id).map((d) => byId(d.taskId)).filter((x): x is TaskRec => Boolean(x));
  return {
    id: t.id,
    workspaceId: ws().id,
    projectId: t.projectId,
    number: t.number,
    key: `${project?.key ?? "TASK"}-${t.number}`,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId,
    assignee: userRef(t.assigneeId),
    reporterId: t.reporterId,
    reporter: userRefStrict(t.reporterId),
    parentId: t.parentId,
    startDate: t.startDate,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    position: t.position,
    estimate: t.estimate,
    labels: s.labels.filter((l) => t.labelIds.includes(l.id)),
    blockedBy: blockedBy.map((b) => ({ ...taskLite(b), type: "BLOCKS", projectId: b.projectId })),
    blocking: blocking.map((b) => ({ ...taskLite(b), type: "BLOCKS", projectId: b.projectId })),
    subtaskCount: s.tasks.filter((x) => x.parentId === t.id && !x.archivedAt).length,
    attachmentCount: s.files.filter((f) => f.resourceType === "TASK" && f.resourceId === t.id && !f.deletedAt).length,
    blocked: blockedBy.some((b) => !b.completedAt),
    sourceType: t.sourceType,
    sourceId: t.sourceId,
    sourceMeta: t.sourceType === "MEETING" ? { title: db().meetings.find((m) => m.id === t.sourceId)?.title ?? "Meeting" } : null,
    archivedAt: t.archivedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    project: project ? { id: project.id, name: project.name, key: project.key, color: project.color, workspaceId: ws().id } : { id: t.projectId, name: "Project", key: "TASK", color: "#5B8CFF", workspaceId: ws().id },
  };
}

function activityDto(a: ActivityRec): ActivityDto {
  return { id: a.id, type: a.type, resourceType: a.resourceType, resourceId: a.resourceId, resourceTitle: a.resourceTitle, payload: a.payload, createdAt: a.createdAt, actor: userRef(a.actorId), projectId: a.projectId };
}
function record(type: string, resourceType: string | null, resourceId: string | null, resourceTitle: string | null, projectId: string | null, payload: Record<string, unknown> = {}) {
  db().activity.unshift({ id: newId("act"), type, actorId: meId(), resourceType, resourceId, resourceTitle, payload, projectId, createdAt: now() });
}

function projectDto(p: ProjectRec, withDashboard = false): ProjectDto & { taskCount: number } {
  const s = db();
  const tasks = liveTasks().filter((t) => t.projectId === p.id);
  const dto: ProjectDto & { taskCount: number } = {
    id: p.id,
    workspaceId: ws().id,
    name: p.name,
    key: p.key,
    description: p.description,
    status: p.status,
    visibility: p.visibility,
    color: p.color,
    icon: p.icon,
    ownerId: p.ownerId,
    owner: userRefStrict(p.ownerId),
    startDate: p.startDate,
    dueDate: p.dueDate,
    boardId: p.boardId,
    members: p.members.map((m) => ({ userId: m.userId, role: m.role, user: userRefStrict(m.userId) })),
    counts: { tasks: tasks.length, documents: s.documents.filter((d) => d.projectId === p.id && !d.archivedAt).length, canvases: s.canvases.filter((c) => c.projectId === p.id && !c.archivedAt).length, meetings: s.meetings.filter((m) => m.projectId === p.id).length },
    completedTasks: tasks.filter((t) => t.completedAt).length,
    taskCount: tasks.length,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
    access: "OWNER",
    workspace: wsLite(),
  };
  if (withDashboard) dto.dashboard = projectDashboard(p, tasks);
  return dto;
}
function projectDashboard(p: ProjectRec, tasks: TaskRec[]): ProjectDashboard {
  const s = db();
  const completed = tasks.filter((t) => t.completedAt).length;
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const soon = Date.now() + 14 * 86_400_000;
  return {
    totals: { tasks: tasks.length, completed, overdue: tasks.filter(isOverdue).length, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    byStatus,
    workload: p.members.map((m) => ({ user: userRefStrict(m.userId), role: m.role, open: tasks.filter((t) => t.assigneeId === m.userId && !t.completedAt).length, done: tasks.filter((t) => t.assigneeId === m.userId && t.completedAt).length })),
    overdueTasks: tasks.filter(isOverdue).map(taskLite),
    upcomingDeadlines: tasks
      .filter((t) => t.dueDate && !t.completedAt && !isOverdue(t) && new Date(t.dueDate).getTime() < soon)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
      .map(taskLite),
    recentActivity: s.activity.filter((a) => a.projectId === p.id).slice(0, 12).map(activityDto),
    documents: s.documents.filter((d) => d.projectId === p.id && !d.archivedAt).map((d) => ({ id: d.id, title: d.title, icon: d.icon, updatedAt: d.updatedAt })),
    canvases: s.canvases.filter((c) => c.projectId === p.id && !c.archivedAt).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
    meetings: s.meetings.filter((m) => m.projectId === p.id).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map((m) => ({ id: m.id, title: m.title, startsAt: m.startsAt, status: m.status })),
    milestones: s.milestones.filter((m) => m.projectId === p.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
  };
}

const isFavorite = (type: string, id: string) => db().favorites.some((f) => f.resourceType === type && f.resourceId === id);
function canvasDto(c: CanvasRec): CanvasDto {
  return { id: c.id, workspaceId: ws().id, projectId: c.projectId, title: c.title, description: c.description, visibility: c.visibility, createdById: c.createdById, createdBy: userRefStrict(c.createdById), project: projectLite(c.projectId), workspace: wsLite(), archivedAt: c.archivedAt, updatedAt: c.updatedAt, createdAt: c.createdAt, access: "OWNER", favorite: isFavorite("CANVAS", c.id), templateKey: c.templateKey };
}
function documentDto(d: DocumentRec): DocumentDto {
  const folder = d.folderId ? db().folders.find((f) => f.id === d.folderId) : undefined;
  const meeting = d.meetingId ? db().meetings.find((m) => m.id === d.meetingId) : undefined;
  return { id: d.id, workspaceId: ws().id, projectId: d.projectId, title: d.title, icon: d.icon, visibility: d.visibility, createdById: d.createdById, createdBy: userRefStrict(d.createdById), project: projectLite(d.projectId), workspace: wsLite(), archivedAt: d.archivedAt, updatedAt: d.updatedAt, createdAt: d.createdAt, access: "OWNER", favorite: isFavorite("DOCUMENT", d.id), folder: folder ? { id: folder.id, name: folder.name } : null, meeting: meeting ? { id: meeting.id, title: meeting.title } : null };
}

function meetingDto(m: MeetingRec, detail = false): MeetingDto {
  const s = db();
  const notes = m.notesDocumentId ? s.documents.find((d) => d.id === m.notesDocumentId) : undefined;
  const p = projectLite(m.projectId);
  const dto: MeetingDto = {
    id: m.id,
    workspaceId: ws().id,
    projectId: m.projectId,
    title: m.title,
    description: m.description,
    status: m.status,
    startsAt: m.startsAt,
    durationMin: m.durationMin,
    facilitatorId: m.facilitatorId,
    facilitator: userRef(m.facilitatorId),
    createdById: m.createdById,
    createdBy: userRefStrict(m.createdById),
    notesDocumentId: m.notesDocumentId,
    notesDocument: notes ? { id: notes.id, title: notes.title } : null,
    agenda: m.agenda,
    participants: m.participants.map((pt) => ({ ...pt, user: userRefStrict(pt.userId) })),
    project: p ? { id: p.id, name: p.name, key: p.key, color: p.color } : null,
    linkedCanvasIds: m.linkedCanvasIds,
    linkedDocumentIds: m.linkedDocumentIds,
    _count: { transcripts: m.transcripts.length, actionItems: m.actionItems.length, decisions: m.decisions.length },
    access: "OWNER",
    workspace: wsLite(),
  };
  if (detail) {
    dto.transcripts = m.transcripts.map((t) => ({ id: t.id, source: t.source, createdAt: t.createdAt, preview: t.content.slice(0, 200), length: t.content.length, content: t.content }));
    dto.summaries = [...m.summaries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((x) => ({ ...x, error: null, aiJob: null }));
    dto.decisions = m.decisions;
    dto.actionItems = m.actionItems.map((a) => {
      const t = a.taskId ? s.tasks.find((x) => x.id === a.taskId) : undefined;
      return { ...a, task: t ? { id: t.id, title: t.title, status: t.status, number: t.number, project: { key: projectLite(t.projectId)?.key ?? "TASK" } } : null };
    });
    dto.linked = {
      canvases: s.canvases.filter((c) => m.linkedCanvasIds.includes(c.id)).map((c) => ({ id: c.id, title: c.title })),
      documents: s.documents.filter((d) => m.linkedDocumentIds.includes(d.id)).map((d) => ({ id: d.id, title: d.title, icon: d.icon })),
    };
    dto.history = s.meetings.filter((x) => x.id !== m.id && x.projectId === m.projectId && m.projectId && x.startsAt < m.startsAt).map((x) => ({ id: x.id, title: x.title, startsAt: x.startsAt, status: x.status }));
    dto.ai = aiStatus();
  }
  return dto;
}
const aiStatus = () => ({ provider: "guest-demo", enabled: true, model: "demo-summarizer", dataSentToProvider: "Nothing — in guest mode summaries are canned sample output generated in your browser." });

function channelDto(c: GuestData["channels"][number]): ChannelDto {
  const s = db();
  const last = s.messages.filter((m) => m.channelId === c.id && !m.parentId && !m.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const p = projectLite(c.projectId);
  return {
    id: c.id,
    workspaceId: ws().id,
    type: c.type,
    name: c.name,
    topic: c.topic,
    projectId: c.projectId,
    resourceType: null,
    resourceId: null,
    members: c.memberIds.map((userId) => ({ userId, muted: c.mutedIds.includes(userId), user: userRefStrict(userId) })),
    isMember: c.memberIds.includes(meId()),
    unread: c.memberIds.includes(meId()) ? c.unread : 0,
    lastMessage: last ? { body: last.body, createdAt: last.createdAt, author: { name: userRefStrict(last.authorId).name } } : null,
    project: p ? { id: p.id, name: p.name, key: p.key, color: p.color } : null,
    resource: null,
  };
}
function messageDto(m: GuestData["messages"][number]): MessageDto {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    author: userRefStrict(m.authorId),
    parentId: m.parentId,
    body: m.deletedAt ? "" : m.body,
    attachments: m.attachments,
    mentions: m.mentions,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
    replyCount: db().messages.filter((x) => x.parentId === m.id && !x.deletedAt).length,
    createdAt: m.createdAt,
    reactions: m.reactions.filter((r) => r.userIds.length).map((r) => ({ emoji: r.emoji, userIds: r.userIds, count: r.userIds.length })),
  };
}
function notificationDto(n: GuestData["notifications"][number]): NotificationDto {
  const { actorId, ...rest } = n;
  return { ...rest, actor: userRef(actorId), workspace: wsLite() };
}
function fileDto(f: GuestData["files"][number]): FileAssetDto {
  const p = projectLite(f.projectId);
  return { id: f.id, workspaceId: ws().id, projectId: f.projectId, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, status: "READY", width: null, height: null, altText: f.altText, resourceType: f.resourceType, resourceId: f.resourceId, createdAt: f.createdAt, updatedAt: f.updatedAt, uploader: userRefStrict(f.uploaderId), project: p ? { id: p.id, name: p.name, key: p.key } : null, access: "OWNER" };
}
function commentDto(threadId: string, c: GuestData["threads"][number]["comments"][number]): CommentDto {
  return { id: c.id, threadId, authorId: c.authorId, author: userRefStrict(c.authorId), body: c.deletedAt ? "" : c.body, editedAt: c.editedAt, deletedAt: c.deletedAt, createdAt: c.createdAt, reactions: c.reactions.filter((r) => r.userIds.length).map((r) => ({ ...r, count: r.userIds.length })), mentions: mentionsIn(c.body).map((userId) => ({ userId })) };
}
function threadDto(t: GuestData["threads"][number]): ThreadDto {
  return { id: t.id, resourceType: t.resourceType, resourceId: t.resourceId, anchor: t.anchor, resolvedAt: t.resolvedAt, resolvedById: t.resolvedById, createdAt: t.createdAt, updatedAt: t.updatedAt, comments: t.comments.map((c) => commentDto(t.id, c)) };
}
const mentionsIn = (body: string) => [...body.matchAll(/@\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]!);

function workspaceDto(): WorkspaceDto {
  const s = db();
  return {
    id: ws().id,
    slug: ws().slug,
    name: ws().name,
    description: ws().description,
    logoUrl: null,
    purpose: ws().purpose,
    ownerId: ws().ownerId,
    role: s.members.find((m) => m.userId === meId())?.role ?? "OWNER",
    isDemo: true,
    memberCount: s.members.length,
    projectCount: s.projects.filter((p) => p.status !== "ARCHIVED").length,
    settings: ws().settings,
    counts: { members: s.members.length, projects: s.projects.length, canvases: s.canvases.filter((c) => !c.archivedAt).length, documents: s.documents.filter((d) => !d.archivedAt).length },
  };
}
const requireWorkspace = (idOrSlug: string) => {
  if (idOrSlug !== ws().id && idOrSlug !== ws().slug) throw notFound("Workspace");
};

/** Title and type lookup for favorites, recent items and search. */
function resourceTitle(type: string, id: string): string | null {
  const s = db();
  switch (type) {
    case "PROJECT":
      return s.projects.find((x) => x.id === id)?.name ?? null;
    case "CANVAS":
      return s.canvases.find((x) => x.id === id)?.title ?? null;
    case "DOCUMENT":
      return s.documents.find((x) => x.id === id)?.title ?? null;
    case "MEETING":
      return s.meetings.find((x) => x.id === id)?.title ?? null;
    case "TASK":
      return s.tasks.find((x) => x.id === id)?.title ?? null;
    case "BOARD": {
      const b = s.boards.find((x) => x.id === id);
      return b ? `${s.projects.find((p) => p.id === b.projectId)?.name ?? "Project"} board` : null;
    }
    default:
      return null;
  }
}
function touchRecent(type: string, id: string) {
  const s = db();
  s.recent = [{ resourceType: type, resourceId: id, openedAt: now() }, ...s.recent.filter((r) => !(r.resourceType === type && r.resourceId === id))].slice(0, 30);
}

// ---- auth & user ---------------------------------------------------------------------------------------

on("GET", "/auth/me", () => ({ user: db().me, workspaces: [workspaceDto()], unreadNotifications: db().notifications.filter((n) => !n.readAt).length }));
on("POST", "/auth/login", () => ({ user: db().me }));
on("POST", "/auth/logout", () => undefined);
on("GET", "/auth/sessions", () => [
  { id: "sess_current", userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "Browser", ip: null, createdAt: new Date(Date.now() - 3_600_000).toISOString(), lastSeenAt: now(), current: true },
  { id: "sess_phone", userAgent: "CollabSpace iOS beta (iPhone)", ip: null, createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), lastSeenAt: new Date(Date.now() - 86_400_000).toISOString(), current: false },
]);
on("DELETE", "/auth/sessions/:id", () => undefined);
on("POST", "/auth/resend-verification", () => ({ sent: true }));
on("PATCH", "/users/me", (_p, _q, body) => {
  const s = db();
  const allowed = ["name", "avatarUrl", "timezone", "onboardingDone", "color"] as const;
  for (const k of allowed) if (k in body) (s.me as unknown as Json)[k] = body[k];
  if (body.preferences && typeof body.preferences === "object") s.me.preferences = { ...s.me.preferences, ...(body.preferences as Json) };
  const u = s.users.find((x) => x.id === s.me.id);
  if (u && typeof body.name === "string") u.name = body.name;
  return s.me;
});
on("DELETE", "/users/me", () => {
  throw unavailable("Deleting the account");
});
on("POST", "/users/me/password", () => {
  throw unavailable("Changing the password");
});
on("GET", "/users/me/favorites", () =>
  db()
    .favorites.map((f) => ({ resourceType: f.resourceType, resourceId: f.resourceId, title: resourceTitle(f.resourceType, f.resourceId), workspaceSlug: ws().slug, workspaceName: ws().name, createdAt: f.createdAt }))
    .filter((f) => f.title),
);
on("POST", "/users/me/favorites", (_p, _q, body) => {
  const s = db();
  const type = String(body.resourceType);
  const id = String(body.resourceId);
  const exists = isFavorite(type, id);
  s.favorites = exists ? s.favorites.filter((f) => !(f.resourceType === type && f.resourceId === id)) : [{ resourceType: type, resourceId: id, createdAt: now() }, ...s.favorites];
  return { favorite: !exists };
});
on("GET", "/users/me/recent", () =>
  db()
    .recent.map((r) => ({ ...r, title: resourceTitle(r.resourceType, r.resourceId), workspaceSlug: ws().slug, workspaceName: ws().name }))
    .filter((r) => r.title),
);
on("GET", "/users/me/search-history", () => db().searchHistory.map(({ id, query }) => ({ id, query })));
on("DELETE", "/users/me/search-history", () => {
  db().searchHistory = [];
});

// ---- workspaces ----------------------------------------------------------------------------------------

on("GET", "/workspaces", () => [workspaceDto()]);
on("POST", "/workspaces", () => {
  // A new workspace would need its own pages, which the static demo site doesn't have.
  throw unavailable("Creating workspaces");
});
on("GET", "/workspaces/:id", (p) => {
  requireWorkspace(p.id!);
  return workspaceDto();
});
on("PATCH", "/workspaces/:id", (p, _q, body) => {
  requireWorkspace(p.id!);
  const w = ws();
  if (typeof body.name === "string") w.name = body.name;
  if ("description" in body) w.description = String(body.description ?? "");
  if (typeof body.purpose === "string") w.purpose = body.purpose;
  if (body.settings && typeof body.settings === "object") w.settings = { ...w.settings, ...(body.settings as Json) };
  return workspaceDto();
});
on("DELETE", "/workspaces/:id", () => {
  throw unavailable("Deleting the workspace");
});
on("GET", "/workspaces/:id/members", () => db().members.map((m) => ({ id: m.id, role: m.role, joinedAt: m.joinedAt, user: userWithEmail(m.userId) })));
on("PATCH", "/workspaces/:id/members/:userId", (p, _q, body) => {
  const m = must(db().members.find((x) => x.userId === p.userId), "Member");
  if (m.userId === meId()) throw new ApiError(400, "bad_request", "You can't change your own role.");
  m.role = body.role as typeof m.role;
  return { ok: true };
});
on("DELETE", "/workspaces/:id/members/:userId", (p) => {
  if (p.userId === meId()) throw new ApiError(400, "bad_request", "The owner can't leave the workspace.");
  db().members = db().members.filter((m) => m.userId !== p.userId);
});
on("GET", "/workspaces/:id/invitations", () => db().invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt, invitedBy: { name: userRefStrict(i.invitedById).name } })));
on("POST", "/workspaces/:id/invitations", (_p, _q, body) => {
  const emails = (Array.isArray(body.emails) ? body.emails : [body.email]).filter(Boolean).map(String);
  for (const email of emails) db().invitations.unshift({ id: newId("inv"), email, role: String(body.role ?? "MEMBER"), createdAt: now(), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), invitedById: meId() });
  return emails.map((email) => ({ email, status: "sent" }));
});
on("DELETE", "/workspaces/:id/invitations/:inv", (p) => {
  db().invitations = db().invitations.filter((i) => i.id !== p.inv);
});
on("GET", "/workspaces/:id/labels", () => db().labels);
on("POST", "/workspaces/:id/labels", (_p, _q, body) => {
  const label = { id: newId("l"), name: String(body.name ?? "label"), color: String(body.color ?? "#5B8CFF") };
  db().labels.push(label);
  return label;
});
on("PATCH", "/workspaces/:id/labels/:labelId", (p, _q, body) => {
  const l = must(db().labels.find((x) => x.id === p.labelId), "Label");
  Object.assign(l, typeof body.name === "string" ? { name: body.name } : {}, typeof body.color === "string" ? { color: body.color } : {});
  return l;
});
on("DELETE", "/workspaces/:id/labels/:labelId", (p) => {
  db().labels = db().labels.filter((l) => l.id !== p.labelId);
  for (const t of db().tasks) t.labelIds = t.labelIds.filter((x) => x !== p.labelId);
});

on("GET", "/workspaces/:id/overview", () => {
  const s = db();
  const mine = liveTasks()
    .filter((t) => t.assigneeId === meId() && !t.completedAt)
    .sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))
    .slice(0, 8)
    .map((t) => ({ ...taskDto(t), overdue: isOverdue(t) }));
  return {
    projects: s.projects.filter((p) => p.status !== "ARCHIVED" && p.status !== "COMPLETED").map((p) => projectDto(p)),
    myTasks: mine,
    upcomingMeetings: s.meetings
      .filter((m) => m.status === "SCHEDULED" && new Date(m.startsAt).getTime() + m.durationMin * 60_000 > Date.now())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .slice(0, 5)
      .map((m) => meetingDto(m)),
    recentDocuments: [...s.documents].filter((d) => !d.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map((d) => ({ id: d.id, title: d.title, icon: d.icon, updatedAt: d.updatedAt })),
    recentCanvases: [...s.canvases].filter((c) => !c.archivedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
    activity: s.activity.slice(0, 15).map(activityDto),
  };
});

on("GET", "/workspaces/:id/analytics", () => {
  const s = db();
  const tasks = liveTasks();
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const days: Array<{ date: string; count: number }> = [];
  for (let i = 41; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, count: tasks.filter((t) => t.completedAt?.slice(0, 10) === key).length });
  }
  const sixWeeksAgo = Date.now() - 42 * 86_400_000;
  const collab = new Map<string, number>();
  for (const a of s.activity) if (new Date(a.createdAt).getTime() > sixWeeksAgo) collab.set(a.type, (collab.get(a.type) ?? 0) + 1);
  const actionItems = new Map<string, number>();
  for (const m of s.meetings) for (const a of m.actionItems) actionItems.set(a.status, (actionItems.get(a.status) ?? 0) + 1);
  return {
    definitions: {
      overdue: "Open tasks whose due date has passed.",
      completedOverTime: "Tasks moved to a done column, per day.",
      workload: "Open and completed tasks per assignee across all projects.",
      actionItems: "Meeting action items by review state.",
    },
    totals: { tasks: tasks.length, completed: tasks.filter((t) => t.completedAt).length, overdue: tasks.filter(isOverdue).length, byStatus },
    completedOverTime: days,
    workload: s.members.map((m) => ({ user: userRefStrict(m.userId), open: tasks.filter((t) => t.assigneeId === m.userId && !t.completedAt).length, overdue: tasks.filter((t) => t.assigneeId === m.userId && isOverdue(t)).length, completed: tasks.filter((t) => t.assigneeId === m.userId && t.completedAt).length })),
    projectProgress: s.projects.map((p) => {
      const pt = tasks.filter((t) => t.projectId === p.id);
      const done = pt.filter((t) => t.completedAt).length;
      return { id: p.id, name: p.name, color: p.color, key: p.key, status: p.status, total: pt.length, done, percent: pt.length ? Math.round((done / pt.length) * 100) : 0 };
    }),
    actionItems: [...actionItems].map(([status, count]) => ({ status, count })),
    collaboration: [...collab].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
});

on("GET", "/workspaces/:id/activity", (_p, q) => {
  let list = db().activity;
  const type = q.type;
  if (type) list = list.filter((a) => a.type.startsWith(`${type}.`) || a.resourceType === type.toUpperCase());
  return paginate(list.map(activityDto), q);
});
function paginate<T extends { id: string }>(list: T[], q: Q) {
  const limit = Math.max(1, Number(q.limit ?? 30));
  const start = q.cursor ? list.findIndex((x) => x.id === q.cursor) + 1 : 0;
  const items = list.slice(start, start + limit);
  return { items, nextCursor: start + limit < list.length ? (items[items.length - 1]?.id ?? null) : null };
}

// ---- projects, boards, tasks ---------------------------------------------------------------------------

on("GET", "/workspaces/:id/projects", (_p, q) => db().projects.filter((p) => truthy(q.includeArchived) || (p.status !== "ARCHIVED" && p.status !== "COMPLETED")).map((p) => projectDto(p)));
on("POST", "/workspaces/:id/projects", (_p, _q, body) => {
  const s = db();
  const tpl = body.templateKey ? PROJECT_TEMPLATES.find((t) => t.key === body.templateKey) : undefined;
  const name = String(body.name ?? "Untitled project");
  const project: ProjectRec = {
    id: spareId("project", "p"),
    name,
    key: name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() || "PRJ",
    description: (body.description as string | undefined) ?? tpl?.description ?? null,
    status: "ACTIVE",
    visibility: (body.visibility as ProjectRec["visibility"]) ?? "WORKSPACE",
    color: tpl?.color ?? "#5B8CFF",
    icon: tpl?.icon ?? null,
    ownerId: meId(),
    startDate: now(),
    dueDate: null,
    boardId: spareId("board", "b"),
    members: [{ userId: meId(), role: "LEAD" }],
    taskCounter: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  s.projects.push(project);
  const columns: Array<{ name: string; statusKey: string; color: string; isDone?: boolean }> = tpl?.columns ?? [...DEFAULT_BOARD_COLUMNS];
  s.boards.push({ id: project.boardId, projectId: project.id, name: "Board", columns: columns.map((c, i) => ({ id: `${project.boardId}_${c.statusKey}`, boardId: project.boardId, name: c.name, statusKey: c.statusKey, color: c.color, position: (i + 1) * 1000, isDone: Boolean(c.isDone), wipLimit: null })) });
  for (const t of tpl?.tasks ?? []) {
    if (t.parentKey) continue;
    createTask(project, { title: t.title, status: t.status ?? "todo", priority: t.priority ?? "NONE", dueDate: t.dueOffsetDays != null ? new Date(Date.now() + t.dueOffsetDays * 86_400_000).toISOString() : null });
  }
  for (const d of tpl?.documents ?? []) s.documents.push(newDocument({ title: d.title, icon: d.icon ?? null, projectId: project.id, content: d.content }));
  record("project.created", "PROJECT", project.id, project.name, project.id);
  return projectDto(project);
});
const findProject = (id: string) => must(db().projects.find((p) => p.id === id), "Project");
on("GET", "/projects/:id", (p) => {
  const project = findProject(p.id!);
  touchRecent("PROJECT", project.id);
  return projectDto(project, true);
});
on("PATCH", "/projects/:id", (p, _q, body) => {
  const project = findProject(p.id!);
  for (const k of ["name", "description", "status", "visibility", "color", "icon", "startDate", "dueDate"] as const) if (k in body) (project as unknown as Json)[k] = body[k];
  project.updatedAt = now();
  record("project.updated", "PROJECT", project.id, project.name, project.id);
  return projectDto(project);
});
on("POST", "/projects/:id/members", (p, _q, body) => {
  const project = findProject(p.id!);
  const userId = String(body.userId);
  if (!project.members.some((m) => m.userId === userId)) project.members.push({ userId, role: String(body.role ?? "MEMBER") });
  return { ok: true };
});
on("GET", "/projects/:id/milestones", (p) => db().milestones.filter((m) => m.projectId === p.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
on("POST", "/projects/:id/milestones", (p, _q, body) => {
  const ms = { id: newId("ms"), projectId: p.id!, title: String(body.title ?? "Milestone"), description: (body.description as string) ?? null, dueDate: String(body.dueDate ?? now()), completedAt: null };
  db().milestones.push(ms);
  return ms;
});
on("PATCH", "/projects/:id/milestones/:msId", (p, _q, body) => {
  const ms = must(db().milestones.find((m) => m.id === p.msId), "Milestone");
  if ("completed" in body) ms.completedAt = body.completed ? now() : null;
  for (const k of ["title", "description", "dueDate", "completedAt"] as const) if (k in body) (ms as unknown as Json)[k] = body[k];
  return ms;
});
on("DELETE", "/projects/:id/milestones/:msId", (p) => {
  db().milestones = db().milestones.filter((m) => m.id !== p.msId);
});

function columnsFor(projectId: string) {
  return boardOf(projectId)?.columns ?? DEFAULT_BOARD_COLUMNS.map((c, i) => ({ id: c.statusKey, boardId: "", name: c.name, statusKey: c.statusKey, color: c.color, position: i, isDone: c.isDone, wipLimit: null }));
}
on("GET", "/projects/:id/tasks", (p, q) => {
  findProject(p.id!);
  const tasks = db().tasks.filter((t) => t.projectId === p.id && (truthy(q.includeArchived) || !t.archivedAt));
  return { tasks: tasks.sort((a, b) => a.position - b.position).map(taskDto), columns: columnsFor(p.id!) };
});
on("GET", "/workspaces/:id/tasks", (_p, q) => {
  let tasks = db().tasks.filter((t) => truthy(q.includeArchived) || !t.archivedAt);
  if (truthy(q.mine)) tasks = tasks.filter((t) => t.assigneeId === meId());
  if (q.sort === "dueDate") tasks = [...tasks].filter((t) => !t.completedAt).sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  if (q.limit) tasks = tasks.slice(0, Number(q.limit));
  return { tasks: tasks.map(taskDto) };
});

function createTask(project: ProjectRec, body: Json): TaskRec {
  const s = db();
  const status = String(body.status ?? "todo");
  const last = s.tasks.filter((t) => t.projectId === project.id && t.status === status).reduce((m, t) => Math.max(m, t.position), 0);
  project.taskCounter += 1;
  const task: TaskRec = {
    id: newId("t"),
    projectId: project.id,
    number: project.taskCounter,
    title: String(body.title ?? "Untitled task"),
    description: String(body.description ?? ""),
    status,
    priority: (body.priority as TaskRec["priority"]) ?? "NONE",
    assigneeId: (body.assigneeId as string | null) ?? null,
    reporterId: meId(),
    parentId: (body.parentId as string | null) ?? null,
    startDate: (body.startDate as string | null) ?? null,
    dueDate: (body.dueDate as string | null) ?? null,
    completedAt: isDoneStatus(project.id, status) ? now() : null,
    position: last + 1000,
    estimate: (body.estimate as number | null) ?? null,
    labelIds: Array.isArray(body.labelIds) ? (body.labelIds as string[]) : [],
    sourceType: (body.sourceType as string | null) ?? null,
    sourceId: (body.sourceId as string | null) ?? null,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  s.tasks.push(task);
  project.updatedAt = now();
  return task;
}
on("POST", "/projects/:id/tasks", (p, _q, body) => {
  const task = createTask(findProject(p.id!), body);
  record("task.created", "TASK", task.id, task.title, task.projectId);
  return taskDto(task);
});
const findTask = (id: string) => must(db().tasks.find((t) => t.id === id), "Task");
on("GET", "/tasks/:id", (p) => {
  const t = findTask(p.id!);
  const s = db();
  const parent = t.parentId ? s.tasks.find((x) => x.id === t.parentId) : undefined;
  return {
    ...taskDto(t),
    subtasks: s.tasks.filter((x) => x.parentId === t.id && !x.archivedAt).sort((a, b) => a.position - b.position).map(taskDto),
    attachments: s.files.filter((f) => f.resourceType === "TASK" && f.resourceId === t.id && !f.deletedAt).map(fileDto),
    activities: s.activity.filter((a) => a.resourceType === "TASK" && a.resourceId === t.id).map(activityDto),
    columns: columnsFor(t.projectId),
    access: "OWNER",
    workspaceSlug: ws().slug,
    parent: parent ? { id: parent.id, title: parent.title, number: parent.number } : null,
  };
});
function applyTaskPatch(t: TaskRec, body: Json) {
  const before = t.status;
  for (const k of ["title", "description", "priority", "assigneeId", "startDate", "dueDate", "estimate", "parentId"] as const) if (k in body) (t as unknown as Json)[k] = body[k];
  if (Array.isArray(body.labelIds)) t.labelIds = body.labelIds as string[];
  if ("archived" in body) t.archivedAt = body.archived ? now() : null;
  if (typeof body.status === "string") t.status = body.status;
  if ("completed" in body) {
    const cols = columnsFor(t.projectId);
    t.status = body.completed ? (cols.find((c) => c.isDone)?.statusKey ?? "done") : before !== "done" && !isDoneStatus(t.projectId, before) ? before : (cols.find((c) => !c.isDone && c.statusKey !== "backlog")?.statusKey ?? "todo");
  }
  const done = isDoneStatus(t.projectId, t.status);
  if (done && !t.completedAt) t.completedAt = now();
  if (!done) t.completedAt = null;
  t.updatedAt = now();
  if (t.status !== before) record(done ? "task.completed" : "task.status", "TASK", t.id, t.title, t.projectId, { from: before, to: t.status });
}
on("PATCH", "/tasks/:id", (p, _q, body) => {
  const t = findTask(p.id!);
  applyTaskPatch(t, body);
  return taskDto(t);
});
on("POST", "/tasks/:id/move", (p, _q, body) => {
  const s = db();
  const t = findTask(p.id!);
  const before = body.beforeId ? s.tasks.find((x) => x.id === body.beforeId)?.position : null;
  const after = body.afterId ? s.tasks.find((x) => x.id === body.afterId)?.position : null;
  const status = String(body.status ?? t.status);
  t.position = before == null && after == null ? s.tasks.filter((x) => x.projectId === t.projectId && x.status === status && x.id !== t.id).reduce((m, x) => Math.max(m, x.position), 0) + 1000 : positionBetween(before ?? null, after ?? null);
  applyTaskPatch(t, { status });
  return taskDto(t);
});
on("DELETE", "/tasks/:id", (p) => {
  const s = db();
  const ids = new Set([p.id!, ...s.tasks.filter((t) => t.parentId === p.id).map((t) => t.id)]);
  s.tasks = s.tasks.filter((t) => !ids.has(t.id));
  s.dependencies = s.dependencies.filter((d) => !ids.has(d.taskId) && !ids.has(d.dependsOnTaskId));
});
on("POST", "/workspaces/:id/tasks/bulk", (_p, _q, body) => {
  const ids = (body.taskIds as string[]) ?? [];
  const patch = (body.patch as Json) ?? {};
  for (const t of db().tasks.filter((x) => ids.includes(x.id))) {
    if (patch.delete) continue;
    applyTaskPatch(t, patch);
  }
  if (patch.delete) db().tasks = db().tasks.filter((t) => !ids.includes(t.id));
  return { updated: ids.length };
});
on("POST", "/tasks/:id/dependencies", (p, _q, body) => {
  const s = db();
  const dependsOnTaskId = String(body.dependsOnTaskId);
  if (dependsOnTaskId === p.id) throw new ApiError(400, "bad_request", "A task can't depend on itself.");
  if (!s.dependencies.some((d) => d.taskId === p.id && d.dependsOnTaskId === dependsOnTaskId)) s.dependencies.push({ id: newId("dep"), taskId: p.id!, dependsOnTaskId });
  return { ok: true };
});
on("DELETE", "/tasks/:id/dependencies/:depId", (p) => {
  db().dependencies = db().dependencies.filter((d) => !(d.id === p.depId || (d.taskId === p.id && d.dependsOnTaskId === p.depId) || (d.dependsOnTaskId === p.id && d.taskId === p.depId)));
});
on("POST", "/tasks/:id/attachments", (p, _q, body) => {
  const f = db().files.find((x) => x.id === body.fileId);
  if (f) Object.assign(f, { resourceType: "TASK", resourceId: p.id });
  return f ? fileDto(f) : { ok: true };
});
on("DELETE", "/tasks/:id/attachments/:fileId", (p) => {
  const f = db().files.find((x) => x.id === p.fileId);
  if (f) Object.assign(f, { resourceType: null, resourceId: null });
});

on("GET", "/boards/:id", (p) => {
  const s = db();
  const board = must(s.boards.find((b) => b.id === p.id), "Board");
  const project = findProject(board.projectId);
  touchRecent("BOARD", board.id);
  const dto: BoardDto = {
    id: board.id,
    name: board.name,
    projectId: project.id,
    columns: board.columns,
    tasks: liveTasks().filter((t) => t.projectId === project.id).sort((a, b) => a.position - b.position).map(taskDto),
    access: "OWNER",
    project: { id: project.id, name: project.name, key: project.key, color: project.color, workspaceId: ws().id, workspace: { slug: ws().slug } },
  };
  return dto;
});
on("PATCH", "/boards/:id", (p, _q, body) => {
  const board = must(db().boards.find((b) => b.id === p.id), "Board");
  if (typeof body.name === "string") board.name = body.name;
  if (Array.isArray(body.columns)) {
    board.columns = (body.columns as Json[]).map((c, i) => ({ id: (c.id as string) || `${board.id}_${String(c.statusKey)}`, boardId: board.id, name: String(c.name), statusKey: String(c.statusKey), color: String(c.color ?? "#A0A9BC"), position: (i + 1) * 1000, isDone: Boolean(c.isDone), wipLimit: (c.wipLimit as number | null) ?? null }));
  }
  return { ok: true };
});

// ---- canvases & documents ------------------------------------------------------------------------------

// Archived items are included: the list pages split active/archived themselves.
const visible = <T extends { projectId: string | null }>(list: T[], q: Q) => list.filter((x) => (q.projectId ? x.projectId === q.projectId : true));
on("GET", "/workspaces/:id/canvases", (_p, q) => visible(db().canvases, q).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(canvasDto));
on("GET", "/workspaces/:id/documents", (_p, q) => visible(db().documents, q).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(documentDto));
on("GET", "/workspaces/:id/folders", () => db().folders.map((f) => ({ ...f, _count: { documents: db().documents.filter((d) => d.folderId === f.id && !d.archivedAt).length, canvases: 0 } })));
on("POST", "/workspaces/:id/folders", (_p, _q, body) => {
  const folder = { id: newId("f"), name: String(body.name ?? "New folder"), parentId: (body.parentId as string | null) ?? null };
  db().folders.push(folder);
  return { ...folder, _count: { documents: 0, canvases: 0 } };
});

function newCanvas(body: Json, snapshot: CanvasRec["snapshot"]): CanvasRec {
  return { id: spareId("canvas", "c"), title: String(body.title ?? "Untitled canvas"), description: (body.description as string | null) ?? null, projectId: (body.projectId as string | null) ?? null, createdById: meId(), visibility: (body.visibility as CanvasRec["visibility"]) ?? "WORKSPACE", templateKey: (body.templateKey as string | null) ?? null, archivedAt: null, createdAt: now(), updatedAt: now(), snapshot };
}
function newDocument(body: { title: string; icon?: string | null; projectId?: string | null; content?: Json; folderId?: string | null; meetingId?: string | null }): DocumentRec {
  return { id: spareId("document", "d"), title: body.title, icon: body.icon ?? null, projectId: body.projectId ?? null, folderId: body.folderId ?? null, meetingId: body.meetingId ?? null, createdById: meId(), visibility: "WORKSPACE", archivedAt: null, createdAt: now(), updatedAt: now(), content: body.content ?? { type: "doc", content: [{ type: "paragraph" }] } };
}
on("POST", "/canvases", (_p, _q, body) => {
  const c = newCanvas(body, body.templateKey ? buildCanvasTemplate(String(body.templateKey), newId("tpl")) : null);
  db().canvases.push(c);
  record("canvas.created", "CANVAS", c.id, c.title, c.projectId);
  return canvasDto(c);
});
on("POST", "/documents", (_p, _q, body) => {
  const tpl = body.templateKey ? DOCUMENT_TEMPLATES.find((t) => t.key === body.templateKey) : undefined;
  const d = newDocument({ title: String(body.title ?? "Untitled document"), icon: tpl?.icon ?? null, projectId: (body.projectId as string | null) ?? null, content: tpl?.content, folderId: (body.folderId as string | null) ?? null });
  db().documents.push(d);
  record("document.created", "DOCUMENT", d.id, d.title, d.projectId);
  return documentDto(d);
});
const findCanvas = (id: string) => must(db().canvases.find((c) => c.id === id), "Canvas");
const findDocument = (id: string) => must(db().documents.find((d) => d.id === id), "Document");
on("GET", "/canvases/:id", (p) => {
  const c = findCanvas(p.id!);
  touchRecent("CANVAS", c.id);
  return canvasDto(c);
});
on("GET", "/documents/:id", (p) => {
  const d = findDocument(p.id!);
  touchRecent("DOCUMENT", d.id);
  return documentDto(d);
});
function patchResource(r: CanvasRec | DocumentRec, body: Json) {
  for (const k of ["title", "description", "projectId", "visibility", "icon", "folderId"] as const) if (k in body && k in r) (r as unknown as Json)[k] = body[k];
  if ("archived" in body) r.archivedAt = body.archived ? now() : null;
  r.updatedAt = now();
}
on("PATCH", "/canvases/:id", (p, _q, body) => {
  const c = findCanvas(p.id!);
  patchResource(c, body);
  return canvasDto(c);
});
on("PATCH", "/documents/:id", (p, _q, body) => {
  const d = findDocument(p.id!);
  patchResource(d, body);
  return documentDto(d);
});
on("DELETE", "/canvases/:id", (p) => {
  db().canvases = db().canvases.filter((c) => c.id !== p.id);
});
on("DELETE", "/documents/:id", (p) => {
  db().documents = db().documents.filter((d) => d.id !== p.id);
});
on("POST", "/canvases/:id/duplicate", (p) => {
  const src = findCanvas(p.id!);
  const c = { ...newCanvas({ ...src, title: `${src.title} (copy)` }, src.snapshot), templateKey: src.templateKey };
  db().canvases.push(c);
  return canvasDto(c);
});
on("POST", "/documents/:id/duplicate", (p) => {
  const src = findDocument(p.id!);
  const d = newDocument({ title: `${src.title} (copy)`, icon: src.icon, projectId: src.projectId, content: src.content, folderId: src.folderId });
  db().documents.push(d);
  return documentDto(d);
});
on("POST", "/canvases/:id/resolve-links", (_p, _q, body) => {
  const s = db();
  const taskIds = (body.taskIds as string[]) ?? [];
  const documentIds = (body.documentIds as string[]) ?? [];
  return { tasks: s.tasks.filter((t) => taskIds.includes(t.id)).map(taskDto), documents: s.documents.filter((d) => documentIds.includes(d.id)).map((d) => ({ id: d.id, title: d.title, icon: d.icon })) };
});
function convertToTask(body: Json, source: { type: string; id: string }) {
  const projectId = String(body.projectId ?? db().projects[0]!.id);
  const t = createTask(findProject(projectId), { ...body, sourceType: source.type, sourceId: source.id });
  record("task.created", "TASK", t.id, t.title, t.projectId);
  return t;
}
on("POST", "/canvases/:id/objects/:objectId/convert-to-task", (p, _q, body) => taskDto(convertToTask(body, { type: "CANVAS", id: p.id! })));
on("POST", "/documents/:id/convert-to-task", (p, _q, body) => taskDto(convertToTask(body, { type: "DOCUMENT", id: p.id! })));

for (const kind of ["canvases", "documents"] as const) {
  const type = kind === "canvases" ? "canvas" : "document";
  on("GET", `/${kind}/:id/versions`, (p) => db().versions[`${type}:${p.id}`] ?? []);
  on("GET", `/${kind}/:id/versions/:versionId`, (p) => {
    if (type === "document") {
      const d = db().documents.find((x) => x.id === p.id);
      return { text: d ? tiptapText(d.content) : "" };
    }
    const snap = db().canvases.find((x) => x.id === p.id)?.snapshot;
    return { objects: (snap?.objects ?? []).map((o) => ({ id: o.id, type: o.type, text: o.text, title: o.title })) };
  });
  on("POST", `/${kind}/:id/versions`, (p, _q, body) => {
    const key = `${type}:${p.id}`;
    const v = { id: newId("v"), kind: "NAMED" as const, name: String(body.name || "Checkpoint"), authorId: meId(), author: userRef(meId()), sizeBytes: 4_096, createdAt: now() };
    db().versions[key] = [v, ...(db().versions[key] ?? [])];
    return v;
  });
  on("POST", `/${kind}/:id/restore`, () => ({ ok: true }));
}

// ---- meetings ------------------------------------------------------------------------------------------

on("GET", "/workspaces/:id/meetings", (_p, q) => db().meetings.filter((m) => (q.projectId ? m.projectId === q.projectId : true)).sort((a, b) => b.startsAt.localeCompare(a.startsAt)).map((m) => meetingDto(m)));
const findMeeting = (id: string) => must(db().meetings.find((m) => m.id === id), "Meeting");
on("GET", "/meetings/:id", (p) => {
  const m = findMeeting(p.id!);
  touchRecent("MEETING", m.id);
  return meetingDto(m, true);
});
on("POST", "/meetings", (_p, _q, body) => {
  const s = db();
  const participantIds = new Set([meId(), ...((body.participantIds as string[]) ?? [])]);
  const id = spareId("meeting", "m");
  const notes = newDocument({ title: `${String(body.title ?? "Meeting")} — notes`, icon: "📝", projectId: (body.projectId as string | null) ?? null, folderId: "f_meetings", meetingId: id, content: DOCUMENT_TEMPLATES.find((t) => t.key === "doc.meeting-notes")?.content });
  s.documents.push(notes);
  const m: MeetingRec = {
    id,
    projectId: (body.projectId as string | null) ?? null,
    title: String(body.title ?? "Meeting"),
    description: (body.description as string | null) ?? null,
    status: "SCHEDULED",
    startsAt: String(body.startsAt ?? now()),
    durationMin: Number(body.durationMin ?? 30),
    facilitatorId: (body.facilitatorId as string | null) ?? meId(),
    createdById: meId(),
    notesDocumentId: notes.id,
    agenda: (body.agenda as MeetingRec["agenda"]) ?? [],
    participants: [...participantIds].map((userId) => ({ userId, status: userId === meId() ? "ACCEPTED" : "PENDING", attended: false })),
    linkedCanvasIds: [],
    linkedDocumentIds: [],
    transcripts: [],
    summaries: [],
    decisions: [],
    actionItems: [],
  };
  s.meetings.push(m);
  record("meeting.created", "MEETING", m.id, m.title, m.projectId);
  return meetingDto(m);
});
on("PATCH", "/meetings/:id", (p, _q, body) => {
  const m = findMeeting(p.id!);
  for (const k of ["title", "description", "status", "startsAt", "durationMin", "facilitatorId", "projectId", "agenda", "linkedCanvasIds", "linkedDocumentIds"] as const) if (k in body) (m as unknown as Json)[k] = body[k];
  if (Array.isArray(body.participantIds)) {
    const ids = body.participantIds as string[];
    m.participants = ids.map((userId) => m.participants.find((x) => x.userId === userId) ?? { userId, status: "PENDING", attended: false });
  }
  if (body.status === "COMPLETED") for (const pt of m.participants) if (pt.status === "ACCEPTED") pt.attended = true;
  return meetingDto(m, true);
});
on("POST", "/meetings/:id/rsvp", (p, _q, body) => {
  const m = findMeeting(p.id!);
  const mine = m.participants.find((x) => x.userId === meId());
  if (mine) mine.status = String(body.status);
  else m.participants.push({ userId: meId(), status: String(body.status), attended: false });
  return { ok: true };
});
on("POST", "/meetings/:id/transcripts", (p, _q, body) => {
  const m = findMeeting(p.id!);
  const t = { id: newId("tr"), source: String(body.source ?? "PASTE"), createdAt: now(), content: String(body.content ?? "") };
  m.transcripts.push(t);
  return { id: t.id };
});
on("POST", "/meetings/:id/summarize", (p) => {
  const m = findMeeting(p.id!);
  const transcript = m.transcripts[m.transcripts.length - 1]?.content ?? "";
  const lines = transcript.split("\n").map((l) => l.trim()).filter(Boolean);
  const speakers = [...new Set(lines.map((l) => l.split(":")[0]!).filter((x) => x.length < 30))];
  const pick = (re: RegExp) => lines.filter((l) => re.test(l)).map((l) => ({ text: l.replace(/^[^:]{1,30}:\s*/, ""), excerpt: l }));
  const content: SummaryContent = {
    recap: lines.length ? `${speakers.join(", ") || "The team"} discussed ${m.title.toLowerCase()}. ${lines.length} transcript lines were analysed. (Guest mode: this summary is generated locally from simple rules, not by an AI model.)` : "No transcript content to summarise.",
    topics: [{ title: m.title, points: lines.slice(0, 3).map((l) => l.replace(/^[^:]{1,30}:\s*/, "")) }],
    decisions: pick(/decision|decide|agreed/i),
    openQuestions: pick(/\?\s*$/),
    actionItems: pick(/\b(I'll|I will|can you|will do|todo|to do)\b/i).map((x) => ({ ...x, suggestedOwner: x.excerpt.split(":")[0] ?? null, suggestedDue: null })),
    participants: speakers,
    generatedBy: "guest-demo",
  };
  const summary = { id: newId("sum"), status: "COMPLETED" as const, model: "demo-summarizer", content, editedContent: null, createdAt: now(), transcriptId: m.transcripts[m.transcripts.length - 1]?.id ?? null };
  m.summaries.push(summary);
  for (const a of content.actionItems) m.actionItems.push({ id: newId("ai"), text: a.text, suggestedOwner: a.suggestedOwner, suggestedDue: a.suggestedDue, excerpt: a.excerpt ?? null, status: "DRAFT", taskId: null, source: "AI" });
  return { summaryId: summary.id, status: "COMPLETED" };
});
on("PATCH", "/meetings/:id/summaries/:sid", (p, _q, body) => {
  const s = must(findMeeting(p.id!).summaries.find((x) => x.id === p.sid), "Summary");
  s.editedContent = body.editedContent as SummaryContent;
  return { ok: true };
});
on("POST", "/meetings/:id/decisions", (p, _q, body) => {
  const d = { id: newId("dec"), text: String(body.text ?? ""), source: "MANUAL", createdAt: now() };
  findMeeting(p.id!).decisions.push(d);
  return d;
});
on("DELETE", "/meetings/:id/decisions/:did", (p) => {
  const m = findMeeting(p.id!);
  m.decisions = m.decisions.filter((d) => d.id !== p.did);
});
on("POST", "/meetings/:id/action-items", (p, _q, body) => {
  const a = { id: newId("ai"), text: String(body.text ?? ""), suggestedOwner: null, suggestedDue: null, excerpt: null, status: "DRAFT" as const, taskId: null, source: "MANUAL" };
  findMeeting(p.id!).actionItems.push(a);
  return a;
});
on("PATCH", "/meetings/:id/action-items/:aid", (p, _q, body) => {
  const a = must(findMeeting(p.id!).actionItems.find((x) => x.id === p.aid), "Action item");
  for (const k of ["text", "status", "suggestedOwner", "suggestedDue"] as const) if (k in body) (a as unknown as Json)[k] = body[k];
  return a;
});
on("DELETE", "/meetings/:id/action-items/:aid", (p) => {
  const m = findMeeting(p.id!);
  m.actionItems = m.actionItems.filter((a) => a.id !== p.aid);
});
on("POST", "/meetings/:id/action-items/convert", (p, _q, body) => {
  const m = findMeeting(p.id!);
  const out: Array<{ itemId: string; task: TaskDto }> = [];
  for (const item of (body.items as Json[]) ?? []) {
    const a = m.actionItems.find((x) => x.id === item.id);
    if (!a) continue;
    const t = createTask(findProject(String(item.projectId ?? m.projectId ?? db().projects[0]!.id)), { title: item.title ?? a.text, assigneeId: item.assigneeId ?? null, dueDate: item.dueDate ?? null, sourceType: "MEETING", sourceId: m.id });
    a.status = "CONVERTED";
    a.taskId = t.id;
    out.push({ itemId: a.id, task: taskDto(t) });
  }
  if (out.length) record("meeting.actions_converted", "MEETING", m.id, m.title, m.projectId, { count: out.length });
  return out;
});

// ---- calendar ------------------------------------------------------------------------------------------

on("GET", "/workspaces/:id/calendar", (_p, q) => {
  const s = db();
  const from = q.from ? new Date(q.from).getTime() : -Infinity;
  const to = q.to ? new Date(q.to).getTime() : Infinity;
  const types = new Set((q.types ?? "task,meeting,milestone,event").split(","));
  const inRange = (iso: string | null) => Boolean(iso) && new Date(iso!).getTime() >= from && new Date(iso!).getTime() <= to;
  const color = (projectId: string | null) => s.projects.find((p) => p.id === projectId)?.color ?? null;
  const items: CalendarItem[] = [];
  if (types.has("task"))
    for (const t of liveTasks()) {
      if (!inRange(t.dueDate) || (q.projectId && t.projectId !== q.projectId) || (q.assigneeId && t.assigneeId !== q.assigneeId)) continue;
      const dto = taskDto(t);
      items.push({ id: t.id, kind: "task", title: t.title, start: t.dueDate!, end: null, allDay: true, projectId: t.projectId, color: color(t.projectId), assigneeId: t.assigneeId, href: href(`/tasks?task=${t.id}`), meta: { key: dto.key, status: t.status, priority: t.priority, completed: Boolean(t.completedAt), overdue: isOverdue(t) } });
    }
  if (types.has("meeting"))
    for (const m of s.meetings) {
      if (!inRange(m.startsAt) || (q.projectId && m.projectId !== q.projectId) || (q.assigneeId && !m.participants.some((x) => x.userId === q.assigneeId))) continue;
      items.push({ id: m.id, kind: "meeting", title: m.title, start: m.startsAt, end: new Date(new Date(m.startsAt).getTime() + m.durationMin * 60_000).toISOString(), allDay: false, projectId: m.projectId, color: color(m.projectId) ?? "#9B7BFF", href: href(`/meetings/${m.id}`), meta: { status: m.status } });
    }
  if (types.has("milestone") && !q.assigneeId)
    for (const ms of s.milestones) {
      if (!inRange(ms.dueDate) || (q.projectId && ms.projectId !== q.projectId)) continue;
      items.push({ id: ms.id, kind: "milestone", title: ms.title, start: ms.dueDate, end: null, allDay: true, projectId: ms.projectId, color: color(ms.projectId), href: href(`/projects/${ms.projectId}?tab=milestones`), meta: { completed: Boolean(ms.completedAt) } });
    }
  if (types.has("event") && !q.assigneeId)
    for (const e of s.events) {
      if (!inRange(e.start) || (q.projectId && e.projectId !== q.projectId)) continue;
      items.push({ id: e.id, kind: "event", title: e.title, start: e.start, end: e.end, allDay: e.allDay, projectId: e.projectId, color: "#2FB7D9", href: href("/calendar"), meta: { description: e.description } });
    }
  return items.sort((a, b) => a.start.localeCompare(b.start));
});
on("POST", "/workspaces/:id/calendar/events", (_p, _q, body) => {
  const e = { id: newId("ev"), title: String(body.title ?? "Event"), description: (body.description as string | null) ?? null, start: String(body.startsAt ?? now()), end: (body.endsAt as string | null) ?? null, allDay: Boolean(body.allDay), projectId: (body.projectId as string | null) ?? null };
  db().events.push(e);
  return e;
});
on("POST", "/workspaces/:id/calendar/reschedule", (_p, _q, body) => {
  const s = db();
  const start = String(body.start);
  if (body.kind === "task") {
    const t = findTask(String(body.id));
    t.dueDate = start;
    t.updatedAt = now();
  } else if (body.kind === "meeting") findMeeting(String(body.id)).startsAt = start;
  else if (body.kind === "milestone") must(s.milestones.find((m) => m.id === body.id), "Milestone").dueDate = start;
  else {
    const e = must(s.events.find((x) => x.id === body.id), "Event");
    e.start = start;
    e.end = (body.end as string | null) ?? e.end;
  }
  return { ok: true };
});

// ---- chat ----------------------------------------------------------------------------------------------

on("GET", "/workspaces/:id/channels", () => db().channels.filter((c) => c.type === "PUBLIC" || c.type === "PROJECT" || c.memberIds.includes(meId())).map(channelDto));
const findChannel = (id: string) => must(db().channels.find((c) => c.id === id), "Channel");
on("POST", "/channels", (_p, _q, body) => {
  const memberIds = [...new Set([meId(), ...((body.memberIds as string[]) ?? [])])];
  const type = String(body.type ?? "PUBLIC") as GuestData["channels"][number]["type"];
  if (type === "DIRECT") {
    const existing = db().channels.find((c) => c.type === "DIRECT" && c.memberIds.length === memberIds.length && memberIds.every((id) => c.memberIds.includes(id)));
    if (existing) return channelDto(existing);
  }
  const c = { id: newId("ch"), type, name: (body.name as string | null) ?? null, topic: (body.topic as string | null) ?? null, projectId: (body.projectId as string | null) ?? null, memberIds, mutedIds: [], unread: 0 };
  db().channels.push(c);
  return channelDto(c);
});
on("PATCH", "/channels/:id", (p, _q, body) => {
  const c = findChannel(p.id!);
  if ("muted" in body) c.mutedIds = body.muted ? [...new Set([...c.mutedIds, meId()])] : c.mutedIds.filter((x) => x !== meId());
  if (typeof body.name === "string") c.name = body.name;
  if ("topic" in body) c.topic = (body.topic as string | null) ?? null;
  return channelDto(c);
});
on("POST", "/channels/:id/join", (p) => {
  const c = findChannel(p.id!);
  if (!c.memberIds.includes(meId())) c.memberIds.push(meId());
  return channelDto(c);
});
on("POST", "/channels/:id/members", (p, _q, body) => {
  const c = findChannel(p.id!);
  c.memberIds = [...new Set([...c.memberIds, ...((body.userIds as string[]) ?? [])])];
  return channelDto(c);
});
on("POST", "/channels/:id/read", (p) => {
  findChannel(p.id!).unread = 0;
  return { ok: true };
});
on("GET", "/channels/:id/messages", (p, q) => {
  findChannel(p.id!);
  let list = db()
    .messages.filter((m) => m.channelId === p.id && (q.threadId ? m.parentId === q.threadId : !m.parentId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (q.before) {
    const idx = list.findIndex((m) => m.id === q.before);
    if (idx >= 0) list = list.slice(0, idx);
  }
  const limit = Number(q.limit ?? 50);
  const items = list.slice(-limit);
  return { items: items.map(messageDto), hasMore: list.length > items.length };
});
on("POST", "/channels/:id/messages", (p, _q, body) => {
  const c = findChannel(p.id!);
  const text = String(body.body ?? "");
  const m = { id: newId("msg"), channelId: c.id, authorId: meId(), parentId: (body.parentId as string | null) ?? null, body: text, mentions: mentionsIn(text), reactions: [], attachments: (body.attachments as GuestData["messages"][number]["attachments"]) ?? [], editedAt: null, deletedAt: null, createdAt: now() };
  db().messages.push(m);
  return { ...messageDto(m), clientId: body.clientId };
});
const findMessage = (id: string) => must(db().messages.find((m) => m.id === id), "Message");
on("PATCH", "/messages/:id", (p, _q, body) => {
  const m = findMessage(p.id!);
  m.body = String(body.body ?? m.body);
  m.mentions = mentionsIn(m.body);
  m.editedAt = now();
  return messageDto(m);
});
on("DELETE", "/messages/:id", (p) => {
  findMessage(p.id!).deletedAt = now();
});
function toggleReaction(list: Array<{ emoji: string; userIds: string[] }>, emoji: string) {
  const r = list.find((x) => x.emoji === emoji);
  if (!r) list.push({ emoji, userIds: [meId()] });
  else r.userIds = r.userIds.includes(meId()) ? r.userIds.filter((x) => x !== meId()) : [...r.userIds, meId()];
}
on("POST", "/messages/:id/reactions", (p, _q, body) => {
  toggleReaction(findMessage(p.id!).reactions, String(body.emoji));
  return { ok: true };
});

// ---- comments ------------------------------------------------------------------------------------------

on("GET", "/comments", (_p, q) =>
  db()
    .threads.filter((t) => t.resourceType === q.resourceType && t.resourceId === q.resourceId && (truthy(q.includeResolved) || !t.resolvedAt))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(threadDto),
);
on("POST", "/comments", (_p, _q, body) => {
  const s = db();
  const comment = { id: newId("cm"), authorId: meId(), body: String(body.body ?? ""), editedAt: null, deletedAt: null, createdAt: now(), reactions: [] };
  let thread = body.threadId ? s.threads.find((t) => t.id === body.threadId) : undefined;
  if (!thread) {
    thread = { id: newId("th"), resourceType: String(body.resourceType), resourceId: String(body.resourceId), anchor: (body.anchor as Json | null) ?? null, resolvedAt: null, resolvedById: null, createdAt: now(), updatedAt: now(), comments: [] };
    s.threads.push(thread);
  }
  thread.comments.push(comment);
  thread.updatedAt = now();
  record("comment.created", thread.resourceType, thread.resourceId, resourceTitle(thread.resourceType, thread.resourceId), null);
  return { ...commentDto(thread.id, comment), threadId: thread.id };
});
function findComment(id: string) {
  for (const t of db().threads) {
    const c = t.comments.find((x) => x.id === id);
    if (c) return c;
  }
  throw notFound("Comment");
}
on("PATCH", "/comments/:id", (p, _q, body) => {
  const c = findComment(p.id!);
  c.body = String(body.body ?? c.body);
  c.editedAt = now();
  return { ok: true };
});
on("DELETE", "/comments/:id", (p) => {
  findComment(p.id!).deletedAt = now();
});
on("POST", "/comments/:id/reactions", (p, _q, body) => {
  toggleReaction(findComment(p.id!).reactions, String(body.emoji));
  return { ok: true };
});
on("POST", "/comment-threads/:id/resolve", (p, _q, body) => {
  const t = must(db().threads.find((x) => x.id === p.id), "Thread");
  t.resolvedAt = body.resolved === false ? null : now();
  t.resolvedById = t.resolvedAt ? meId() : null;
  return { ok: true };
});
on("POST", "/comment-threads/:id/convert-to-task", (p, _q, body) => {
  const t = convertToTask(body, { type: "COMMENT", id: p.id! });
  return { key: taskDto(t).key, id: t.id };
});

// ---- notifications -------------------------------------------------------------------------------------

on("GET", "/notifications", (_p, q) => {
  const all = db().notifications;
  let list = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (truthy(q.unread)) list = list.filter((n) => !n.readAt);
  if (q.type) list = list.filter((n) => n.type === q.type);
  return { ...paginate(list.map(notificationDto), q), unread: all.filter((n) => !n.readAt).length };
});
on("PATCH", "/notifications/:id", (p, _q, body) => {
  const n = must(db().notifications.find((x) => x.id === p.id), "Notification");
  n.readAt = body.read === false ? null : now();
  return { ok: true };
});
on("POST", "/notifications/read-all", () => {
  for (const n of db().notifications) n.readAt ??= now();
  return { ok: true };
});

// ---- files ---------------------------------------------------------------------------------------------

const DOC_MIME = ["application/pdf", "text/plain", "text/markdown", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/csv"];
on("GET", "/workspaces/:id/files", (_p, q) =>
  db()
    .files.filter((f) => (truthy(q.deleted) ? f.deletedAt : !f.deletedAt))
    .filter((f) => (q.projectId ? f.projectId === q.projectId : true))
    .filter((f) => (q.q ? f.name.toLowerCase().includes(q.q.toLowerCase()) : true))
    .filter((f) => {
      if (!q.type) return true;
      if (q.type === "document") return DOC_MIME.includes(f.mimeType);
      if (q.type === "other") return !f.mimeType.startsWith("image/") && !f.mimeType.startsWith("video/") && !f.mimeType.startsWith("audio/") && !DOC_MIME.includes(f.mimeType);
      return f.mimeType.startsWith(`${q.type}/`);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fileDto),
);
/** Upload stand-in: the file stays in the browser; only its metadata is recorded. */
export function guestUpload(file: File, fields: Record<string, string | undefined>): FileAssetDto {
  const rec = { id: newId("file"), projectId: fields.projectId ?? null, name: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, uploaderId: meId(), resourceType: fields.resourceType ?? null, resourceId: fields.resourceId ?? null, altText: null, deletedAt: null, createdAt: now(), updatedAt: now() };
  if (fields.replaceFileId) {
    const existing = db().files.find((f) => f.id === fields.replaceFileId);
    if (existing) {
      Object.assign(existing, { name: rec.name, mimeType: rec.mimeType, sizeBytes: rec.sizeBytes, updatedAt: rec.updatedAt });
      return fileDto(existing);
    }
  }
  db().files.unshift(rec);
  record("file.uploaded", "FILE", rec.id, rec.name, rec.projectId);
  return fileDto(rec);
}
const findFile = (id: string) => must(db().files.find((f) => f.id === id), "File");
on("PATCH", "/files/:id", (p, _q, body) => {
  const f = findFile(p.id!);
  if (typeof body.name === "string") f.name = body.name;
  if ("altText" in body) f.altText = (body.altText as string | null) ?? null;
  return fileDto(f);
});
on("DELETE", "/files/:id", (p) => {
  findFile(p.id!).deletedAt = now();
});
on("POST", "/files/:id/restore", (p) => {
  findFile(p.id!).deletedAt = null;
  return { ok: true };
});

// ---- automation ----------------------------------------------------------------------------------------

on("GET", "/workspaces/:id/automation/rules", () => ({ rules: db().automationRules, pending: db().automationExecutions.filter((e) => e.status === "AWAITING_APPROVAL") }));
on("POST", "/workspaces/:id/automation/rules", (_p, _q, body) => {
  const rule = { id: newId("rule"), name: String(body.name ?? "New rule"), description: (body.description as string | null) ?? null, trigger: String(body.trigger ?? "task.created"), conditions: (body.conditions as unknown[]) ?? [], actions: (body.actions as Array<Json>) ?? [], enabled: body.enabled !== false, requiresApproval: Boolean(body.requiresApproval), isBuiltIn: false, createdAt: now(), _count: { executions: 0 } };
  db().automationRules.push(rule);
  return rule;
});
on("PATCH", "/automation/rules/:id", (p, _q, body) => {
  const r = must(db().automationRules.find((x) => x.id === p.id), "Rule");
  Object.assign(r, body);
  return r;
});
on("DELETE", "/automation/rules/:id", (p) => {
  db().automationRules = db().automationRules.filter((r) => r.id !== p.id);
});
on("GET", "/automation/rules/:id/executions", (p) => db().automationExecutions.filter((e) => e.ruleId === p.id));
on("POST", "/automation/executions/:id/resolve", (p, _q, body) => {
  const e = must(db().automationExecutions.find((x) => x.id === p.id), "Execution");
  e.status = body.approve ? "SUCCEEDED" : "REJECTED";
  e.finishedAt = now();
  return { ok: true };
});

// ---- templates -----------------------------------------------------------------------------------------

function templateGallery(): TemplateDto[] {
  return [
    ...CANVAS_TEMPLATES.map((t) => ({ key: t.key, kind: "CANVAS" as const, name: t.name, description: t.description, category: t.category, tags: t.tags, objectCount: buildCanvasTemplate(t.key, "p")?.objects.length ?? 0 })),
    ...DOCUMENT_TEMPLATES.map((t) => ({ key: t.key, kind: "DOCUMENT" as const, name: t.name, description: t.description, category: t.category, tags: t.tags, icon: t.icon })),
    ...PROJECT_TEMPLATES.map((t) => ({ key: t.key, kind: "PROJECT" as const, name: t.name, description: t.description, category: t.category, tags: t.tags, icon: t.icon, color: t.color, taskCount: t.tasks.length, documentCount: t.documents.length, canvasCount: t.canvasTemplateKeys.length })),
  ];
}
on("GET", "/templates", (_p, q) => {
  let items = templateGallery();
  if (q.kind) items = items.filter((t) => t.kind === q.kind);
  if (q.category) items = items.filter((t) => t.category.toLowerCase() === q.category!.toLowerCase());
  if (q.q) {
    const s = q.q.toLowerCase();
    items = items.filter((t) => t.name.toLowerCase().includes(s) || t.description.toLowerCase().includes(s) || t.tags.some((tag) => tag.includes(s)) || t.category.toLowerCase().includes(s));
  }
  return { items, categories: [...new Set(templateGallery().map((t) => t.category))].sort() };
});
on("POST", "/templates/:key/instantiate", (p, _q, body) => {
  const key = p.key!;
  const projectId = (body.projectId as string | null) ?? null;
  if (CANVAS_TEMPLATES.some((t) => t.key === key)) {
    const c = newCanvas({ title: body.title ?? CANVAS_TEMPLATES.find((t) => t.key === key)!.name, projectId, templateKey: key }, buildCanvasTemplate(key, newId("tpl")));
    db().canvases.push(c);
    return { kind: "CANVAS", id: c.id, title: c.title };
  }
  const docTpl = DOCUMENT_TEMPLATES.find((t) => t.key === key);
  if (docTpl) {
    const d = newDocument({ title: String(body.title ?? docTpl.name), icon: docTpl.icon, projectId, content: docTpl.content });
    db().documents.push(d);
    return { kind: "DOCUMENT", id: d.id, title: d.title };
  }
  const tpl = must(PROJECT_TEMPLATES.find((t) => t.key === key), "Template");
  const project = route("POST", `/workspaces/${ws().id}/projects`, {}, { name: body.title ?? tpl.name, templateKey: key }) as ProjectDto;
  return { kind: "PROJECT", id: project.id, title: project.name, boardId: project.boardId };
});

// ---- search --------------------------------------------------------------------------------------------

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function snippet(text: string, term: string): string {
  const i = text.toLowerCase().indexOf(term);
  if (i < 0) return escapeHtml(text.slice(0, 140));
  const start = Math.max(0, i - 50);
  const part = text.slice(start, i + term.length + 80);
  const j = i - start;
  return `${start > 0 ? "…" : ""}${escapeHtml(part.slice(0, j))}<mark>${escapeHtml(part.slice(j, j + term.length))}</mark>${escapeHtml(part.slice(j + term.length))}…`;
}
on("GET", "/search", (_p, q) => {
  const s = db();
  const term = (q.q ?? "").trim().toLowerCase();
  if (!term) return { hits: [], suggestions: { recent: s.recent.slice(0, 5), history: s.searchHistory.map((h) => h.query) } };
  if (!s.searchHistory.some((h) => h.query === term)) s.searchHistory.unshift({ id: newId("sh"), query: term, createdAt: now() });
  const types = q.types ? new Set(q.types.split(",").map((t) => t.toUpperCase())) : null;
  const from = q.from ? new Date(q.from).getTime() : null;
  const candidates: Array<SearchHit & { body: string; ownerId?: string }> = [
    ...s.projects.map((p) => ({ type: "PROJECT", id: p.id, title: p.name, body: p.description ?? "", snippet: "", href: href(`/projects/${p.id}`), projectId: p.id, updatedAt: p.updatedAt, rank: 0, ownerId: p.ownerId })),
    ...liveTasks().map((t) => ({ type: "TASK", id: t.id, title: t.title, body: t.description, snippet: "", href: href(`/tasks?task=${t.id}`), projectId: t.projectId, updatedAt: t.updatedAt, rank: 0, ownerId: t.reporterId, meta: { key: taskDto(t).key, status: t.status } })),
    ...s.documents.filter((d) => !d.archivedAt).map((d) => ({ type: "DOCUMENT", id: d.id, title: d.title, body: tiptapText(d.content), snippet: "", href: href(`/docs/${d.id}`), projectId: d.projectId, updatedAt: d.updatedAt, rank: 0, ownerId: d.createdById })),
    ...s.canvases.filter((c) => !c.archivedAt).map((c) => ({ type: "CANVAS", id: c.id, title: c.title, body: [c.description ?? "", ...(c.snapshot?.objects ?? []).map((o) => o.text || o.title)].join(" "), snippet: "", href: href(`/canvas/${c.id}`), projectId: c.projectId, updatedAt: c.updatedAt, rank: 0, ownerId: c.createdById })),
    ...s.meetings.map((m) => ({ type: "MEETING", id: m.id, title: m.title, body: [m.description ?? "", ...m.transcripts.map((t) => t.content)].join(" "), snippet: "", href: href(`/meetings/${m.id}`), projectId: m.projectId, updatedAt: m.startsAt, rank: 0, ownerId: m.createdById })),
    ...s.files.filter((f) => !f.deletedAt).map((f) => ({ type: "FILE", id: f.id, title: f.name, body: "", snippet: "", href: href(`/files?file=${f.id}`), projectId: f.projectId, updatedAt: f.updatedAt, rank: 0, ownerId: f.uploaderId })),
    ...s.messages.filter((m) => !m.deletedAt).map((m) => ({ type: "MESSAGE", id: m.id, title: `#${s.channels.find((c) => c.id === m.channelId)?.name ?? "conversation"} · ${userRefStrict(m.authorId).name}`, body: m.body.replace(/@\[([^\]]*)\]\([^)]+\)/g, "@$1"), snippet: "", href: href(`/chat?channel=${m.channelId}&message=${m.id}`), projectId: null, updatedAt: m.createdAt, rank: 0, ownerId: m.authorId })),
    ...s.threads.flatMap((t) => t.comments.filter((c) => !c.deletedAt).map((c) => ({ type: "COMMENT", id: c.id, title: `Comment on ${resourceTitle(t.resourceType, t.resourceId) ?? "item"}`, body: c.body.replace(/@\[([^\]]*)\]\([^)]+\)/g, "@$1"), snippet: "", href: href(t.resourceType === "DOCUMENT" ? `/docs/${t.resourceId}` : t.resourceType === "CANVAS" ? `/canvas/${t.resourceId}` : t.resourceType === "MEETING" ? `/meetings/${t.resourceId}` : t.resourceType === "PROJECT" ? `/projects/${t.resourceId}?tab=discussion` : `/tasks?task=${t.resourceId}`), projectId: null, updatedAt: c.createdAt, rank: 0, ownerId: c.authorId }))),
  ];
  const hits = candidates
    .filter((h) => (!types || types.has(h.type)) && (!q.projectId || h.projectId === q.projectId) && (!q.ownerId || h.ownerId === q.ownerId) && (!from || new Date(h.updatedAt).getTime() >= from))
    .map((h) => {
      const inTitle = h.title.toLowerCase().includes(term);
      const inBody = h.body.toLowerCase().includes(term);
      return { ...h, rank: (inTitle ? 2 : 0) + (inBody ? 1 : 0), snippet: inBody ? snippet(h.body, term) : escapeHtml(h.body.slice(0, 140)) };
    })
    .filter((h) => h.rank > 0)
    .sort((a, b) => b.rank - a.rank || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Number(q.limit ?? 20))
    .map(({ body: _body, ownerId: _owner, ...hit }) => hit);
  return { hits };
});

// ---- AI assistant --------------------------------------------------------------------------------------

on("GET", "/ai/status", () => aiStatus());
on("GET", "/ai/conversations/:id", (p) => ({ messages: db().aiConversations[p.id!] ?? [] }));
on("POST", "/ai/chat", (_p, _q, body) => {
  const s = db();
  const conversationId = (body.conversationId as string | undefined) ?? newId("conv");
  const list = (s.aiConversations[conversationId] ??= []);
  const question = String(body.message ?? "");
  list.push({ id: newId("aim"), role: "user", content: question, createdAt: now() });
  const overdue = liveTasks().filter(isOverdue);
  const mine = liveTasks().filter((t) => t.assigneeId === meId() && !t.completedAt);
  const answer = /overdue/i.test(question)
    ? overdue.length
      ? `There ${overdue.length === 1 ? "is" : "are"} ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}:\n${overdue.map((t) => `• ${taskDto(t).key} ${t.title} (${userRef(t.assigneeId)?.name ?? "unassigned"})`).join("\n")}`
      : "Nothing is overdue right now. 🎉"
    : /next|priorit|work on/i.test(question)
      ? `Your open tasks, most urgent first:\n${mine
          .sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))
          .slice(0, 5)
          .map((t) => `• ${taskDto(t).key} ${t.title}${t.dueDate ? ` — due ${new Date(t.dueDate).toLocaleDateString()}` : ""}`)
          .join("\n")}`
      : "This is guest mode, so the assistant answers from the sample data with simple rules instead of a real AI model. Try “Which tasks are overdue?” or “What should we work on next?”.";
  const message = { id: newId("aim"), role: "assistant" as const, content: answer, createdAt: now() };
  list.push(message);
  return { conversationId, message };
});
on("POST", "/ai/confirm", () => ({ ok: true }));

// ---- sharing -------------------------------------------------------------------------------------------

on("GET", "/permissions", (_p, q) => ({
  grants: db()
    .permissions.filter((g) => g.resourceType === q.resourceType && g.resourceId === q.resourceId)
    .map((g) => ({ id: g.id, userId: g.userId, level: g.level, user: userWithEmail(g.userId), grantedBy: { id: meId(), name: db().me.name }, createdAt: g.createdAt })),
  visibility: "WORKSPACE",
  ownerId: meId(),
  canManage: true,
}));
on("POST", "/permissions", (_p, _q, body) => {
  const g = { id: newId("perm"), resourceType: String(body.resourceType), resourceId: String(body.resourceId), userId: String(body.userId), level: (body.level as "EDITOR") ?? "VIEWER", createdAt: now() };
  db().permissions.push(g);
  return g;
});
on("PATCH", "/permissions/:id", (p, _q, body) => {
  const g = must(db().permissions.find((x) => x.id === p.id), "Permission");
  g.level = body.level as typeof g.level;
  return g;
});
on("DELETE", "/permissions/:id", (p) => {
  db().permissions = db().permissions.filter((g) => g.id !== p.id);
});
function shareLinkDto(l: GuestData["shareLinks"][number], withUrl = false) {
  return { id: l.id, level: l.level, requireLogin: l.requireLogin, expiresAt: l.expiresAt, revokedAt: l.revokedAt, tokenPrefix: l.tokenPrefix, accessCount: 3, lastAccessAt: l.createdAt, createdAt: l.createdAt, active: !l.revokedAt, createdBy: { id: meId(), name: db().me.name }, ...(withUrl ? { url: `${typeof location !== "undefined" ? location.origin : ""}/share/guest-demo-${l.tokenPrefix} (links don't work in guest mode)` } : {}) };
}
on("GET", "/share-links", (_p, q) => db().shareLinks.filter((l) => l.resourceType === q.resourceType && l.resourceId === q.resourceId).map((l) => shareLinkDto(l)));
on("POST", "/share-links", (_p, _q, body) => {
  const l = { id: newId("sl"), resourceType: String(body.resourceType), resourceId: String(body.resourceId), level: (body.level as "VIEWER") ?? "VIEWER", requireLogin: Boolean(body.requireLogin), expiresAt: (body.expiresAt as string | null) ?? null, revokedAt: null, createdAt: now(), tokenPrefix: Math.random().toString(36).slice(2, 6) };
  db().shareLinks.push(l);
  return shareLinkDto(l, true);
});
on("DELETE", "/share-links/:id", (p) => {
  const l = db().shareLinks.find((x) => x.id === p.id);
  if (l) l.revokedAt = now();
});
