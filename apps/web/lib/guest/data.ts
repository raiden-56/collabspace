/**
 * Sample data for guest mode: one workspace ("demo-team", mirroring packages/db/prisma/seed.ts)
 * with projects, tasks, boards, documents, canvases, meetings, chat, files and activity.
 *
 * Dates are generated relative to "now" so the workspace always looks current (things due
 * tomorrow, a meeting yesterday, …). The mock API (./mock-api.ts) mutates this state in memory.
 */
import { buildCanvasTemplate, DEFAULT_BOARD_COLUMNS } from "@collabspace/shared";
import { STICKY_COLORS, type CanvasSnapshot } from "@collabspace/shared/canvas";
import type { ActionItemDto, AutomationExecutionDto, AutomationRuleDto, BoardColumnDto, LabelDto, MilestoneDto, NotificationDto, SummaryContent, UserDto, UserRef, VersionDto } from "../api";
import { GUEST_BOARD_IDS as B, GUEST_CANVAS_IDS as C, GUEST_DOCUMENT_IDS as D, GUEST_MEETING_IDS as M, GUEST_PROJECT_IDS as P, GUEST_SPARE_IDS, GUEST_USER_IDS as U, GUEST_WORKSPACE_ID, GUEST_WORKSPACE_SLUG } from "./ids";

// ---- record types (normalised; the mock API joins them into the DTO shapes) ----------------------

export type Json = Record<string, unknown>;
export type GuestUser = UserRef & { email: string };

export interface ProjectRec {
  id: string;
  name: string;
  key: string;
  description: string | null;
  status: "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
  visibility: "WORKSPACE" | "PRIVATE";
  color: string;
  icon: string | null;
  ownerId: string;
  startDate: string | null;
  dueDate: string | null;
  boardId: string;
  members: Array<{ userId: string; role: string }>;
  taskCounter: number;
  createdAt: string;
  updatedAt: string;
}
export interface BoardRec {
  id: string;
  projectId: string;
  name: string;
  columns: BoardColumnDto[];
}
export interface TaskRec {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string;
  status: string;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assigneeId: string | null;
  reporterId: string;
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  position: number;
  estimate: number | null;
  labelIds: string[];
  sourceType: string | null;
  sourceId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DependencyRec {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
}
export interface DocumentRec {
  id: string;
  title: string;
  icon: string | null;
  projectId: string | null;
  folderId: string | null;
  meetingId: string | null;
  createdById: string;
  visibility: "WORKSPACE" | "PRIVATE";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Tiptap JSON used to seed the local Yjs document */
  content: Json;
}
export interface CanvasRec {
  id: string;
  title: string;
  description: string | null;
  projectId: string | null;
  createdById: string;
  visibility: "WORKSPACE" | "PRIVATE";
  templateKey: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  snapshot: CanvasSnapshot | null;
}
export interface MeetingRec {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  startsAt: string;
  durationMin: number;
  facilitatorId: string | null;
  createdById: string;
  notesDocumentId: string | null;
  agenda: Array<{ id: string; title: string; durationMin?: number; presenter?: string; done: boolean }>;
  participants: Array<{ userId: string; status: string; attended: boolean }>;
  linkedCanvasIds: string[];
  linkedDocumentIds: string[];
  transcripts: Array<{ id: string; source: string; createdAt: string; content: string }>;
  summaries: Array<{ id: string; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"; model: string | null; content: SummaryContent | null; editedContent: SummaryContent | null; createdAt: string; transcriptId: string | null }>;
  decisions: Array<{ id: string; text: string; source: string; createdAt: string }>;
  actionItems: Array<Omit<ActionItemDto, "task">>;
}
export interface ChannelRec {
  id: string;
  type: "PUBLIC" | "PRIVATE" | "DIRECT" | "GROUP" | "PROJECT" | "RESOURCE";
  name: string | null;
  topic: string | null;
  projectId: string | null;
  memberIds: string[];
  mutedIds: string[];
  unread: number;
}
export interface MessageRec {
  id: string;
  channelId: string;
  authorId: string;
  parentId: string | null;
  body: string;
  mentions: string[];
  reactions: Array<{ emoji: string; userIds: string[] }>;
  attachments: Array<{ fileId: string; name: string; mimeType: string; sizeBytes: number }>;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}
export interface NotificationRec extends Omit<NotificationDto, "actor" | "workspace"> {
  actorId: string | null;
}
export interface ActivityRec {
  id: string;
  type: string;
  actorId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceTitle: string | null;
  payload: Record<string, unknown>;
  projectId: string | null;
  createdAt: string;
}
export interface FileRec {
  id: string;
  projectId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploaderId: string;
  resourceType: string | null;
  resourceId: string | null;
  altText: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CommentRec {
  id: string;
  authorId: string;
  body: string;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: Array<{ emoji: string; userIds: string[] }>;
}
export interface ThreadRec {
  id: string;
  resourceType: string;
  resourceId: string;
  anchor: Record<string, unknown> | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  updatedAt: string;
  comments: CommentRec[];
}
export interface CalendarEventRec {
  id: string;
  title: string;
  description: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  projectId: string | null;
}

export interface GuestData {
  me: UserDto;
  users: GuestUser[];
  workspace: { id: string; slug: string; name: string; description: string; purpose: string; ownerId: string; createdAt: string; settings: Record<string, unknown> };
  members: Array<{ id: string; userId: string; role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST"; joinedAt: string }>;
  invitations: Array<{ id: string; email: string; role: string; createdAt: string; expiresAt: string; invitedById: string }>;
  labels: LabelDto[];
  projects: ProjectRec[];
  boards: BoardRec[];
  tasks: TaskRec[];
  dependencies: DependencyRec[];
  milestones: MilestoneDto[];
  folders: Array<{ id: string; name: string; parentId: string | null }>;
  documents: DocumentRec[];
  canvases: CanvasRec[];
  meetings: MeetingRec[];
  channels: ChannelRec[];
  messages: MessageRec[];
  notifications: NotificationRec[];
  activity: ActivityRec[];
  files: FileRec[];
  threads: ThreadRec[];
  versions: Record<string, VersionDto[]>;
  events: CalendarEventRec[];
  favorites: Array<{ resourceType: string; resourceId: string; createdAt: string }>;
  recent: Array<{ resourceType: string; resourceId: string; openedAt: string }>;
  automationRules: AutomationRuleDto[];
  automationExecutions: AutomationExecutionDto[];
  searchHistory: Array<{ id: string; query: string; createdAt: string }>;
  shareLinks: Array<{ id: string; resourceType: string; resourceId: string; level: "VIEWER" | "COMMENTER" | "EDITOR"; requireLogin: boolean; expiresAt: string | null; revokedAt: string | null; createdAt: string; tokenPrefix: string }>;
  permissions: Array<{ id: string; resourceType: string; resourceId: string; userId: string; level: "VIEWER" | "COMMENTER" | "EDITOR"; createdAt: string }>;
  aiConversations: Record<string, Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>>;
  /** Unused pre-rendered IDs for resources created during the session (see ids.ts) */
  spareIds: { project: string[]; board: string[]; document: string[]; canvas: string[]; meeting: string[] };
}

// ---- helpers ---------------------------------------------------------------------------------------

/** ISO timestamp `offset` days from today at a fixed local time. */
function day(offset: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toISOString();
}
/** ISO timestamp `minutes` ago. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}
const HOUR = 60;
const DAYS = 24 * HOUR;

// Tiptap JSON builders
const txt = (text: string, bold = false): Json => ({ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const mention = (id: string, label: string): Json => ({ type: "mention", attrs: { id, label } });
const p = (...parts: Array<string | Json>): Json => ({ type: "paragraph", content: parts.filter((x) => x !== "").map((x) => (typeof x === "string" ? txt(x) : x)) });
const h = (level: number, text: string): Json => ({ type: "heading", attrs: { level }, content: [txt(text)] });
const ul = (...items: Array<string | Array<string | Json>>): Json => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [typeof t === "string" ? p(t) : p(...t)] })) });
const ol = (...items: string[]): Json => ({ type: "orderedList", attrs: { start: 1 }, content: items.map((t) => ({ type: "listItem", content: [p(t)] })) });
const todo = (...items: Array<[string, boolean]>): Json => ({ type: "taskList", content: items.map(([t, checked]) => ({ type: "taskItem", attrs: { checked }, content: [p(t)] })) });
const quote = (text: string): Json => ({ type: "blockquote", content: [p(text)] });
const doc = (...content: Json[]): Json => ({ type: "doc", content });

/** Plain text of Tiptap JSON (search snippets, version previews). */
export function tiptapText(node: Json): string {
  if (node.type === "text") return String(node.text ?? "");
  if (node.type === "mention") return `@${String((node.attrs as Json | undefined)?.label ?? "")}`;
  const children = (node.content as Json[] | undefined) ?? [];
  const inner = children.map(tiptapText).join(node.type === "doc" || node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList" ? "\n" : "");
  return inner;
}

/** Fill template canvas objects by id suffix and append extra objects. */
function canvasFrom(key: string, prefix: string, texts: Record<string, string>, extra: Json[] = [], drop: (o: Json) => boolean = () => false): CanvasSnapshot {
  const snap = buildCanvasTemplate(key, prefix)!;
  const objects = (snap.objects as unknown as Json[])
    .filter((o) => !drop(o))
    .map((o) => {
      const suffix = String(o.id).slice(prefix.length + 1);
      if (!(suffix in texts)) return o;
      return o.type === "frame" ? { ...o, title: texts[suffix] } : { ...o, text: texts[suffix] };
    });
  return { ...snap, objects: [...objects, ...extra] as unknown as CanvasSnapshot["objects"] };
}
const sticky = (id: string, text: string, x: number, y: number, color: string, parentId: string | null = null): Json => ({ id, type: "sticky", text, x, y, width: 180, height: 120, color, parentId, zIndex: 10 });
/** Stickies laid out in the template column frames (x0=80, column step 360, first row at y0+80). */
function columnStickies(prefix: string, y0: number, columns: string[][]): Json[] {
  return columns.flatMap((items, i) => items.map((text, j) => sticky(`${prefix}_x${i}_${j}`, text, 80 + i * 360 + 30 + (j % 2) * 100, y0 + 80 + j * 135, STICKY_COLORS[(i * 3 + j) % STICKY_COLORS.length]!, `${prefix}_col${i}`)));
}

// ---- the dataset -------------------------------------------------------------------------------------

export function createGuestData(): GuestData {
  const users: GuestUser[] = [
    { id: U.alice, name: "Alice Rivera", email: "alice@collabspace.local", avatarUrl: null, color: "#5B8CFF" },
    { id: U.bob, name: "Bob Chen", email: "bob@collabspace.local", avatarUrl: null, color: "#31B887" },
    { id: U.carol, name: "Carol Osei", email: "carol@collabspace.local", avatarUrl: null, color: "#F4B740" },
    { id: U.dan, name: "Dan Okafor", email: "dan@collabspace.local", avatarUrl: null, color: "#E06AB5" },
    { id: U.priya, name: "Priya Shah", email: "priya@collabspace.local", avatarUrl: null, color: "#2FB7D9" },
  ];
  const me: UserDto = {
    ...users[0]!,
    // Platform admin screens are out of scope for the demo, so the guest is a regular user (workspace owner).
    platformRole: "USER",
    emailVerified: true,
    onboardingDone: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    preferences: { emailMentions: true, emailAssignments: true, emailComments: false, emailDigest: true, inAppChat: true },
  };

  const labels: LabelDto[] = [
    { id: "l_bug", name: "bug", color: "#EF6464" },
    { id: "l_feature", name: "feature", color: "#5B8CFF" },
    { id: "l_design", name: "design", color: "#9B7BFF" },
    { id: "l_docs", name: "docs", color: "#2FB7D9" },
    { id: "l_debt", name: "tech-debt", color: "#F4B740" },
  ];
  const L = { bug: "l_bug", feature: "l_feature", design: "l_design", docs: "l_docs", debt: "l_debt" };

  const allMembers = [U.alice, U.bob, U.carol, U.dan, U.priya];
  const projects: ProjectRec[] = [
    { id: P.launch, name: "Launch CollabSpace v1", key: "LAUNCH", description: "Ship the first public release: realtime canvas, docs, tasks and meetings in one workspace.", status: "ACTIVE", visibility: "WORKSPACE", color: "#5B8CFF", icon: "🚀", ownerId: U.alice, startDate: day(-21), dueDate: day(24), boardId: B.launch, members: allMembers.map((userId) => ({ userId, role: userId === U.alice ? "LEAD" : "MEMBER" })), taskCounter: 0, createdAt: day(-21), updatedAt: ago(35) },
    { id: P.website, name: "Website redesign", key: "WEB", description: "New marketing site with clearer pricing, a docs hub and customer stories.", status: "ACTIVE", visibility: "WORKSPACE", color: "#9B7BFF", icon: "🎨", ownerId: U.carol, startDate: day(-14), dueDate: day(18), boardId: B.website, members: [U.carol, U.priya, U.alice, U.dan].map((userId) => ({ userId, role: userId === U.carol ? "LEAD" : "MEMBER" })), taskCounter: 0, createdAt: day(-14), updatedAt: ago(3 * HOUR) },
    { id: P.mobile, name: "Mobile app beta", key: "MOB", description: "iOS and Android companion app for tasks, chat and meeting notes.", status: "PLANNING", visibility: "WORKSPACE", color: "#31B887", icon: "📱", ownerId: U.bob, startDate: day(3), dueDate: day(60), boardId: B.mobile, members: [U.bob, U.dan, U.priya, U.alice].map((userId) => ({ userId, role: userId === U.bob ? "LEAD" : "MEMBER" })), taskCounter: 0, createdAt: day(-5), updatedAt: ago(1 * DAYS) },
    { id: P.onboarding, name: "Customer onboarding revamp", key: "ONB", description: "Guided setup, templates and in-app checklists for new teams.", status: "COMPLETED", visibility: "WORKSPACE", color: "#F4B740", icon: "🤝", ownerId: U.priya, startDate: day(-60), dueDate: day(-10), boardId: B.onboarding, members: [U.priya, U.alice, U.carol, U.dan].map((userId) => ({ userId, role: userId === U.priya ? "LEAD" : "MEMBER" })), taskCounter: 0, createdAt: day(-60), updatedAt: day(-10, 17) },
  ];

  const boards: BoardRec[] = projects.map((pr) => ({
    id: pr.boardId,
    projectId: pr.id,
    name: "Board",
    columns: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ id: `${pr.boardId}_${c.statusKey}`, boardId: pr.boardId, name: c.name, statusKey: c.statusKey, color: c.color, position: (i + 1) * 1000, isDone: c.isDone, wipLimit: c.statusKey === "in_progress" ? 4 : null })),
  }));

