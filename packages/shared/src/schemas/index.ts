import { z } from "zod";

// Common ---------------------------------------------------------------------

export const Id = z.string().min(1).max(64);
export const Email = z.string().trim().toLowerCase().email().max(254);
export const Password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), "Use letters and numbers");
export const Pagination = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const DateLike = z.union([z.string().datetime({ offset: true }), z.string().date(), z.date()]).transform((v) => new Date(v));
export const NullableDate = DateLike.nullable();
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ResourceTypeSchema = z.enum([
  "WORKSPACE", "PROJECT", "CANVAS", "DOCUMENT", "BOARD", "TASK", "MEETING", "FILE", "CHANNEL", "MESSAGE", "COMMENT",
]);
export const AccessLevelSchema = z.enum(["VIEWER", "COMMENTER", "EDITOR"]);
export const WorkspaceRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]);
export const VisibilitySchema = z.enum(["WORKSPACE", "PRIVATE"]);

// Auth -----------------------------------------------------------------------

export const RegisterInput = z.object({
  email: Email,
  password: Password,
  name: z.string().trim().min(1).max(80),
  inviteToken: z.string().optional(),
});
export const LoginInput = z.object({ email: Email, password: z.string().min(1).max(200) });
export const ForgotPasswordInput = z.object({ email: Email });
export const ResetPasswordInput = z.object({ token: z.string().min(10), password: Password });
export const VerifyEmailInput = z.object({ token: z.string().min(10) });
export const UpdateProfileInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  color: HexColor.optional(),
  timezone: z.string().max(64).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  onboardingDone: z.boolean().optional(),
});
export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1), newPassword: Password });
export const NotificationPrefs = z.object({
  emailMentions: z.boolean().default(true),
  emailAssignments: z.boolean().default(true),
  emailComments: z.boolean().default(false),
  emailDigest: z.boolean().default(false),
  inAppChat: z.boolean().default(true),
});

// Workspaces -----------------------------------------------------------------

export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(2).max(48).regex(/^[a-z0-9-]+$/).optional(),
  purpose: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  templateKey: z.string().optional(),
  demo: z.boolean().optional(),
});
export const UpdateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  purpose: z.string().max(200).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export const CreateInvitationInput = z.object({
  emails: z.array(Email).min(1).max(25),
  role: WorkspaceRoleSchema.exclude(["OWNER"]).default("MEMBER"),
});
export const UpdateMemberInput = z.object({ role: WorkspaceRoleSchema });

// Projects -------------------------------------------------------------------

export const CreateProjectInput = z.object({
  name: z.string().trim().min(1).max(100),
  key: z.string().trim().min(2).max(6).regex(/^[A-Z0-9]+$/).optional(),
  description: z.string().max(2000).optional(),
  color: HexColor.optional(),
  icon: z.string().max(8).optional(),
  visibility: VisibilitySchema.default("WORKSPACE"),
  startDate: NullableDate.optional(),
  dueDate: NullableDate.optional(),
  templateKey: z.string().optional(),
  memberIds: z.array(Id).max(100).optional(),
});
export const UpdateProjectInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  color: HexColor.optional(),
  icon: z.string().max(8).nullable().optional(),
  status: z.enum(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).optional(),
  visibility: VisibilitySchema.optional(),
  startDate: NullableDate.optional(),
  dueDate: NullableDate.optional(),
  ownerId: Id.optional(),
});
export const ProjectMemberInput = z.object({ userId: Id, role: z.enum(["LEAD", "MEMBER", "VIEWER"]).default("MEMBER") });
export const MilestoneInput = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).optional(),
  dueDate: DateLike,
  completedAt: NullableDate.optional(),
});

// Tasks ----------------------------------------------------------------------

