import { CheckSquare, FileText, Files, FolderKanban, KanbanSquare, MessageSquare, PenTool, Video, type LucideIcon } from "lucide-react";

export const RESOURCE_ICON: Record<string, LucideIcon> = {
  CANVAS: PenTool,
  DOCUMENT: FileText,
  PROJECT: FolderKanban,
  TASK: CheckSquare,
  MEETING: Video,
  BOARD: KanbanSquare,
  FILE: Files,
  CHANNEL: MessageSquare,
  MESSAGE: MessageSquare,
  COMMENT: MessageSquare,
};

export function resourceHref(slug: string, type: string, id: string): string {
  switch (type) {
    case "CANVAS":
      return `/app/${slug}/canvas/${id}`;
    case "DOCUMENT":
      return `/app/${slug}/docs/${id}`;
    case "PROJECT":
      return `/app/${slug}/projects/${id}`;
    case "TASK":
      return `/app/${slug}/tasks?task=${id}`;
    case "MEETING":
      return `/app/${slug}/meetings/${id}`;
    case "BOARD":
      return `/app/${slug}/board/${id}`;
    case "FILE":
      return `/app/${slug}/files?file=${id}`;
    case "CHANNEL":
      return `/app/${slug}/chat?channel=${id}`;
    default:
      return `/app/${slug}`;
  }
}

export function ResourceIcon({ type, className }: { type: string; className?: string }) {
  const Icon = RESOURCE_ICON[type] ?? FileText;
  return <Icon className={className} />;
}

export function humanResourceType(type: string): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

export function activityLabel(type: string, payload: Record<string, unknown>): string {
  const [entity, action] = type.split(".");
  const e = (entity ?? "").replace("_", " ");
  switch (action) {
    case "created":
      return `created a ${e}`;
    case "updated":
      return `updated a ${e}`;
    case "deleted":
      return `deleted a ${e}`;
    case "archived":
      return `archived a ${e}`;
    case "restored":
      return `restored a ${e} version`;
    case "status":
    case "status_changed":
      return `changed status${payload?.to ? ` to ${String(payload.to).replace("_", " ")}` : ""}`;
    case "assignee":
      return payload?.to ? "assigned a task" : "unassigned a task";
    case "completed":
      return "completed a task";
    case "reopened":
      return "reopened a task";
    case "dueDate":
      return "changed a due date";
    case "title":
      return "renamed a task";
    case "priority":
      return "changed a priority";
    case "member_added":
      return "added a member";
    case "joined":
      return "joined the workspace";
    case "removed":
      return "removed a member";
    case "role_changed":
      return "changed a member role";
    case "link_created":
      return "created a share link";
    case "link_revoked":
      return "revoked a share link";
    case "granted":
      return "shared access";
    case "uploaded":
      return "uploaded a file";
    case "actions_converted":
      return `converted ${payload?.count ?? ""} action items into tasks`;
    default:
      return type.replace(/[._]/g, " ");
  }
}