  // Tasks: [ref, title, status, priority, assignee, dueOffset, labels, extras]
  type T = [string, string, string, TaskRec["priority"], string | null, number | null, string[], Partial<TaskRec>?];
  const taskDefs: Record<string, T[]> = {
    [P.launch]: [
      ["L1", "Define scope and success metrics", "done", "HIGH", U.alice, -18, [L.docs]],
      ["L2", "Write realtime sync design doc", "done", "HIGH", U.bob, -12, [L.docs]],
      ["L3", "Set up CI pipeline", "done", "MEDIUM", U.dan, -9, [L.debt]],
      ["L4", "Implement realtime canvas sync", "in_review", "URGENT", U.bob, 1, [L.feature], { estimate: 8 }],
      ["L5", "Comments on documents and canvases", "in_progress", "HIGH", U.bob, 4, [L.feature], { estimate: 5 }],
      ["L6", "S3-compatible file storage", "in_progress", "HIGH", U.carol, -1, [L.feature], { estimate: 5, sourceType: "MEETING", sourceId: M.weeklySync }],
      ["L7", "Meeting summaries with action items", "todo", "MEDIUM", U.priya, 7, [L.feature], { estimate: 5 }],
      ["L8", "Offline support for documents", "backlog", "LOW", U.dan, null, [L.feature]],
      ["L9", "Fix cursor jitter when zoomed out", "todo", "MEDIUM", U.alice, 2, [L.bug], { estimate: 2 }],
      ["L10", "Keyboard shortcuts cheat sheet", "todo", "LOW", U.carol, 9, [L.docs]],
      ["L11", "Load test realtime service (1k concurrent users)", "todo", "HIGH", U.dan, 10, [L.debt], { estimate: 3 }],
      ["L12", "Security review and penetration test", "backlog", "HIGH", U.alice, 14, []],
      ["L13", "Write release notes", "backlog", "MEDIUM", U.priya, 20, [L.docs]],
      ["L14", "Release v1.0", "backlog", "URGENT", U.alice, 24, []],
      ["L15", "Comment threads API", "done", "MEDIUM", U.bob, -2, [L.feature], { parentId: "L5" }],
      ["L16", "Mentions and notifications in comments", "in_progress", "MEDIUM", U.bob, 4, [L.feature], { parentId: "L5" }],
      ["L17", "Signed download URLs", "todo", "MEDIUM", U.carol, 1, [L.feature], { parentId: "L6" }],
    ],
    [P.website]: [
      ["W1", "Audit current site and analytics", "done", "MEDIUM", U.carol, -10, [L.design]],
      ["W2", "New information architecture", "done", "HIGH", U.carol, -6, [L.design]],
      ["W3", "Homepage hero and illustrations", "in_progress", "HIGH", U.priya, 3, [L.design]],
      ["W4", "Pricing page with plan comparison", "in_review", "HIGH", U.alice, 0, [L.feature]],
      ["W5", "Customer stories section", "todo", "MEDIUM", U.priya, 8, []],
      ["W6", "Docs hub search", "todo", "MEDIUM", U.dan, 12, [L.feature]],
      ["W7", "Broken links on the legacy blog", "todo", "LOW", U.dan, -3, [L.bug]],
      ["W8", "Launch the new site", "backlog", "URGENT", U.carol, 18, []],
    ],
    [P.mobile]: [
      ["M1", "Pick a cross-platform framework", "in_progress", "HIGH", U.bob, 5, []],
      ["M2", "Design mobile navigation", "todo", "MEDIUM", U.priya, 10, [L.design]],
      ["M3", "Push notification service", "backlog", "MEDIUM", U.dan, 25, [L.feature]],
      ["M4", "Offline task list", "backlog", "LOW", U.bob, null, [L.feature]],
      ["M5", "TestFlight and Play Store beta setup", "backlog", "MEDIUM", U.alice, 45, []],
      ["M6", "Crash when opening task detail on Android 12", "todo", "HIGH", U.dan, 6, [L.bug]],
    ],
    [P.onboarding]: [
      ["O1", "Map the current onboarding funnel", "done", "MEDIUM", U.priya, -50, []],
      ["O2", "Template gallery for the first project", "done", "HIGH", U.alice, -35, [L.feature]],
      ["O3", "In-app setup checklist", "done", "HIGH", U.carol, -25, [L.feature]],
      ["O4", "Welcome email sequence", "done", "MEDIUM", U.priya, -18, []],
      ["O5", "Measure activation after 30 days", "done", "LOW", U.dan, -11, [L.docs]],
    ],
  };
  const descriptions: Record<string, string> = {
    L4: "Canvas objects sync through Yjs over the realtime service. Remaining: conflict handling for grouped objects and reconnect backoff.\n\nAcceptance: two browsers see each other's cursors and edits within 200 ms.",
    L5: "Threads anchored to document ranges and canvas objects, with replies, reactions, @mentions and resolve/reopen.",
    L6: "Decision from the weekly sync: S3-compatible storage. Set up the bucket, lifecycle rules for the trash and signed URLs for downloads.",
    L9: "Remote cursors jump when the zoom level is below 25%. Probably rounding in the screen-to-canvas transform.",
    L11: "Target: 1,000 concurrent users across 50 rooms, p95 sync latency under 250 ms.",
    W4: "Three plans (Free, Team, Business) with a feature comparison table and FAQ. Copy is in the brand guidelines doc.",
    M6: "Reproducible on Pixel 4a / Android 12: opening a task with attachments crashes the app. Stack trace attached in #engineering.",
  };
  const refToId = new Map<string, string>();
  const tasks: TaskRec[] = [];
  for (const pr of projects) {
    const defs = taskDefs[pr.id] ?? [];
    defs.forEach(([ref], i) => refToId.set(ref, `t_${pr.key.toLowerCase()}_${i + 1}`));
    defs.forEach(([ref, title, status, priority, assigneeId, due, labelIds, extra], i) => {
      const createdAt = day(-Math.max(1, (due ?? 10) < 0 ? -(due ?? 0) + 6 : 12 - i), 11);
      tasks.push({
        id: refToId.get(ref)!,
        projectId: pr.id,
        number: i + 1,
        title,
        description: descriptions[ref] ?? "",
        status,
        priority,
        assigneeId,
        reporterId: pr.ownerId,
        parentId: extra?.parentId ? refToId.get(extra.parentId)! : null,
        startDate: due !== null ? day(due - 5) : null,
        dueDate: due !== null ? day(due, 17) : null,
        completedAt: status === "done" ? day(Math.min(due ?? -1, -1), 15) : null,
        position: (i + 1) * 1000,
        estimate: extra?.estimate ?? null,
        labelIds,
        sourceType: extra?.sourceType ?? null,
        sourceId: extra?.sourceId ?? null,
        archivedAt: null,
        createdAt,
        updatedAt: status === "done" ? day(Math.min(due ?? -1, -1), 15) : ago((i + 1) * 97),
      });
    });
    pr.taskCounter = defs.length;
  }
  const tid = (ref: string) => refToId.get(ref)!;
  const deps: Array<[string, string]> = [["L2", "L1"], ["L4", "L2"], ["L5", "L2"], ["L11", "L4"], ["L14", "L11"], ["L14", "L12"], ["L14", "L13"], ["W8", "W3"], ["W8", "W4"], ["W8", "W5"], ["M2", "M1"]];
  const dependencies: DependencyRec[] = deps.map(([a, b], i) => ({ id: `dep_${i + 1}`, taskId: tid(a), dependsOnTaskId: tid(b) }));