export const TaskPrioritySchema = z.enum(["NONE", "LOW", "MEDIUM", "HIGH", "URGENT"]);
export const CreateTaskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20000).optional(),
  status: z.string().min(1).max(40).optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeId: Id.nullable().optional(),
  parentId: Id.nullable().optional(),
  startDate: NullableDate.optional(),
  dueDate: NullableDate.optional(),
  labelIds: z.array(Id).max(20).optional(),
  estimate: z.number().min(0).max(10000).nullable().optional(),
  position: z.number().optional(),
  source: z
    .object({ type: z.enum(["canvas-note", "doc-item", "meeting-action", "comment", "ai"]), id: z.string(), meta: z.record(z.string(), z.unknown()).optional() })
    .optional(),
});
export const UpdateTaskInput = CreateTaskInput.partial().extend({
  completed: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export const MoveTaskInput = z.object({
  status: z.string().min(1).max(40),
  beforeId: Id.nullable().optional(),
  afterId: Id.nullable().optional(),
});
export const BulkTaskInput = z.object({
  taskIds: z.array(Id).min(1).max(200),
  patch: z.object({
    status: z.string().optional(),
    priority: TaskPrioritySchema.optional(),
    assigneeId: Id.nullable().optional(),
    dueDate: NullableDate.optional(),
    addLabelIds: z.array(Id).optional(),
    archived: z.boolean().optional(),
    delete: z.boolean().optional(),
  }),
});
export const TaskDependencyInput = z.object({ dependsOnTaskId: Id, type: z.enum(["BLOCKS", "RELATES_TO"]).default("BLOCKS") });
export const TaskLabelInput = z.object({ name: z.string().trim().min(1).max(40), color: HexColor.optional() });
export const TaskQuery = z.object({
  status: z.string().optional(),
  assigneeId: z.string().optional(),
  priority: TaskPrioritySchema.optional(),
  labelId: z.string().optional(),
  q: z.string().max(200).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  includeArchived: z.coerce.boolean().optional(),
  parentId: z.string().optional(),
  sort: z.enum(["position", "dueDate", "priority", "createdAt", "updatedAt", "title"]).default("position"),
  order: z.enum(["asc", "desc"]).default("asc"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export const BoardColumnInput = z.object({
  name: z.string().trim().min(1).max(40),
  statusKey: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/),
  color: HexColor.optional(),
  isDone: z.boolean().optional(),
  wipLimit: z.number().int().min(1).max(999).nullable().optional(),
});
export const UpdateBoardInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  columns: z.array(BoardColumnInput.extend({ id: Id.optional() })).min(1).max(20).optional(),
});

// Canvases & documents --------------------------------------------------------

export const CreateCanvasInput = z.object({
  workspaceId: Id,
  projectId: Id.nullable().optional(),
  folderId: Id.nullable().optional(),
  title: z.string().trim().min(1).max(200).default("Untitled canvas"),
  description: z.string().max(1000).optional(),
  visibility: VisibilitySchema.default("WORKSPACE"),
  templateKey: z.string().optional(),
});
export const UpdateCanvasInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  projectId: Id.nullable().optional(),
  folderId: Id.nullable().optional(),
  visibility: VisibilitySchema.optional(),
  archived: z.boolean().optional(),
});
export const CreateDocumentInput = z.object({
  workspaceId: Id,
  projectId: Id.nullable().optional(),
  folderId: Id.nullable().optional(),
  title: z.string().trim().min(1).max(200).default("Untitled document"),
  icon: z.string().max(8).optional(),
  visibility: VisibilitySchema.default("WORKSPACE"),
  templateKey: z.string().optional(),
  /** Optional initial content as Tiptap JSON */
  content: z.record(z.string(), z.unknown()).optional(),
});
export const UpdateDocumentInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  icon: z.string().max(8).nullable().optional(),
  projectId: Id.nullable().optional(),
  folderId: Id.nullable().optional(),
  visibility: VisibilitySchema.optional(),
  archived: z.boolean().optional(),
});
export const CreateVersionInput = z.object({ name: z.string().trim().min(1).max(120) });
export const RestoreVersionInput = z.object({ versionId: Id });
export const FolderInput = z.object({ name: z.string().trim().min(1).max(80), parentId: Id.nullable().optional(), projectId: Id.nullable().optional() });

