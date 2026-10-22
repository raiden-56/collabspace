import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import * as S from "@collabspace/shared";

/**
 * OpenAPI 3.1 document for the REST API. Request schemas are the same Zod schemas used for validation,
 * so the documentation can't drift from what the server accepts.
 */
export const registry = new OpenAPIRegistry();

const bearer = registry.registerComponent("securitySchemes", "sessionCookie", { type: "apiKey", in: "cookie", name: "cs_session" });

const ErrorResponse = z.object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }) });
const Envelope = (inner: z.ZodTypeAny) => z.object({ data: inner });
const Any = z.record(z.string(), z.unknown());
const Page = z.object({ items: z.array(Any), nextCursor: z.string().nullable() });

type Method = "get" | "post" | "patch" | "put" | "delete";

function op(method: Method, path: string, tag: string, summary: string, opts: { body?: z.ZodTypeAny; query?: z.ZodTypeAny; response?: z.ZodTypeAny; auth?: boolean; status?: number } = {}) {
  registry.registerPath({
    method,
    path,
    tags: [tag],
    summary,
    security: opts.auth === false ? [] : [{ [bearer.name]: [] }],
    request: {
      ...(opts.body ? { body: { content: { "application/json": { schema: opts.body } } } } : {}),
      ...(opts.query ? { query: opts.query as z.ZodObject<z.ZodRawShape> } : {}),
    },
    responses: {
      [opts.status ?? 200]: { description: "Success", content: { "application/json": { schema: opts.response ?? Envelope(Any) } } },
      400: { description: "Validation error", content: { "application/json": { schema: ErrorResponse } } },
      401: { description: "Unauthenticated", content: { "application/json": { schema: ErrorResponse } } },
      403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponse } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
    },
  });
}

// Auth
op("post", "/api/v1/auth/register", "Auth", "Register with email and password", { body: S.RegisterInput, auth: false, status: 201 });
op("post", "/api/v1/auth/login", "Auth", "Log in", { body: S.LoginInput, auth: false });
op("post", "/api/v1/auth/logout", "Auth", "Log out (revokes the current session)");
op("get", "/api/v1/auth/me", "Auth", "Current user and memberships");
op("post", "/api/v1/auth/forgot-password", "Auth", "Request a password reset email", { body: S.ForgotPasswordInput, auth: false });
op("post", "/api/v1/auth/reset-password", "Auth", "Reset password with token", { body: S.ResetPasswordInput, auth: false });
op("post", "/api/v1/auth/verify-email", "Auth", "Verify email with token", { body: S.VerifyEmailInput, auth: false });
op("post", "/api/v1/auth/resend-verification", "Auth", "Resend verification email");
op("get", "/api/v1/auth/sessions", "Auth", "List active sessions");
op("delete", "/api/v1/auth/sessions/{sessionId}", "Auth", "Revoke a session");
op("patch", "/api/v1/users/me", "Users", "Update profile", { body: S.UpdateProfileInput });
op("post", "/api/v1/users/me/password", "Users", "Change password", { body: S.ChangePasswordInput });

// Workspaces
op("get", "/api/v1/workspaces", "Workspaces", "List my workspaces");
op("post", "/api/v1/workspaces", "Workspaces", "Create a workspace", { body: S.CreateWorkspaceInput, status: 201 });
op("get", "/api/v1/workspaces/{workspaceId}", "Workspaces", "Get a workspace (id or slug)");
op("patch", "/api/v1/workspaces/{workspaceId}", "Workspaces", "Update a workspace", { body: S.UpdateWorkspaceInput });
op("get", "/api/v1/workspaces/{workspaceId}/members", "Workspaces", "List members");
op("patch", "/api/v1/workspaces/{workspaceId}/members/{userId}", "Workspaces", "Change a member role", { body: S.UpdateMemberInput });
op("delete", "/api/v1/workspaces/{workspaceId}/members/{userId}", "Workspaces", "Remove a member");
op("post", "/api/v1/workspaces/{workspaceId}/invitations", "Workspaces", "Invite by email", { body: S.CreateInvitationInput, status: 201 });
op("get", "/api/v1/workspaces/{workspaceId}/invitations", "Workspaces", "List pending invitations");
op("get", "/api/v1/invitations/{token}", "Workspaces", "Preview an invitation", { auth: false });
op("post", "/api/v1/invitations/{token}/accept", "Workspaces", "Accept an invitation");
op("get", "/api/v1/workspaces/{workspaceId}/overview", "Workspaces", "Workspace overview metrics");
op("get", "/api/v1/workspaces/{workspaceId}/activity", "Workspaces", "Workspace activity feed", { query: S.Pagination, response: Envelope(Page) });
op("get", "/api/v1/workspaces/{workspaceId}/analytics", "Workspaces", "Workspace analytics");