  const milestones: MilestoneDto[] = [
    { id: "ms_launch_1", projectId: P.launch, title: "Design approved", description: "Design doc signed off by engineering and product.", dueDate: day(-10, 17), completedAt: day(-11, 16) },
    { id: "ms_launch_2", projectId: P.launch, title: "Feature complete", description: null, dueDate: day(10, 17), completedAt: null },
    { id: "ms_launch_3", projectId: P.launch, title: "Public release", description: "v1.0 available to everyone.", dueDate: day(24, 17), completedAt: null },
    { id: "ms_web_1", projectId: P.website, title: "Information architecture signed off", description: null, dueDate: day(-6, 17), completedAt: day(-6, 12) },
    { id: "ms_web_2", projectId: P.website, title: "New site live", description: null, dueDate: day(18, 17), completedAt: null },
    { id: "ms_mob_1", projectId: P.mobile, title: "Beta on TestFlight", description: null, dueDate: day(45, 17), completedAt: null },
    { id: "ms_onb_1", projectId: P.onboarding, title: "Rollout complete", description: null, dueDate: day(-10, 17), completedAt: day(-10, 15) },
  ];

  // ---- documents ----
  const folders = [
    { id: "f_engineering", name: "Engineering", parentId: null },
    { id: "f_marketing", name: "Marketing", parentId: null },
    { id: "f_meetings", name: "Meeting notes", parentId: null },
  ];
  const d = (id: string, title: string, icon: string, projectId: string | null, folderId: string | null, createdById: string, updatedMinAgo: number, content: Json, meetingId: string | null = null): DocumentRec => ({ id, title, icon, projectId, folderId, meetingId, createdById, visibility: "WORKSPACE", archivedAt: null, createdAt: ago(updatedMinAgo + 9 * DAYS), updatedAt: ago(updatedMinAgo), content });
  const documents: DocumentRec[] = [
    d(D.designDoc, "Realtime sync design doc", "📐", P.launch, "f_engineering", U.bob, 2 * HOUR, doc(
      h(1, "Realtime sync design doc"),
      p(txt("Status: ", true), "Approved · ", txt("Owner: ", true), mention(U.bob, "Bob Chen"), " · ", txt("Reviewers: ", true), mention(U.alice, "Alice Rivera"), ", ", mention(U.dan, "Dan Okafor")),
      h(2, "Problem"),
      p("Teams bounce between a whiteboard tool, a docs tool and a task tracker. Context gets lost at every hop, and nothing updates live. CollabSpace needs canvases and documents that several people can edit at the same time, including while briefly offline."),
      h(2, "Goals and non-goals"),
      ul("Edits from other people appear in under 200 ms on a good connection", "Edits made offline are kept and merged when the connection returns", "Presence: live cursors, selections and who is viewing", [txt("Non-goal: ", true), "end-to-end encryption in v1"]),
      h(2, "Proposed design"),
      p("Every canvas and document is a ", txt("Yjs", true), " document. Clients connect to the sync service over a WebSocket per room (", txt("canvas:<id>"), " or ", txt("document:<id>"), "). The service authenticates the session cookie, loads the latest snapshot from PostgreSQL, and fans out updates through Redis pub/sub so any node can serve any room."),
      ol("Client loads the cached copy from IndexedDB and renders immediately", "WebSocket sync step 1/2 exchanges state vectors and missing updates", "Updates are persisted every few seconds and compacted into snapshots", "Awareness (cursors, selection) is broadcast but never stored"),
      quote("Rule of thumb: the server is the source of truth for permissions, never for merge results — CRDTs merge on every client the same way."),
      h(2, "Alternatives considered"),
      ul("Operational transforms (ShareDB): mature, but needs a central server for every merge and has no offline story", "Last-write-wins JSON patches: simple, but loses concurrent edits on the same object"),
      h(2, "Risks and open questions"),
      todo(["Measure memory per room with 200 objects and 20 editors", true], ["Decide snapshot compaction interval", true], ["Do we need offline support in the first release?", false], ["Rate-limit awareness updates on slow connections", false]),
    )),
    d(D.releaseChecklist, "v1.0 release checklist", "🚀", P.launch, "f_engineering", U.alice, 5 * HOUR, doc(
      h(1, "v1.0 release checklist"),
      p("Target date: three and a half weeks from now. Owner: ", mention(U.alice, "Alice Rivera")),
      h(2, "Quality"),
      todo(["All end-to-end tests green on main", true], ["Load test passes (1k concurrent users)", false], ["Security review findings resolved", false], ["Accessibility audit (keyboard + screen reader)", true]),
      h(2, "Operations"),
      todo(["Database migration plan reviewed", true], ["Rollback plan documented", false], ["Dashboards and alerts for sync latency", false]),
      h(2, "Communication"),
      todo(["Changelog and release notes", false], ["Launch blog post scheduled", false], ["Customer success briefed", false]),
    )),
    d(D.launchBrief, "Launch brief", "📣", P.launch, "f_marketing", U.priya, 1 * DAYS, doc(
      h(1, "Launch brief"),
      h(2, "Audience"),
      p("Product and engineering teams of 5–50 people who already run planning on a whiteboard and track work somewhere else."),
      h(2, "Key messages"),
      ul("Think visually, work collaboratively, ship faster", "One workspace for canvases, docs, tasks and meetings — all live", "Meeting notes that turn into tasks automatically"),
      h(2, "Channels"),
      ul("Launch blog post and changelog", "Email to beta customers and wait-list", "Product Hunt + social", "Webinar: “From whiteboard to shipped” in week 2"),
      h(2, "Timeline"),
      p("T-14 messaging final · T-7 assets ready · T-0 go live · T+7 webinar"),
    )),
    d(D.brandGuide, "Brand and voice guidelines", "🎨", P.website, "f_marketing", U.carol, 3 * DAYS, doc(
      h(1, "Brand and voice guidelines"),
      h(2, "Voice"),
      ul("Plain and confident — say what the product does", "Friendly, never cute", "Show, don't tell: use real screenshots"),
      h(2, "Colors"),
      p("Primary blue #5B8CFF, violet #9B7BFF, success green #31B887. Use a light surface (#F7F8FC) with generous spacing."),
      h(2, "Pricing page copy"),
      p(txt("Free", true), " — for small teams getting started. ", txt("Team", true), " — unlimited canvases and docs, meeting summaries. ", txt("Business", true), " — SSO, audit logs and advanced permissions."),
    )),
    d(D.betaPlan, "Mobile beta test plan", "🧪", P.mobile, null, U.bob, 2 * DAYS, doc(
      h(1, "Mobile beta test plan"),
      p("Goal: 50 testers from 10 customer teams using the app daily for two weeks."),
      h(2, "What we test"),
      ul("Task list and task detail, including offline edits", "Chat with push notifications", "Read-only canvases with pinch-to-zoom"),
      h(2, "Success criteria"),
      todo(["Crash-free sessions above 99.5%", false], ["Median cold start under 2 s", false], ["At least 60% weekly retention among testers", false]),
    )),
    d(D.handbook, "Team handbook", "📘", null, null, U.alice, 8 * DAYS, doc(
      h(1, "Team handbook"),
      h(2, "How we work"),
      p("We plan on canvases, write decisions in docs and track execution in tasks. Every meeting has notes; every decision has an owner."),
      h(2, "Rituals"),
      ul("Monday: weekly product sync (30 min)", "Every other Tuesday: sprint planning", "Friday: demo and retro"),
      h(2, "Tools"),
      ul("CollabSpace for everything above", "GitHub for code review", "On-call rotation in the engineering channel"),
    )),
    d(D.syncNotes, "Weekly product sync — notes", "📝", P.launch, "f_meetings", U.alice, 1 * DAYS - 40, doc(
      h(1, "Weekly product sync"),
      p("Attendees: ", mention(U.alice, "Alice Rivera"), ", ", mention(U.bob, "Bob Chen"), ", ", mention(U.carol, "Carol Osei")),
      h(2, "Progress"),
      ul("Canvas prototype syncs between two browsers", "Document editor done except comments", "CI runs in under 6 minutes"),
      h(2, "Decisions"),
      ul("Ship canvas and documents first; comments follow next sprint", "Use S3-compatible storage for files"),
      h(2, "Action items"),
      todo(["Carol — set up the storage bucket by Friday", true], ["Bob — comments design doc by Wednesday", false], ["Alice — decide on offline support for v1", false]),
    ), M.weeklySync),
    d(D.designReviewNotes, "Homepage design review — notes", "📝", P.website, "f_meetings", U.carol, 3 * DAYS - 60, doc(
      h(1, "Homepage design review"),
      h(2, "Feedback"),
      ul("Hero illustration reads well on desktop, too busy on mobile", "Pricing link should be visible above the fold", "Customer logos: ask for permission before using them"),
      h(2, "Next steps"),
      todo(["Priya — simplified mobile hero", false], ["Alice — pricing page ready for review", true]),
    ), M.designReview),
    d(D.planningNotes, "Sprint 14 planning — notes", "📝", P.launch, "f_meetings", U.alice, 4 * HOUR, doc(
      h(1, "Sprint 14 planning"),
      p("Sprint goal: comments and file storage are production-ready."),
      h(2, "Candidates"),
      ul("Comments on documents and canvases (LAUNCH-5)", "S3-compatible file storage (LAUNCH-6)", "Load test realtime service (LAUNCH-11)"),
      h(2, "Capacity"),
      p("4 engineers × 9 days, minus on-call: about 30 points."),
    ), M.sprintPlanning),
  ];