// Comments -------------------------------------------------------------------

export const CommentAnchor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canvas-object"), objectId: z.string() }),
  z.object({ kind: z.literal("canvas-position"), x: z.number(), y: z.number() }),
  z.object({ kind: z.literal("doc-range"), quote: z.string().max(500), from: z.number().optional(), to: z.number().optional(), markId: z.string().optional() }),
]);
export const CreateCommentInput = z.object({
  resourceType: ResourceTypeSchema,
  resourceId: Id,
  threadId: Id.optional(),
  anchor: CommentAnchor.optional(),
  body: z.string().trim().min(1).max(10000),
});
export const UpdateCommentInput = z.object({ body: z.string().trim().min(1).max(10000) });
export const ReactionInput = z.object({ emoji: z.string().min(1).max(16) });

// Meetings -------------------------------------------------------------------

export const AgendaItem = z.object({
  id: z.string(),
  title: z.string().max(200),
  durationMin: z.number().int().min(0).max(600).optional(),
  presenter: z.string().optional(),
  done: z.boolean().default(false),
});
export const CreateMeetingInput = z.object({
  workspaceId: Id,
  projectId: Id.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  startsAt: DateLike,
  durationMin: z.number().int().min(5).max(720).default(30),
  facilitatorId: Id.nullable().optional(),
  participantIds: z.array(Id).max(200).optional(),
  agenda: z.array(AgendaItem).max(100).optional(),
  linkedCanvasIds: z.array(Id).max(50).optional(),
  linkedDocumentIds: z.array(Id).max(50).optional(),
  visibility: VisibilitySchema.default("WORKSPACE"),
});
export const UpdateMeetingInput = CreateMeetingInput.omit({ workspaceId: true }).partial().extend({
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});
export const TranscriptInput = z.object({
  content: z.string().trim().min(1).max(500000),
  source: z.enum(["UPLOAD", "PASTE", "RECORDING"]).default("PASTE"),
  language: z.string().max(16).optional(),
});
export const SummarizeInput = z.object({ transcriptId: Id.optional(), includeNotes: z.boolean().default(true), consent: z.literal(true) });
export const ActionItemInput = z.object({
  text: z.string().trim().min(1).max(1000),
  suggestedOwner: z.string().max(120).nullable().optional(),
  suggestedDue: NullableDate.optional(),
  excerpt: z.string().max(2000).nullable().optional(),
});
export const ConvertActionItemsInput = z.object({
  items: z
    .array(z.object({ id: Id, title: z.string().trim().min(1).max(300), assigneeId: Id.nullable().optional(), dueDate: NullableDate.optional(), projectId: Id }))
    .min(1)
    .max(100),
});
export const DecisionInput = z.object({ text: z.string().trim().min(1).max(2000) });

// Chat -----------------------------------------------------------------------

export const CreateChannelInput = z.object({
  workspaceId: Id,
  type: z.enum(["PUBLIC", "PRIVATE", "DIRECT", "GROUP", "PROJECT", "RESOURCE"]).default("PUBLIC"),
  name: z.string().trim().min(1).max(80).optional(),
  topic: z.string().max(250).optional(),
  memberIds: z.array(Id).max(200).optional(),
  projectId: Id.optional(),
  resourceType: ResourceTypeSchema.optional(),
  resourceId: Id.optional(),
});
export const SendMessageInput = z.object({
  body: z.string().trim().min(1).max(8000),
  parentId: Id.nullable().optional(),
  attachments: z.array(z.object({ fileId: Id, name: z.string(), mimeType: z.string(), sizeBytes: z.number() })).max(10).optional(),
  clientId: z.string().max(64).optional(),
});
export const MessageQuery = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  threadId: z.string().optional(),
});

// Files ----------------------------------------------------------------------