// Projects & tasks
op("get", "/api/v1/workspaces/{workspaceId}/projects", "Projects", "List projects");
op("post", "/api/v1/workspaces/{workspaceId}/projects", "Projects", "Create a project (optionally from a template)", { body: S.CreateProjectInput, status: 201 });
op("get", "/api/v1/projects/{projectId}", "Projects", "Get project with dashboard metrics");
op("patch", "/api/v1/projects/{projectId}", "Projects", "Update a project", { body: S.UpdateProjectInput });
op("delete", "/api/v1/projects/{projectId}", "Projects", "Archive/delete a project");
op("post", "/api/v1/projects/{projectId}/members", "Projects", "Add a project member", { body: S.ProjectMemberInput });
op("get", "/api/v1/projects/{projectId}/tasks", "Tasks", "List tasks", { query: S.TaskQuery });
op("post", "/api/v1/projects/{projectId}/tasks", "Tasks", "Create a task", { body: S.CreateTaskInput, status: 201 });
op("get", "/api/v1/tasks/{taskId}", "Tasks", "Get a task");
op("patch", "/api/v1/tasks/{taskId}", "Tasks", "Update a task", { body: S.UpdateTaskInput });
op("post", "/api/v1/tasks/{taskId}/move", "Tasks", "Move a task (status + ordering)", { body: S.MoveTaskInput });
op("delete", "/api/v1/tasks/{taskId}", "Tasks", "Delete a task");
op("post", "/api/v1/tasks/{taskId}/dependencies", "Tasks", "Add a dependency", { body: S.TaskDependencyInput });
op("delete", "/api/v1/tasks/{taskId}/dependencies/{dependsOnTaskId}", "Tasks", "Remove a dependency");
op("post", "/api/v1/workspaces/{workspaceId}/tasks/bulk", "Tasks", "Bulk update tasks", { body: S.BulkTaskInput });
op("get", "/api/v1/workspaces/{workspaceId}/tasks", "Tasks", "Tasks across the workspace (My Tasks, calendar, timeline)", { query: S.TaskQuery });
op("get", "/api/v1/boards/{boardId}", "Boards", "Get a board with columns");
op("patch", "/api/v1/boards/{boardId}", "Boards", "Update board columns", { body: S.UpdateBoardInput });

// Canvases & documents
op("post", "/api/v1/canvases", "Canvases", "Create a canvas", { body: S.CreateCanvasInput, status: 201 });
op("get", "/api/v1/canvases/{canvasId}", "Canvases", "Get a canvas");
op("patch", "/api/v1/canvases/{canvasId}", "Canvases", "Update a canvas", { body: S.UpdateCanvasInput });
op("get", "/api/v1/canvases/{canvasId}/versions", "Canvases", "List versions");
op("post", "/api/v1/canvases/{canvasId}/versions", "Canvases", "Create a named checkpoint", { body: S.CreateVersionInput });
op("post", "/api/v1/canvases/{canvasId}/restore", "Canvases", "Restore a version", { body: S.RestoreVersionInput });
op("post", "/api/v1/documents", "Documents", "Create a document", { body: S.CreateDocumentInput, status: 201 });
op("get", "/api/v1/documents/{documentId}", "Documents", "Get a document");
op("patch", "/api/v1/documents/{documentId}", "Documents", "Update a document", { body: S.UpdateDocumentInput });
op("get", "/api/v1/documents/{documentId}/versions", "Documents", "List versions");
op("post", "/api/v1/documents/{documentId}/versions", "Documents", "Create a named checkpoint", { body: S.CreateVersionInput });
op("get", "/api/v1/documents/{documentId}/versions/{versionId}", "Documents", "Preview a version");
op("post", "/api/v1/documents/{documentId}/restore", "Documents", "Restore a version", { body: S.RestoreVersionInput });

// Comments & notifications
op("get", "/api/v1/comments", "Comments", "List threads for a resource", { query: z.object({ resourceType: S.ResourceTypeSchema, resourceId: z.string() }) });
op("post", "/api/v1/comments", "Comments", "Create a comment (new thread or reply)", { body: S.CreateCommentInput, status: 201 });
op("patch", "/api/v1/comments/{commentId}", "Comments", "Edit a comment", { body: S.UpdateCommentInput });
op("delete", "/api/v1/comments/{commentId}", "Comments", "Delete a comment");
op("post", "/api/v1/comments/{commentId}/reactions", "Comments", "Toggle a reaction", { body: S.ReactionInput });
op("post", "/api/v1/comment-threads/{threadId}/resolve", "Comments", "Resolve or reopen a thread", { body: z.object({ resolved: z.boolean() }) });
op("get", "/api/v1/notifications", "Notifications", "List notifications", { query: S.NotificationQuery });
op("patch", "/api/v1/notifications/{notificationId}", "Notifications", "Mark read/unread", { body: S.UpdateNotificationInput });
op("post", "/api/v1/notifications/read-all", "Notifications", "Mark all as read");