  // ---- canvases ----
  const brainstorm = canvasFrom(
    "canvas.brainstorm",
    "bs",
    { title: "Brainstorm: what makes v1 lovable?" },
    columnStickies("bs", 120, [
      ["Live cursors with names", "Templates for every ritual", "Turn any sticky into a task"],
      ["Do we need offline in v1?", "How do guests comment?"],
      ["Meeting notes → action items → tasks", "Slash commands everywhere"],
      ["Native mobile app", "Video calls"],
    ]),
    (o) => typeof o.text === "string" && o.text.startsWith("Example idea"),
  );
  const retro = canvasFrom(
    "canvas.retro",
    "rt",
    { title: "Sprint 13 retrospective" },
    columnStickies("rt", 120, [
      ["Canvas sync demo went great 🎉", "CI is twice as fast"],
      ["Too many meetings mid-sprint", "Flaky e2e test in chat"],
      ["Pair on tricky Yjs bugs", "Record demo videos"],
      ["Dan: quarantine flaky tests", "Alice: no-meeting Wednesdays"],
    ]),
  );
  const roadmap = canvasFrom("canvas.roadmap", "rm", {
    title: "Product roadmap 2026",
    i0_0: "Realtime canvas + docs",
    i1_0: "Public API & webhooks",
    i2_0: "Self-hosting",
    i0_1: "New website & pricing",
    i1_1: "Template marketplace",
    i2_1: "Partner integrations",
    i0_2: "Load testing",
    i1_2: "Offline support",
    i2_2: "Mobile apps",
  });
  const architecture = canvasFrom("canvas.architecture", "ar", {});
  const signup = canvasFrom("canvas.flowchart", "sf", { start: "Visit pricing page", step1: "Enter work email", dec: "Email verified?", step2: "Create first workspace", fix: "Resend verification", end: "Onboarding checklist" });
  const cv = (id: string, title: string, description: string | null, projectId: string | null, createdById: string, templateKey: string, updatedMinAgo: number, snapshot: CanvasSnapshot): CanvasRec => ({ id, title, description, projectId, createdById, visibility: "WORKSPACE", templateKey, archivedAt: null, createdAt: ago(updatedMinAgo + 6 * DAYS), updatedAt: ago(updatedMinAgo), snapshot });
  const canvases: CanvasRec[] = [
    cv(C.brainstorm, "Feature brainstorm", "Ideas for the v1 launch, grouped by theme.", P.launch, U.alice, "canvas.brainstorm", 50, brainstorm),
    cv(C.architecture, "System architecture", "Clients, services and data stores for the realtime stack.", P.launch, U.bob, "canvas.architecture", 6 * HOUR, architecture),
    cv(C.roadmap, "Product roadmap 2026", "Now / next / later by theme.", null, U.alice, "canvas.roadmap", 2 * DAYS, roadmap),
    cv(C.retro, "Sprint 13 retro", null, P.launch, U.carol, "canvas.retro", 4 * DAYS, retro),
    cv(C.signupFlow, "Signup flow", "Happy path and error handling for self-serve signup.", P.website, U.priya, "canvas.flowchart", 5 * DAYS, signup),
  ];