export const RegisterUploadInput = z.object({
  workspaceId: Id,
  projectId: Id.nullable().optional(),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(1),
  resourceType: ResourceTypeSchema.optional(),
  resourceId: Id.optional(),
  altText: z.string().max(500).optional(),
});
export const UpdateFileInput = z.object({ name: z.string().trim().min(1).max(255).optional(), altText: z.string().max(500).nullable().optional(), projectId: Id.nullable().optional() });

// Sharing & permissions -------------------------------------------------------

export const CreateShareLinkInput = z.object({
  resourceType: ResourceTypeSchema,
  resourceId: Id,
  level: AccessLevelSchema.default("VIEWER"),
  requireLogin: z.boolean().default(false),
  expiresInHours: z.number().int().min(1).max(24 * 365).nullable().optional(),
});
export const GrantPermissionInput = z.object({
  resourceType: ResourceTypeSchema,
  resourceId: Id,
  userId: Id.optional(),
  email: Email.optional(),
  level: AccessLevelSchema,
});
export const UpdatePermissionInput = z.object({ level: AccessLevelSchema });

// Notifications ---------------------------------------------------------------

export const UpdateNotificationInput = z.object({ read: z.boolean() });
export const NotificationQuery = z.object({
  type: z.string().optional(),
  unread: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// Search ---------------------------------------------------------------------

export const SearchQuery = z.object({
  q: z.string().trim().max(200).default(""),
  workspaceId: Id,
  types: z.string().optional(), // comma-separated
  projectId: Id.optional(),
  ownerId: Id.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// AI -------------------------------------------------------------------------

export const AIChatInput = z.object({
  workspaceId: Id,
  conversationId: Id.optional(),
  message: z.string().trim().min(1).max(8000),
  context: z.object({ resourceType: ResourceTypeSchema, resourceId: Id }).optional(),
  projectId: Id.optional(),
});
export const AIActionDraftInput = z.object({
  workspaceId: Id,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().min(1).max(100000) }),
    z.object({ kind: z.literal("meeting"), meetingId: Id }),
    z.object({ kind: z.literal("document"), documentId: Id }),
    z.object({ kind: z.literal("canvas"), canvasId: Id }),
  ]),
  projectId: Id.optional(),
});
export const AIConfirmActionInput = z.object({ messageId: Id, actionId: z.string(), approve: z.boolean() });

// Templates & automation ------------------------------------------------------

export const InstantiateTemplateInput = z.object({
  workspaceId: Id,
  projectId: Id.nullable().optional(),
  title: z.string().trim().max(200).optional(),
});
export const AutomationRuleInput = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  trigger: z.enum(["task.assigned", "task.overdue", "task.subtasks_complete", "meeting.ended", "resource.shared", "task.status_changed"]),
  conditions: z.array(z.object({ field: z.string(), op: z.enum(["eq", "neq", "in", "contains"]), value: z.unknown() })).max(10).default([]),
  actions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("notify"), target: z.enum(["assignee", "reporter", "project_lead", "actor"]), message: z.string().max(300).optional() }),
        z.object({ type: z.literal("suggest_status"), status: z.string().max(40) }),
        z.object({ type: z.literal("set_status"), status: z.string().max(40) }),
        z.object({ type: z.literal("add_label"), labelId: Id }),
        z.object({ type: z.literal("draft_summary") }),
      ]),
    )
    .min(1)
    .max(10),
  enabled: z.boolean().default(true),
  requiresApproval: z.boolean().default(false),
});

// Calendar -------------------------------------------------------------------

export const CalendarEventInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  startsAt: DateLike,
  endsAt: DateLike,
  allDay: z.boolean().default(false),
});
export const RescheduleInput = z.object({
  kind: z.enum(["task", "meeting", "milestone", "event"]),
  id: Id,
  start: DateLike.optional(),
  end: DateLike.optional(),
  confirmConflicts: z.boolean().default(false),
});

// Favorites / recents --------------------------------------------------------

export const FavoriteInput = z.object({ resourceType: ResourceTypeSchema, resourceId: Id });