// Meetings & AI
op("get", "/api/v1/workspaces/{workspaceId}/meetings", "Meetings", "List meetings");
op("post", "/api/v1/meetings", "Meetings", "Create a meeting", { body: S.CreateMeetingInput, status: 201 });
op("get", "/api/v1/meetings/{meetingId}", "Meetings", "Get a meeting workspace");
op("patch", "/api/v1/meetings/{meetingId}", "Meetings", "Update a meeting", { body: S.UpdateMeetingInput });
op("post", "/api/v1/meetings/{meetingId}/transcripts", "Meetings", "Upload or paste a transcript", { body: S.TranscriptInput, status: 201 });
op("post", "/api/v1/meetings/{meetingId}/summarize", "Meetings", "Generate an AI summary (async job)", { body: S.SummarizeInput, status: 202 });
op("post", "/api/v1/meetings/{meetingId}/action-items/convert", "Meetings", "Convert reviewed action items into tasks", { body: S.ConvertActionItemsInput });
op("post", "/api/v1/ai/chat", "AI", "Contextual workspace assistant", { body: S.AIChatInput });
op("post", "/api/v1/ai/action-drafts", "AI", "Draft action items from text or a resource", { body: S.AIActionDraftInput });
op("post", "/api/v1/ai/confirm", "AI", "Approve or reject a proposed AI action", { body: S.AIConfirmActionInput });
op("get", "/api/v1/ai/jobs/{jobId}", "AI", "Get AI job status");

// Search, sharing, files
op("get", "/api/v1/search", "Search", "Permission-aware workspace search", { query: S.SearchQuery });
op("post", "/api/v1/share-links", "Sharing", "Create a share link", { body: S.CreateShareLinkInput, status: 201 });
op("get", "/api/v1/share-links", "Sharing", "List share links for a resource", { query: z.object({ resourceType: S.ResourceTypeSchema, resourceId: z.string() }) });
op("delete", "/api/v1/share-links/{shareLinkId}", "Sharing", "Revoke a share link");
op("get", "/api/v1/shared/{token}", "Sharing", "Resolve a share token", { auth: false });
op("post", "/api/v1/permissions", "Sharing", "Grant resource access to a user", { body: S.GrantPermissionInput });
op("get", "/api/v1/permissions", "Sharing", "List grants for a resource", { query: z.object({ resourceType: S.ResourceTypeSchema, resourceId: z.string() }) });
op("delete", "/api/v1/permissions/{permissionId}", "Sharing", "Revoke a grant");
op("post", "/api/v1/files", "Files", "Upload a file (multipart/form-data)", { status: 201 });
op("get", "/api/v1/files/{fileId}", "Files", "File metadata");
op("get", "/api/v1/files/{fileId}/download", "Files", "Download (signed URL redirect or stream)");
op("get", "/api/v1/workspaces/{workspaceId}/files", "Files", "List files");

// Chat
op("get", "/api/v1/workspaces/{workspaceId}/channels", "Chat", "List channels I can see");
op("post", "/api/v1/channels", "Chat", "Create a channel / DM / group", { body: S.CreateChannelInput, status: 201 });
op("get", "/api/v1/channels/{channelId}/messages", "Chat", "Paginated messages", { query: S.MessageQuery });
op("post", "/api/v1/channels/{channelId}/messages", "Chat", "Send a message", { body: S.SendMessageInput, status: 201 });
op("patch", "/api/v1/messages/{messageId}", "Chat", "Edit a message", { body: z.object({ body: z.string() }) });
op("delete", "/api/v1/messages/{messageId}", "Chat", "Delete a message");
op("post", "/api/v1/messages/{messageId}/reactions", "Chat", "Toggle a reaction", { body: S.ReactionInput });

// Templates, automation, calendar, admin
op("get", "/api/v1/templates", "Templates", "Template gallery", { auth: true });
op("post", "/api/v1/templates/{key}/instantiate", "Templates", "Create a resource from a template", { body: S.InstantiateTemplateInput, status: 201 });
op("get", "/api/v1/workspaces/{workspaceId}/automation/rules", "Automation", "List automation rules");
op("post", "/api/v1/workspaces/{workspaceId}/automation/rules", "Automation", "Create a rule", { body: S.AutomationRuleInput, status: 201 });
op("patch", "/api/v1/automation/rules/{ruleId}", "Automation", "Update a rule", { body: S.AutomationRuleInput.partial() });
op("get", "/api/v1/automation/rules/{ruleId}/executions", "Automation", "Execution history");
op("get", "/api/v1/workspaces/{workspaceId}/calendar", "Calendar", "Calendar items in a date range", { query: z.object({ from: z.string(), to: z.string() }) });
op("post", "/api/v1/workspaces/{workspaceId}/calendar/reschedule", "Calendar", "Drag-to-reschedule", { body: S.RescheduleInput });
op("get", "/api/v1/admin/users", "Admin", "List users (platform admin)");
op("get", "/api/v1/admin/audit-logs", "Admin", "Audit trail (platform admin)");
op("get", "/api/v1/admin/system", "Admin", "System health");

export function generateOpenApiDocument(): Record<string, unknown> {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "CollabSpace API",
      version: "1.0.0",
      description:
        "REST API for CollabSpace. All responses are wrapped as `{ data }` or `{ error: { code, message, details } }`. Authentication uses an HttpOnly session cookie set by `/auth/login`. Real-time collaboration (Yjs) and live events use the separate WebSocket sync service.",
    },
    servers: [{ url: "/" }],
  }) as unknown as Record<string, unknown>;
}