  // ---- meetings ----
  const syncTranscript = [
    "Alice: Thanks for joining. Quick round of updates — the canvas prototype now syncs between two browsers.",
    "Bob: The document editor is mostly done; comments are still missing.",
    "Alice: Decision: we ship canvas and documents first, comments follow next sprint.",
    "Carol: Blocker — we need a decision on file storage by Friday.",
    "Alice: Decision: S3-compatible storage. Carol, can you set up the bucket by Friday?",
    "Carol: Yes, I'll take that.",
    "Bob: I'll write the comments design doc by Wednesday.",
    "Alice: Open question: do we need offline support in the first release?",
    "Bob: Let's look at the usage data from the beta before deciding.",
  ].join("\n");
  const syncSummary: SummaryContent = {
    recap: "The team reviewed progress on the v1 launch. Canvas sync works across browsers and the document editor is nearly complete. Two decisions were made: ship canvas and documents before comments, and use S3-compatible storage for files. Offline support for v1 is still open.",
    topics: [
      { title: "Progress", points: ["Canvas prototype syncs between two browsers", "Document editor done except comments"] },
      { title: "Blockers", points: ["File storage decision needed by Friday — resolved in the meeting"] },
      { title: "Scope", points: ["Comments move to next sprint", "Offline support needs beta usage data"] },
    ],
    decisions: [
      { text: "Ship canvas and documents first; comments follow next sprint.", excerpt: "Alice: Decision: we ship canvas and documents first, comments follow next sprint." },
      { text: "Use S3-compatible storage for files.", excerpt: "Alice: Decision: S3-compatible storage." },
    ],
    openQuestions: [{ text: "Do we need offline support in the first release?", excerpt: "Alice: Open question: do we need offline support in the first release?" }],
    actionItems: [
      { text: "Set up the storage bucket", suggestedOwner: "Carol", suggestedDue: day(2, 17), excerpt: "Carol, can you set up the bucket by Friday?" },
      { text: "Write the comments design doc", suggestedOwner: "Bob", suggestedDue: day(1, 17), excerpt: "Bob: I'll write the comments design doc by Wednesday." },
      { text: "Pull beta usage data on offline sessions", suggestedOwner: "Bob", suggestedDue: null, excerpt: "Let's look at the usage data from the beta before deciding." },
    ],
    participants: ["Alice Rivera", "Bob Chen", "Carol Osei"],
    generatedBy: "demo-summarizer",
  };
  const reviewSummary: SummaryContent = {
    recap: "Carol walked through the new homepage. The hero works on desktop but is too busy on mobile, and pricing needs to be visible above the fold. The team agreed to ship the pricing page before the customer stories section.",
    topics: [{ title: "Homepage", points: ["Hero illustration too busy on small screens", "Pricing link above the fold"] }, { title: "Content", points: ["Customer logos need written permission"] }],
    decisions: [{ text: "Pricing page ships before customer stories.", excerpt: "Carol: Let's get pricing out first, stories can follow a week later." }],
    openQuestions: [{ text: "Which three customers can we feature?", excerpt: "Priya: Which customers would agree to be featured?" }],
    actionItems: [
      { text: "Simplify the mobile hero illustration", suggestedOwner: "Priya", suggestedDue: day(3, 17), excerpt: "Priya: I'll do a simpler version for mobile." },
      { text: "Ask three customers for logo permission", suggestedOwner: "Carol", suggestedDue: day(5, 17), excerpt: "Carol: I'll reach out to Northwind and two others." },
    ],
    participants: ["Carol Osei", "Priya Shah", "Alice Rivera", "Dan Okafor"],
    generatedBy: "demo-summarizer",
  };
  const meetingBase = { linkedCanvasIds: [] as string[], linkedDocumentIds: [] as string[], transcripts: [] as MeetingRec["transcripts"], summaries: [] as MeetingRec["summaries"], decisions: [] as MeetingRec["decisions"], actionItems: [] as MeetingRec["actionItems"] };
  const meetings: MeetingRec[] = [
    {
      ...meetingBase,
      id: M.weeklySync,
      projectId: P.launch,
      title: "Weekly product sync",
      description: "Progress, blockers and next steps for the v1 launch.",
      status: "COMPLETED",
      startsAt: day(-1, 10),
      durationMin: 30,
      facilitatorId: U.alice,
      createdById: U.alice,
      notesDocumentId: D.syncNotes,
      agenda: [{ id: "a1", title: "Progress", durationMin: 10, presenter: "Bob", done: true }, { id: "a2", title: "Blockers", durationMin: 10, done: true }, { id: "a3", title: "Next steps", durationMin: 10, done: true }],
      participants: [{ userId: U.alice, status: "ACCEPTED", attended: true }, { userId: U.bob, status: "ACCEPTED", attended: true }, { userId: U.carol, status: "ACCEPTED", attended: true }, { userId: U.priya, status: "TENTATIVE", attended: false }],
      linkedCanvasIds: [C.brainstorm],
      linkedDocumentIds: [D.designDoc],
      transcripts: [{ id: "tr_sync", source: "PASTE", createdAt: day(-1, 10, 35), content: syncTranscript }],
      summaries: [{ id: "sum_sync", status: "COMPLETED", model: "demo-summarizer", content: syncSummary, editedContent: null, createdAt: day(-1, 10, 36), transcriptId: "tr_sync" }],
      decisions: [
        { id: "dec_sync_1", text: "Ship canvas and documents first; comments follow next sprint.", source: "AI", createdAt: day(-1, 10, 36) },
        { id: "dec_sync_2", text: "Use S3-compatible storage for files.", source: "AI", createdAt: day(-1, 10, 36) },
      ],
      actionItems: [
        { id: "ai_sync_1", text: "Set up the storage bucket", suggestedOwner: "Carol", suggestedDue: day(2, 17), excerpt: "Carol, can you set up the bucket by Friday?", status: "CONVERTED", taskId: "t_launch_6", source: "AI" },
        { id: "ai_sync_2", text: "Write the comments design doc", suggestedOwner: "Bob", suggestedDue: day(1, 17), excerpt: "Bob: I'll write the comments design doc by Wednesday.", status: "APPROVED", taskId: null, source: "AI" },
        { id: "ai_sync_3", text: "Pull beta usage data on offline sessions", suggestedOwner: "Bob", suggestedDue: null, excerpt: "Let's look at the usage data from the beta before deciding.", status: "DRAFT", taskId: null, source: "AI" },
      ],
    },
    {
      ...meetingBase,
      id: M.designReview,
      projectId: P.website,
      title: "Homepage design review",
      description: "Review the new homepage and pricing page designs.",
      status: "COMPLETED",
      startsAt: day(-3, 14),
      durationMin: 45,
      facilitatorId: U.carol,
      createdById: U.carol,
      notesDocumentId: D.designReviewNotes,
      agenda: [{ id: "a1", title: "Homepage walkthrough", presenter: "Carol", done: true }, { id: "a2", title: "Pricing page", presenter: "Alice", done: true }, { id: "a3", title: "Customer stories", done: true }],
      participants: [{ userId: U.carol, status: "ACCEPTED", attended: true }, { userId: U.priya, status: "ACCEPTED", attended: true }, { userId: U.alice, status: "ACCEPTED", attended: true }, { userId: U.dan, status: "ACCEPTED", attended: true }],
      linkedCanvasIds: [C.signupFlow],
      linkedDocumentIds: [D.brandGuide],
      transcripts: [{ id: "tr_review", source: "UPLOAD", createdAt: day(-3, 14, 50), content: "Carol: Here's the new homepage.\nPriya: The hero is lovely on desktop, a bit busy on my phone. I'll do a simpler version for mobile.\nAlice: Can we get pricing above the fold?\nCarol: Let's get pricing out first, stories can follow a week later.\nPriya: Which customers would agree to be featured?\nCarol: I'll reach out to Northwind and two others." }],
      summaries: [{ id: "sum_review", status: "COMPLETED", model: "demo-summarizer", content: reviewSummary, editedContent: null, createdAt: day(-3, 14, 52), transcriptId: "tr_review" }],
      decisions: [{ id: "dec_review_1", text: "Pricing page ships before customer stories.", source: "AI", createdAt: day(-3, 14, 52) }],
      actionItems: [
        { id: "ai_review_1", text: "Simplify the mobile hero illustration", suggestedOwner: "Priya", suggestedDue: day(3, 17), excerpt: "Priya: I'll do a simpler version for mobile.", status: "DRAFT", taskId: null, source: "AI" },
        { id: "ai_review_2", text: "Ask three customers for logo permission", suggestedOwner: "Carol", suggestedDue: day(5, 17), excerpt: "Carol: I'll reach out to Northwind and two others.", status: "DRAFT", taskId: null, source: "AI" },
      ],
    },
    {
      ...meetingBase,
      id: M.sprintPlanning,
      projectId: P.launch,
      title: "Sprint 14 planning",
      description: "Pick the sprint goal and commit to the backlog.",
      status: "SCHEDULED",
      startsAt: day(1, 10),
      durationMin: 60,
      facilitatorId: U.alice,
      createdById: U.alice,
      notesDocumentId: D.planningNotes,
      agenda: [{ id: "a1", title: "Sprint 13 review", durationMin: 10, done: false }, { id: "a2", title: "Sprint goal", durationMin: 10, presenter: "Alice", done: false }, { id: "a3", title: "Capacity and commitments", durationMin: 30, done: false }, { id: "a4", title: "Risks", durationMin: 10, done: false }],
      participants: allMembers.map((userId, i) => ({ userId, status: i === 4 ? "PENDING" : "ACCEPTED", attended: false })),
      linkedCanvasIds: [C.retro],
    },
    {
      ...meetingBase,
      id: M.customerInterview,
      projectId: null,
      title: "Customer interview — Northwind",
      description: "How Northwind's design team runs critiques today; validate the template gallery.",
      status: "SCHEDULED",
      startsAt: day(2, 15, 30),
      durationMin: 30,
      facilitatorId: U.priya,
      createdById: U.priya,
      notesDocumentId: null,
      agenda: [{ id: "a1", title: "Current workflow", done: false }, { id: "a2", title: "Template gallery walkthrough", done: false }, { id: "a3", title: "Wrap-up", done: false }],
      participants: [{ userId: U.priya, status: "ACCEPTED", attended: false }, { userId: U.alice, status: "PENDING", attended: false }],
    },
    {
      ...meetingBase,
      id: M.goNoGo,
      projectId: P.launch,
      title: "v1.0 go / no-go",
      description: "Final check against the release checklist.",
      status: "SCHEDULED",
      startsAt: day(6, 16),
      durationMin: 30,
      facilitatorId: U.alice,
      createdById: U.alice,
      notesDocumentId: null,
      agenda: [{ id: "a1", title: "Release checklist", done: false }, { id: "a2", title: "Open risks", done: false }, { id: "a3", title: "Decision", done: false }],
      participants: [U.alice, U.bob, U.dan].map((userId) => ({ userId, status: "ACCEPTED", attended: false })),
      linkedDocumentIds: [D.releaseChecklist],
    },
  ];

