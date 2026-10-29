/**
 * Typed fetch wrapper for the REST API. Same-origin (/api/v1 is proxied by Next.js), cookie auth,
 * consistent error shape, 401 → redirect to login.
 */
import { GUEST_MODE_ENABLED, isGuestSession } from "./guest/session";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the global 401 redirect (e.g. on the login page) */
  silent401?: boolean;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, query, silent401, headers, ...rest } = opts;
  if (GUEST_MODE_ENABLED && isGuestSession()) {
    // Guest mode (static demo): answered in the browser from sample data, no network.
    const { handleGuestRequest } = await import("./guest/mock-api");
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") q[k] = String(v);
    return handleGuestRequest<T>({ method: rest.method ?? "GET", path, query: q, body });
  }
  let url = `${BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      ...(isForm ? {} : body !== undefined ? { "content-type": "application/json" } : {}),
      "x-requested-with": "fetch",
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: { data?: T; error?: { code: string; message: string; details?: unknown } } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) throw new ApiError(res.status, "bad_response", `Request failed (${res.status})`);
  }
  if (!res.ok) {
    if (res.status === 401 && !silent401) onUnauthorized?.();
    throw new ApiError(res.status, json.error?.code ?? "error", json.error?.message ?? `Request failed (${res.status})`, json.error?.details);
  }
  return (json.data ?? (json as unknown)) as T;
}

export const get = <T,>(path: string, query?: RequestOptions["query"], opts?: RequestOptions) => api<T>(path, { ...opts, method: "GET", query });
export const post = <T,>(path: string, body?: unknown, opts?: RequestOptions) => api<T>(path, { ...opts, method: "POST", body });
export const patch = <T,>(path: string, body?: unknown, opts?: RequestOptions) => api<T>(path, { ...opts, method: "PATCH", body });
export const del = <T = void,>(path: string, opts?: RequestOptions) => api<T>(path, { ...opts, method: "DELETE" });

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    if (err.code === "validation_error" && Array.isArray(err.details)) {
      const first = (err.details as Array<{ path: string; message: string }>)[0];
      if (first) return first.path ? `${first.path}: ${first.message}` : first.message;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/** Upload a file with progress via XHR (fetch has no upload progress). */
export function uploadFile(file: File, fields: Record<string, string | undefined>, onProgress?: (pct: number) => void): Promise<FileAssetDto> & { abort: () => void } {
  if (GUEST_MODE_ENABLED && isGuestSession()) {
    // Guest mode: record the file's metadata locally; nothing is uploaded.
    const promise = import("./guest/mock-api").then((m) => {
      onProgress?.(100);
      return m.guestUpload(file, fields);
    }) as Promise<FileAssetDto> & { abort: () => void };
    promise.abort = () => {};
    return promise;
  }
  const xhr = new XMLHttpRequest();
  const promise = new Promise<FileAssetDto>((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v) form.append(k, v);
    form.append("file", file);
    xhr.open("POST", `${BASE}/files`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-requested-with", "fetch");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(json.data as FileAssetDto);
        else reject(new ApiError(xhr.status, json.error?.code ?? "upload_failed", json.error?.message ?? "Upload failed"));
      } catch {
        reject(new ApiError(xhr.status, "upload_failed", "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network", "Network error during upload"));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "Upload cancelled"));
    xhr.send(form);
  }) as Promise<FileAssetDto> & { abort: () => void };
  promise.abort = () => xhr.abort();
  return promise;
}

// ---- Shared DTO types (kept loose on purpose; the API is the source of truth) --------------------

export interface UserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  platformRole: "USER" | "ADMIN";
  emailVerified: boolean;
  onboardingDone: boolean;
  timezone?: string;
  preferences?: Record<string, unknown>;
}
export interface UserRef {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  email?: string;
}
export interface WorkspaceDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  purpose: string | null;
  ownerId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
  isDemo: boolean;
  memberCount?: number;
  projectCount?: number;
  settings?: Record<string, unknown>;
  counts?: { members: number; projects: number; canvases: number; documents: number };
}
export interface MeDto {
  user: UserDto;
  workspaces: WorkspaceDto[];
  unreadNotifications: number;
}
export interface ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  status: "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
  visibility: "WORKSPACE" | "PRIVATE";
  color: string;
  icon: string | null;
  ownerId: string;
  owner?: UserRef;
  startDate: string | null;
  dueDate: string | null;
  boardId: string | null;
  members?: Array<{ userId: string; role: string; user: UserRef }>;
  counts?: { tasks: number; documents: number; canvases: number; meetings: number };
  completedTasks?: number;
  updatedAt: string;
  createdAt: string;
  access?: string;
  dashboard?: ProjectDashboard;
  workspace?: { id: string; slug: string; name: string };
}
export interface ProjectDashboard {
  totals: { tasks: number; completed: number; overdue: number; percent: number };
  byStatus: Record<string, number>;
  workload: Array<{ user: UserRef; role: string; open: number; done: number }>;
  overdueTasks: TaskLite[];
  upcomingDeadlines: TaskLite[];
  recentActivity: ActivityDto[];
  documents: Array<{ id: string; title: string; icon: string | null; updatedAt: string }>;
  canvases: Array<{ id: string; title: string; updatedAt: string }>;
  meetings: Array<{ id: string; title: string; startsAt: string; status: string }>;
  milestones: MilestoneDto[];
}
export interface MilestoneDto {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  dueDate: string;
  completedAt: string | null;
}
export interface TaskLite {
  id: string;
  title: string;
  number: number;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  priority: string;
  assigneeId?: string | null;
}
export interface LabelDto {
  id: string;
  name: string;
  color: string;
}
export interface TaskDto {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  description: string;
  status: string;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assigneeId: string | null;
  assignee: UserRef | null;
  reporterId: string;
  reporter: UserRef;
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  position: number;
  estimate: number | null;
  labels: LabelDto[];
  blockedBy: Array<TaskLite & { type: string; projectId: string }>;
  blocking: Array<TaskLite & { type: string; projectId: string }>;
  subtaskCount: number;
  attachmentCount: number;
  blocked: boolean;
  sourceType: string | null;
  sourceId: string | null;
  sourceMeta: Record<string, unknown> | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; name: string; key: string; color: string; workspaceId: string };
}
export interface BoardColumnDto {
  id: string;
  boardId: string;
  name: string;
  statusKey: string;
  color: string;
  position: number;
  isDone: boolean;
  wipLimit: number | null;
}
export interface BoardDto {
  id: string;
  name: string;
  projectId: string;
  columns: BoardColumnDto[];
  tasks: TaskDto[];
  access: string;
  project: { id: string; name: string; key: string; color: string; workspaceId: string; workspace: { slug: string } };
}
export interface CanvasDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  visibility: "WORKSPACE" | "PRIVATE";
  createdById: string;
  createdBy?: UserRef;
  project?: { id: string; name: string; key: string; color: string } | null;
  workspace?: { id: string; slug: string; name: string };
  archivedAt: string | null;
  updatedAt: string;
  createdAt: string;
  access?: string;
  favorite?: boolean;
  templateKey?: string | null;
}
export interface DocumentDto extends Omit<CanvasDto, "description"> {
  icon: string | null;
  folder?: { id: string; name: string } | null;
  meeting?: { id: string; title: string } | null;
}
export interface VersionDto {
  id: string;
  kind: "AUTO" | "NAMED" | "RESTORE" | "PRE_RESTORE";
  name: string | null;
  authorId: string | null;
  author?: UserRef | null;
  sizeBytes: number;
  createdAt: string;
  objectCount?: number;
  preview?: string;
}
export interface CommentDto {
  id: string;
  threadId: string;
  authorId: string;
  author: UserRef;
  body: string;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: Array<{ emoji: string; userIds: string[]; count: number }>;
  mentions: Array<{ userId: string }>;
}
export interface ThreadDto {
  id: string;
  resourceType: string;
  resourceId: string;
  anchor: Record<string, unknown> | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  updatedAt: string;
  comments: CommentDto[];
}
export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
  actor: UserRef | null;
  workspace?: { id: string; slug: string; name: string } | null;
  resourceType: string | null;
  resourceId: string | null;
}
export interface ActivityDto {
  id: string;
  type: string;
  resourceType: string | null;
  resourceId: string | null;
  resourceTitle: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: UserRef | null;
  projectId?: string | null;
}
export interface ChannelDto {
  id: string;
  workspaceId: string;
  type: "PUBLIC" | "PRIVATE" | "DIRECT" | "GROUP" | "PROJECT" | "RESOURCE";
  name: string | null;
  topic: string | null;
  projectId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  members: Array<{ userId: string; muted?: boolean; user: UserRef }>;
  isMember: boolean;
  unread?: number;
  lastMessage?: { body: string; createdAt: string; author: { name: string } } | null;
  project?: { id: string; name: string; key: string; color: string } | null;
  resource?: { title: string } | null;
}
export interface MessageDto {
  id: string;
  channelId: string;
  authorId: string;
  author: UserRef;
  parentId: string | null;
  body: string;
  attachments: Array<{ fileId: string; name: string; mimeType: string; sizeBytes: number }>;
  mentions: string[];
  editedAt: string | null;
  deletedAt: string | null;
  replyCount: number;
  createdAt: string;
  reactions: Array<{ emoji: string; userIds: string[]; count: number }>;
  clientId?: string;
  pending?: boolean;
}
export interface MeetingDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  startsAt: string;
  durationMin: number;
  facilitatorId: string | null;
  facilitator: UserRef | null;
  createdById: string;
  createdBy: UserRef;
  notesDocumentId: string | null;
  notesDocument: { id: string; title: string } | null;
  agenda: Array<{ id: string; title: string; durationMin?: number; presenter?: string; done: boolean }>;
  participants: Array<{ userId: string; status: string; attended: boolean; user: UserRef }>;
  project: { id: string; name: string; key: string; color: string } | null;
  linkedCanvasIds: string[];
  linkedDocumentIds: string[];
  _count?: { transcripts: number; actionItems: number; decisions: number };
  transcripts?: Array<{ id: string; source: string; createdAt: string; preview: string; length: number; content?: string }>;
  summaries?: SummaryDto[];
  decisions?: Array<{ id: string; text: string; source: string; createdAt: string }>;
  actionItems?: ActionItemDto[];
  linked?: { canvases: Array<{ id: string; title: string }>; documents: Array<{ id: string; title: string; icon: string | null }> };
  history?: Array<{ id: string; title: string; startsAt: string; status: string }>;
  access?: string;
  ai?: AiStatus;
  workspace?: { id: string; slug: string; name: string };
}
export interface SummaryDto {
  id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  model: string | null;
  error: string | null;
  content: SummaryContent | null;
  editedContent: SummaryContent | null;
  createdAt: string;
  aiJob?: { id: string; status: string; error: string | null; attempts: number } | null;
  transcriptId: string | null;
}
export interface SummaryContent {
  recap: string;
  topics: Array<{ title: string; points: string[] }>;
  decisions: Array<{ text: string; excerpt?: string }>;
  openQuestions: Array<{ text: string; excerpt?: string }>;
  actionItems: Array<{ text: string; suggestedOwner: string | null; suggestedDue: string | null; excerpt?: string }>;
  participants?: string[];
  generatedBy: string;
}
export interface ActionItemDto {
  id: string;
  text: string;
  suggestedOwner: string | null;
  suggestedDue: string | null;
  excerpt: string | null;
  status: "DRAFT" | "APPROVED" | "REJECTED" | "CONVERTED";
  taskId: string | null;
  source: string;
  task?: { id: string; title: string; status: string; number: number; project: { key: string } } | null;
}
export interface AiStatus {
  provider: string;
  enabled: boolean;
  model: string | null;
  dataSentToProvider: string;
}
export interface FileAssetDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
  updatedAt: string;
  uploader: UserRef;
  project?: { id: string; name: string; key: string } | null;
  access?: string;
}
export interface ShareLinkDto {
  id: string;
  level: "VIEWER" | "COMMENTER" | "EDITOR";
  requireLogin: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  tokenPrefix: string;
  accessCount: number;
  lastAccessAt: string | null;
  createdAt: string;
  active: boolean;
  createdBy: { id: string; name: string };
  url?: string;
}
export interface PermissionDto {
  id: string;
  userId: string;
  level: "VIEWER" | "COMMENTER" | "EDITOR";
  user: UserRef & { email: string };
  grantedBy: { id: string; name: string } | null;
  createdAt: string;
}
export interface TemplateDto {
  key: string;
  kind: "CANVAS" | "DOCUMENT" | "PROJECT";
  name: string;
  description: string;
  category: string;
  tags: string[];
  icon?: string;
  color?: string;
  objectCount?: number;
  taskCount?: number;
  documentCount?: number;
  canvasCount?: number;
}
export interface SearchHit {
  type: string;
  id: string;
  title: string;
  snippet: string;
  href: string;
  projectId?: string | null;
  updatedAt: string;
  rank: number;
  meta?: Record<string, unknown>;
}
export interface CalendarItem {
  id: string;
  kind: "task" | "meeting" | "milestone" | "event";
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  projectId?: string | null;
  color?: string | null;
  assigneeId?: string | null;
  href: string;
  meta?: Record<string, unknown>;
}
export interface AutomationRuleDto {
  id: string;
  name: string;
  description: string | null;
  trigger: string;
  conditions: unknown[];
  actions: Array<Record<string, unknown>>;
  enabled: boolean;
  requiresApproval: boolean;
  isBuiltIn: boolean;
  createdAt: string;
  _count?: { executions: number };
}
export interface AutomationExecutionDto {
  id: string;
  ruleId: string;
  status: string;
  triggerEvent: Record<string, unknown>;
  result: unknown;
  error: string | null;
  attempts: number;
  createdAt: string;
  finishedAt: string | null;
  rule?: { id: string; name: string; actions: unknown[] };
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