  // ---- chat ----
  const channels: ChannelRec[] = [
    { id: "ch_general", type: "PUBLIC", name: "general", topic: "Team-wide discussion", projectId: null, memberIds: allMembers, mutedIds: [], unread: 0 },
    { id: "ch_engineering", type: "PUBLIC", name: "engineering", topic: "Builds, deploys and code reviews", projectId: null, memberIds: [U.alice, U.bob, U.dan], mutedIds: [], unread: 2 },
    { id: "ch_design", type: "PUBLIC", name: "design", topic: "Critiques and inspiration", projectId: null, memberIds: [U.carol, U.priya, U.bob], mutedIds: [], unread: 0 },
    { id: "ch_launch", type: "PROJECT", name: "launch", topic: "Everything about the v1 launch", projectId: P.launch, memberIds: allMembers, mutedIds: [], unread: 0 },
    { id: "ch_dm_bob", type: "DIRECT", name: null, topic: null, projectId: null, memberIds: [U.alice, U.bob], mutedIds: [], unread: 1 },
    { id: "ch_group_web", type: "GROUP", name: null, topic: null, projectId: null, memberIds: [U.alice, U.carol, U.priya], mutedIds: [], unread: 0 },
  ];
  let mi = 0;
  const msg = (channelId: string, authorId: string, minutesAgo: number, body: string, extra: Partial<MessageRec> = {}): MessageRec => ({ id: `msg_${++mi}`, channelId, authorId, parentId: null, body, mentions: [], reactions: [], attachments: [], editedAt: null, deletedAt: null, createdAt: ago(minutesAgo), ...extra });
  const messages: MessageRec[] = [
    msg("ch_general", U.alice, 3 * DAYS, "Welcome to the demo workspace! 👋 Open the brainstorm canvas in two windows to see live cursors."),
    msg("ch_general", U.bob, 3 * DAYS - 12, `Thanks @[Alice Rivera](${U.alice}) — I'll start on the design doc.`, { mentions: [U.alice], reactions: [{ emoji: "👍", userIds: [U.alice, U.carol] }] }),
    msg("ch_general", U.priya, 1 * DAYS + 3 * HOUR, "Reminder: customer interview with Northwind on Thursday. Notes will go in the meetings tab."),
    msg("ch_general", U.carol, 1 * DAYS + 2 * HOUR, "New homepage designs are up for review 🎨 — see the website project.", { reactions: [{ emoji: "🎉", userIds: [U.alice, U.priya, U.dan] }] }),
    msg("ch_general", U.dan, 4 * HOUR, "Heads-up: staging deploy at 3pm, expect a minute of downtime."),
    msg("ch_general", U.alice, 3 * HOUR, "Great week everyone. Sprint 14 planning is tomorrow at 10 — please skim the retro canvas first."),
    msg("ch_engineering", U.dan, 6 * HOUR, "CI is down to 5m40s after caching the pnpm store 🚀", { reactions: [{ emoji: "🚀", userIds: [U.bob, U.alice] }] }),
    msg("ch_engineering", U.bob, 5 * HOUR, "Canvas sync PR is ready for review: conflict handling for grouped objects + reconnect backoff."),
    msg("ch_engineering", U.alice, 4 * HOUR, "Reviewing now. One question about awareness throttling — left a comment."),
    msg("ch_engineering", U.dan, 50, "Seeing the Android 12 crash again in the beta build, stack trace in the task."),
    msg("ch_engineering", U.bob, 25, `@[Alice Rivera](${U.alice}) can you take a look at the cursor jitter bug when you get a chance? I think it's the zoom transform.`, { mentions: [U.alice] }),
    msg("ch_design", U.carol, 2 * DAYS, "Moodboard for the new site is on the brand guidelines doc."),
    msg("ch_design", U.priya, 2 * DAYS - 30, "Love the softer blues. I'll try a lighter hero for mobile."),
    msg("ch_launch", U.alice, 2 * DAYS, "Launch date is locked: see the release checklist. Go/no-go meeting next week."),
    msg("ch_launch", U.priya, 2 * DAYS - 45, "Launch brief is ready for comments 📣"),
    msg("ch_launch", U.carol, 1 * DAYS, "Storage bucket is set up; signed URLs next."),
    msg("ch_dm_bob", U.bob, 2 * HOUR, "Hey! Do you have 10 minutes after lunch to pair on the cursor transform?"),
    msg("ch_dm_bob", U.alice, 110, "Sure — 1:30?"),
    msg("ch_dm_bob", U.bob, 100, "Perfect 👍"),
    msg("ch_group_web", U.carol, 1 * DAYS, "Pricing page review moved to tomorrow, OK for you two?"),
    msg("ch_group_web", U.priya, 1 * DAYS - 20, "Works for me."),
  ];
  const engReview = messages.find((m) => m.body.startsWith("Canvas sync PR"))!;
  messages.push(
    msg("ch_engineering", U.alice, 4 * HOUR - 20, "Left two comments. Looks good otherwise!", { parentId: engReview.id }),
    msg("ch_engineering", U.bob, 4 * HOUR - 35, "Addressed both, thanks 🙏", { parentId: engReview.id }),
  );

  // ---- notifications ----
  const notif = (id: string, type: string, actorId: string | null, title: string, body: string | null, href: string | null, minutesAgo: number, read: boolean, resourceType: string | null = null, resourceId: string | null = null): NotificationRec => ({ id, type, actorId, title, body, href, readAt: read ? ago(minutesAgo - 5) : null, createdAt: ago(minutesAgo), resourceType, resourceId });
  const ws = `/app/${GUEST_WORKSPACE_SLUG}`;
  const notifications: NotificationRec[] = [
    notif("n1", "MENTION", U.bob, "Bob Chen mentioned you in #engineering", "can you take a look at the cursor jitter bug when you get a chance?", `${ws}/chat?channel=ch_engineering`, 25, false, "CHANNEL", "ch_engineering"),
    notif("n2", "TASK_ASSIGNED", U.carol, "Carol Osei assigned you “Pricing page with plan comparison”", "Website redesign · due today", `${ws}/tasks?task=t_web_4`, 2 * HOUR, false, "TASK", "t_web_4"),
    notif("n3", "COMMENT", U.dan, "Dan Okafor commented on Realtime sync design doc", "Should we cap awareness updates at 10/s per client?", `${ws}/docs/${D.designDoc}`, 3 * HOUR, false, "DOCUMENT", D.designDoc),
    notif("n4", "MEETING_INVITE", U.priya, "Priya Shah invited you to Customer interview — Northwind", null, `${ws}/meetings/${M.customerInterview}`, 5 * HOUR, false, "MEETING", M.customerInterview),
    notif("n5", "TASK_DUE", null, "“Fix cursor jitter when zoomed out” is due in 2 days", null, `${ws}/tasks?task=t_launch_9`, 1 * DAYS, true, "TASK", "t_launch_9"),
    notif("n6", "MEETING_SUMMARY", null, "Summary ready: Weekly product sync", "2 decisions · 3 action items", `${ws}/meetings/${M.weeklySync}`, 1 * DAYS - 30, true, "MEETING", M.weeklySync),
    notif("n7", "TASK_STATUS", U.dan, "Dan Okafor moved “Set up CI pipeline” to Done", null, `${ws}/tasks?task=t_launch_3`, 3 * DAYS, true, "TASK", "t_launch_3"),
    notif("n8", "PROJECT_UPDATE", U.carol, "Carol Osei updated Website redesign", "Information architecture signed off", `${ws}/projects/${P.website}`, 4 * DAYS, true, "PROJECT", P.website),
    notif("n9", "SHARE_ACCESS", U.priya, "Priya Shah shared Launch brief with you", null, `${ws}/docs/${D.launchBrief}`, 6 * DAYS, true, "DOCUMENT", D.launchBrief),
  ];

  // ---- activity ----
  let ai = 0;
  const act = (type: string, actorId: string, minutesAgo: number, resourceType: string | null, resourceId: string | null, resourceTitle: string | null, projectId: string | null, payload: Record<string, unknown> = {}): ActivityRec => ({ id: `act_${++ai}`, type, actorId, resourceType, resourceId, resourceTitle, payload, projectId, createdAt: ago(minutesAgo) });
  const activity: ActivityRec[] = [
    act("canvas.updated", U.alice, 50, "CANVAS", C.brainstorm, "Feature brainstorm", P.launch),
    act("task.status", U.bob, 70, "TASK", "t_launch_4", "Implement realtime canvas sync", P.launch, { to: "in_review" }),
    act("document.updated", U.bob, 2 * HOUR, "DOCUMENT", D.designDoc, "Realtime sync design doc", P.launch),
    act("task.assignee", U.carol, 2 * HOUR + 5, "TASK", "t_web_4", "Pricing page with plan comparison", P.website, { to: U.alice }),
    act("comment.created", U.dan, 3 * HOUR, "DOCUMENT", D.designDoc, "Realtime sync design doc", P.launch),
    act("document.created", U.alice, 4 * HOUR, "DOCUMENT", D.planningNotes, "Sprint 14 planning — notes", P.launch),
    act("meeting.created", U.priya, 5 * HOUR, "MEETING", M.customerInterview, "Customer interview — Northwind", null),
    act("task.status", U.priya, 7 * HOUR, "TASK", "t_web_3", "Homepage hero and illustrations", P.website, { to: "in_progress" }),
    act("file.uploaded", U.dan, 9 * HOUR, "FILE", "file_burndown", "Sprint 13 burndown.csv", P.launch),
    act("meeting.actions_converted", U.alice, 1 * DAYS - 20, "MEETING", M.weeklySync, "Weekly product sync", P.launch, { count: 1 }),
    act("task.created", U.alice, 1 * DAYS - 19, "TASK", "t_launch_6", "S3-compatible file storage", P.launch),
    act("document.updated", U.priya, 1 * DAYS, "DOCUMENT", D.launchBrief, "Launch brief", P.launch),
    act("canvas.created", U.bob, 6 * DAYS, "CANVAS", C.architecture, "System architecture", P.launch),
    act("document.updated", U.carol, 3 * DAYS, "DOCUMENT", D.brandGuide, "Brand and voice guidelines", P.website),
    act("canvas.updated", U.carol, 4 * DAYS, "CANVAS", C.retro, "Sprint 13 retro", P.launch),
    act("project.updated", U.carol, 4 * DAYS + 30, "PROJECT", P.website, "Website redesign", P.website),
    act("canvas.created", U.priya, 5 * DAYS, "CANVAS", C.signupFlow, "Signup flow", P.website),
    act("project.created", U.bob, 5 * DAYS + 60, "PROJECT", P.mobile, "Mobile app beta", P.mobile),
    act("share.granted", U.priya, 6 * DAYS, "DOCUMENT", D.launchBrief, "Launch brief", P.launch),
    act("member.joined", U.priya, 20 * DAYS, null, null, null, null),
    act("project.created", U.alice, 21 * DAYS, "PROJECT", P.launch, "Launch CollabSpace v1", P.launch),
    act("member.joined", U.dan, 22 * DAYS, null, null, null, null),
  ];
  // A steady trickle of completed-task events over the last weeks for the analytics charts.
  for (const t of tasks) if (t.completedAt) activity.push(act("task.completed", t.assigneeId ?? U.alice, Math.max(1, (Date.now() - new Date(t.completedAt).getTime()) / 60_000), "TASK", t.id, t.title, t.projectId));
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ---- files (no images: the static site has no file server to show previews from) ----
  const file = (id: string, name: string, mimeType: string, sizeBytes: number, projectId: string | null, uploaderId: string, minutesAgo: number, deleted = false): FileRec => ({ id, projectId, name, mimeType, sizeBytes, uploaderId, resourceType: null, resourceId: null, altText: null, deletedAt: deleted ? ago(minutesAgo - 60) : null, createdAt: ago(minutesAgo), updatedAt: ago(minutesAgo) });
  const files: FileRec[] = [
    file("file_roadmap_pdf", "Q3 roadmap.pdf", "application/pdf", 2_457_600, P.launch, U.alice, 2 * DAYS),
    file("file_pricing_xlsx", "Pricing comparison.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 84_211, P.website, U.carol, 3 * DAYS),
    file("file_brand_pdf", "Brand guidelines v2.pdf", "application/pdf", 6_812_004, P.website, U.carol, 4 * DAYS),
    file("file_burndown", "Sprint 13 burndown.csv", "text/csv", 3_912, P.launch, U.dan, 9 * HOUR),
    file("file_interview_docx", "Customer interview guide.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 41_220, null, U.priya, 1 * DAYS),
    file("file_investor_pptx", "Investor update — October.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 5_244_880, null, U.alice, 7 * DAYS),
    file("file_walkthrough_mp4", "Onboarding walkthrough.mp4", "video/mp4", 48_903_112, P.onboarding, U.priya, 15 * DAYS),
    file("file_standup_m4a", "Standup recording.m4a", "audio/mp4", 7_340_032, P.launch, U.bob, 2 * DAYS),
    file("file_release_md", "RELEASE_NOTES_DRAFT.md", "text/markdown", 6_120, P.launch, U.priya, 20 * HOUR),
    file("file_old_logo", "old-logo.ai", "application/postscript", 1_204_224, P.website, U.carol, 9 * DAYS, true),
  ];

  // ---- comments ----
  const thread = (id: string, resourceType: string, resourceId: string, anchor: Record<string, unknown> | null, comments: Array<[string, string, number]>, resolved = false): ThreadRec => ({
    id,
    resourceType,
    resourceId,
    anchor,
    resolvedAt: resolved ? ago(comments[comments.length - 1]![2] - 10) : null,
    resolvedById: resolved ? U.alice : null,
    createdAt: ago(comments[0]![2]),
    updatedAt: ago(comments[comments.length - 1]![2]),
    comments: comments.map(([authorId, body, m], i) => ({ id: `${id}_c${i + 1}`, authorId, body, editedAt: null, deletedAt: null, createdAt: ago(m), reactions: i === 0 ? [{ emoji: "👍", userIds: [U.alice] }] : [] })),
  });
  const threads: ThreadRec[] = [
    thread("th_doc_1", "DOCUMENT", D.designDoc, { kind: "doc-range", quote: "fans out updates through Redis pub/sub" }, [[U.dan, "Should we cap awareness updates at 10/s per client? Cursor spam on slow networks hurt us in the prototype.", 3 * HOUR], [U.bob, `Good call @[Dan Okafor](${U.dan}) — added it to the open questions.`, 2 * HOUR]]),
    thread("th_doc_2", "DOCUMENT", D.designDoc, { kind: "doc-range", quote: "Operational transforms (ShareDB)" }, [[U.alice, "Can we link the benchmark we ran against ShareDB?", 2 * DAYS]], true),
    thread("th_canvas_1", "CANVAS", C.brainstorm, { kind: "canvas-position", x: 980, y: 260 }, [[U.carol, "Love this column — can we vote on these in planning?", 90], [U.alice, "Yes! Let's dot-vote tomorrow.", 60]]),
    thread("th_project_1", "PROJECT", P.launch, null, [[U.alice, "Reminder: feature freeze is 10 days out. Anything not in review by then moves to v1.1.", 1 * DAYS], [U.bob, "Comments will make it 💪", 1 * DAYS - 30]]),
    thread("th_task_1", "TASK", "t_launch_4", null, [[U.alice, "Tested in two browsers and on a slow 3G profile — works nicely.", 80]]),
    thread("th_meeting_1", "MEETING", M.weeklySync, null, [[U.bob, "Comments design doc is up, linked from the project.", 6 * HOUR]]),
  ];

  // ---- versions ----
  const versions: Record<string, VersionDto[]> = {};
  for (const document of documents) {
    const text = tiptapText(document.content).replace(/\s+/g, " ").slice(0, 160);
    versions[`document:${document.id}`] = [
      { id: `v_${document.id}_3`, kind: "AUTO", name: null, authorId: document.createdById, author: users.find((u) => u.id === document.createdById) ?? null, sizeBytes: 5_400, createdAt: document.updatedAt, preview: text },
      { id: `v_${document.id}_2`, kind: "NAMED", name: "Ready for review", authorId: document.createdById, author: users.find((u) => u.id === document.createdById) ?? null, sizeBytes: 4_900, createdAt: ago(2 * DAYS + 120), preview: text },
      { id: `v_${document.id}_1`, kind: "AUTO", name: null, authorId: document.createdById, author: users.find((u) => u.id === document.createdById) ?? null, sizeBytes: 1_200, createdAt: document.createdAt, preview: text.slice(0, 60) },
    ];
  }
  for (const canvas of canvases) {
    const count = canvas.snapshot?.objects.length ?? 0;
    versions[`canvas:${canvas.id}`] = [
      { id: `v_${canvas.id}_2`, kind: "AUTO", name: null, authorId: canvas.createdById, author: users.find((u) => u.id === canvas.createdById) ?? null, sizeBytes: 9_800, createdAt: canvas.updatedAt, objectCount: count },
      { id: `v_${canvas.id}_1`, kind: "NAMED", name: "First draft", authorId: canvas.createdById, author: users.find((u) => u.id === canvas.createdById) ?? null, sizeBytes: 6_100, createdAt: canvas.createdAt, objectCount: Math.max(1, count - 4) },
    ];
  }

  const events: CalendarEventRec[] = [
    { id: "ev_offsite", title: "Team offsite", description: "Planning day at the lake house.", start: day(9, 0), end: day(10, 0), allDay: true, projectId: null },
    { id: "ev_webinar", title: "Webinar: From whiteboard to shipped", description: null, start: day(13, 17), end: day(13, 18), allDay: false, projectId: P.launch },
    { id: "ev_demo", title: "Friday demo", description: "Show what shipped this week.", start: day(4, 16), end: day(4, 16, 30), allDay: false, projectId: null },
  ];

  const rule = (id: string, name: string, description: string, trigger: string, actions: Array<Record<string, unknown>>, enabled: boolean, isBuiltIn: boolean, executions: number, requiresApproval = false): AutomationRuleDto => ({ id, name, description, trigger, conditions: [], actions, enabled, requiresApproval, isBuiltIn, createdAt: day(-20), _count: { executions } });
  const automationRules: AutomationRuleDto[] = [
    rule("rule_due", "Remind assignees before due dates", "Notify the assignee 24 hours before a task is due.", "task.due_soon", [{ type: "notify", to: "assignee" }], true, true, 42),
    rule("rule_done", "Close subtasks with their parent", "When a task moves to Done, complete its open subtasks.", "task.completed", [{ type: "complete_subtasks" }], true, true, 7),
    rule("rule_meeting", "Create tasks from approved action items", "Approved meeting action items become tasks in the meeting's project.", "meeting.action_item_approved", [{ type: "create_task" }], true, false, 3, true),
    rule("rule_bug", "Triage new bugs", "Tasks labelled “bug” get High priority and go to To Do.", "task.labeled", [{ type: "set_priority", priority: "HIGH" }, { type: "move", status: "todo" }], false, false, 0),
  ];
  const automationExecutions: AutomationExecutionDto[] = [
    { id: "exec_1", ruleId: "rule_meeting", status: "AWAITING_APPROVAL", triggerEvent: { trigger: "meeting.action_item_approved", resourceTitle: "Write the comments design doc" }, result: null, error: null, attempts: 0, createdAt: ago(20 * HOUR), finishedAt: null, rule: { id: "rule_meeting", name: "Create tasks from approved action items", actions: [{ type: "create_task" }] } },
    { id: "exec_2", ruleId: "rule_due", status: "SUCCEEDED", triggerEvent: { trigger: "task.due_soon", resourceTitle: "Fix cursor jitter when zoomed out" }, result: { notified: 1 }, error: null, attempts: 1, createdAt: ago(1 * DAYS), finishedAt: ago(1 * DAYS), rule: { id: "rule_due", name: "Remind assignees before due dates", actions: [{ type: "notify" }] } },
    { id: "exec_3", ruleId: "rule_done", status: "SUCCEEDED", triggerEvent: { trigger: "task.completed", resourceTitle: "Set up CI pipeline" }, result: { completed: 0 }, error: null, attempts: 1, createdAt: ago(3 * DAYS), finishedAt: ago(3 * DAYS), rule: { id: "rule_done", name: "Close subtasks with their parent", actions: [{ type: "complete_subtasks" }] } },
  ];

  return {
    me,
    users,
    workspace: { id: GUEST_WORKSPACE_ID, slug: GUEST_WORKSPACE_SLUG, name: "Product Team (Demo)", description: "Sample workspace for exploring CollabSpace in guest mode. Everything here is dummy data.", purpose: "Product development", ownerId: U.alice, createdAt: day(-30), settings: { defaultProjectVisibility: "WORKSPACE", allowGuests: true } },
    members: [
      { id: "mem_alice", userId: U.alice, role: "OWNER", joinedAt: day(-30) },
      { id: "mem_bob", userId: U.bob, role: "ADMIN", joinedAt: day(-29) },
      { id: "mem_carol", userId: U.carol, role: "MEMBER", joinedAt: day(-29) },
      { id: "mem_dan", userId: U.dan, role: "MEMBER", joinedAt: day(-22) },
      { id: "mem_priya", userId: U.priya, role: "MEMBER", joinedAt: day(-20) },
    ],
    invitations: [{ id: "inv_1", email: "sam@northwind.example", role: "GUEST", createdAt: ago(2 * DAYS), expiresAt: day(5), invitedById: U.priya }],
    labels,
    projects,
    boards,
    tasks,
    dependencies,
    milestones,
    folders,
    documents,
    canvases,
    meetings,
    channels,
    messages,
    notifications,
    activity,
    files,
    threads,
    versions,
    events,
    favorites: [
      { resourceType: "PROJECT", resourceId: P.launch, createdAt: day(-10) },
      { resourceType: "CANVAS", resourceId: C.brainstorm, createdAt: day(-5) },
      { resourceType: "DOCUMENT", resourceId: D.designDoc, createdAt: day(-4) },
      { resourceType: "MEETING", resourceId: M.weeklySync, createdAt: day(-1) },
    ],
    recent: [
      { resourceType: "CANVAS", resourceId: C.brainstorm, openedAt: ago(45) },
      { resourceType: "DOCUMENT", resourceId: D.designDoc, openedAt: ago(2 * HOUR) },
      { resourceType: "PROJECT", resourceId: P.launch, openedAt: ago(3 * HOUR) },
      { resourceType: "MEETING", resourceId: M.weeklySync, openedAt: ago(20 * HOUR) },
      { resourceType: "DOCUMENT", resourceId: D.releaseChecklist, openedAt: ago(1 * DAYS) },
      { resourceType: "PROJECT", resourceId: P.website, openedAt: ago(2 * DAYS) },
      { resourceType: "CANVAS", resourceId: C.roadmap, openedAt: ago(3 * DAYS) },
      { resourceType: "DOCUMENT", resourceId: D.launchBrief, openedAt: ago(4 * DAYS) },
    ],
    automationRules,
    automationExecutions,
    searchHistory: [
      { id: "sh_1", query: "storage", createdAt: ago(5 * HOUR) },
      { id: "sh_2", query: "pricing", createdAt: ago(1 * DAYS) },
    ],
    shareLinks: [{ id: "sl_1", resourceType: "DOCUMENT", resourceId: D.launchBrief, level: "COMMENTER", requireLogin: false, expiresAt: day(14), revokedAt: null, createdAt: ago(6 * DAYS), tokenPrefix: "k3f9" }],
    permissions: [{ id: "perm_1", resourceType: "DOCUMENT", resourceId: D.launchBrief, userId: U.carol, level: "EDITOR", createdAt: ago(6 * DAYS) }],
    aiConversations: {},
    spareIds: { project: [...GUEST_SPARE_IDS.project], board: [...GUEST_SPARE_IDS.board], document: [...GUEST_SPARE_IDS.document], canvas: [...GUEST_SPARE_IDS.canvas], meeting: [...GUEST_SPARE_IDS.meeting] },
  };
}
