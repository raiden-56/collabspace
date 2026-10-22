"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { get, post, patch, del, type MeDto, type WorkspaceDto, type ProjectDto, type TaskDto, type BoardDto, type CanvasDto, type DocumentDto, type NotificationDto, type Page, type ChannelDto, type MeetingDto, type TemplateDto, type LabelDto, type ThreadDto, type FileAssetDto, type ActivityDto } from "./api";

export const qk = {
  me: ["me"] as const,
  workspace: (slug: string) => ["workspace", slug] as const,
  members: (wsId: string) => ["members", wsId] as const,
  overview: (wsId: string) => ["overview", wsId] as const,
  projects: (wsId: string) => ["projects", wsId] as const,
  project: (id: string) => ["project", id] as const,
  board: (id: string) => ["board", id] as const,
  tasks: (scope: string, params?: unknown) => ["tasks", scope, params ?? null] as const,
  task: (id: string) => ["task", id] as const,
  labels: (wsId: string) => ["labels", wsId] as const,
  canvases: (wsId: string, projectId?: string) => ["canvases", wsId, projectId ?? null] as const,
  canvas: (id: string) => ["canvas", id] as const,
  documents: (wsId: string, projectId?: string) => ["documents", wsId, projectId ?? null] as const,
  document: (id: string) => ["document", id] as const,
  versions: (type: string, id: string) => ["versions", type, id] as const,
  comments: (type: string, id: string) => ["comments", type, id] as const,
  notifications: (params?: unknown) => ["notifications", params ?? null] as const,
  channels: (wsId: string) => ["channels", wsId] as const,
  channel: (id: string) => ["channel", id] as const,
  messages: (channelId: string, threadId?: string | null) => ["messages", channelId, threadId ?? null] as const,
  meetings: (wsId: string) => ["meetings", wsId] as const,
  meeting: (id: string) => ["meeting", id] as const,
  templates: (params?: unknown) => ["templates", params ?? null] as const,
  files: (wsId: string, params?: unknown) => ["files", wsId, params ?? null] as const,
  activity: (wsId: string, params?: unknown) => ["activity", wsId, params ?? null] as const,
  analytics: (wsId: string) => ["analytics", wsId] as const,
  calendar: (wsId: string, params: unknown) => ["calendar", wsId, params] as const,
  favorites: ["favorites"] as const,
  recent: ["recent"] as const,
  search: (params: unknown) => ["search", params] as const,
  automation: (wsId: string) => ["automation", wsId] as const,
  shareLinks: (type: string, id: string) => ["share-links", type, id] as const,
  permissions: (type: string, id: string) => ["permissions", type, id] as const,
  aiStatus: ["ai-status"] as const,
};

export function useMe(options?: Partial<UseQueryOptions<MeDto>>) {
  return useQuery<MeDto>({ queryKey: qk.me, queryFn: () => get<MeDto>("/auth/me", undefined, { silent401: true }), staleTime: 60_000, retry: false, ...options });
}

export function useWorkspace(slug: string | undefined) {
  return useQuery<WorkspaceDto>({ queryKey: qk.workspace(slug ?? ""), queryFn: () => get<WorkspaceDto>(`/workspaces/${slug}`), enabled: Boolean(slug), staleTime: 60_000 });
}

export function useMembers(wsId: string | undefined) {
  return useQuery({ queryKey: qk.members(wsId ?? ""), queryFn: () => get<Array<{ id: string; role: string; joinedAt: string; user: { id: string; name: string; email: string; avatarUrl: string | null; color: string } }>>(`/workspaces/${wsId}/members`), enabled: Boolean(wsId), staleTime: 60_000 });
}

export function useProjects(wsId: string | undefined, includeArchived = false) {
  return useQuery<Array<ProjectDto>>({ queryKey: [...qk.projects(wsId ?? ""), includeArchived], queryFn: () => get(`/workspaces/${wsId}/projects`, { includeArchived }), enabled: Boolean(wsId) });
}

export function useProject(id: string | undefined) {
  return useQuery<ProjectDto>({ queryKey: qk.project(id ?? ""), queryFn: () => get(`/projects/${id}`), enabled: Boolean(id) });
}

export function useBoard(id: string | undefined) {
  return useQuery<BoardDto>({ queryKey: qk.board(id ?? ""), queryFn: () => get(`/boards/${id}`), enabled: Boolean(id) });
}

export function useProjectTasks(projectId: string | undefined, params?: Record<string, string | number | boolean | undefined>) {
  return useQuery<{ tasks: TaskDto[]; columns: BoardDto["columns"] }>({ queryKey: qk.tasks(`project:${projectId}`, params), queryFn: () => get(`/projects/${projectId}/tasks`, params), enabled: Boolean(projectId) });
}

export function useWorkspaceTasks(wsId: string | undefined, params?: Record<string, string | number | boolean | undefined>) {
  return useQuery<{ tasks: TaskDto[] }>({ queryKey: qk.tasks(`workspace:${wsId}`, params), queryFn: () => get(`/workspaces/${wsId}/tasks`, params), enabled: Boolean(wsId) });
}

export function useTask(id: string | null | undefined) {
  return useQuery<TaskDto & { subtasks: TaskDto[]; attachments: FileAssetDto[]; activities: ActivityDto[]; columns: BoardDto["columns"]; access: string; workspaceSlug?: string; parent: { id: string; title: string; number: number } | null }>({ queryKey: qk.task(id ?? ""), queryFn: () => get(`/tasks/${id}`), enabled: Boolean(id) });
}

export function useLabels(wsId: string | undefined) {
  return useQuery<LabelDto[]>({ queryKey: qk.labels(wsId ?? ""), queryFn: () => get(`/workspaces/${wsId}/labels`), enabled: Boolean(wsId), staleTime: 120_000 });
}

export function useCanvases(wsId: string | undefined, projectId?: string) {
  return useQuery<CanvasDto[]>({ queryKey: qk.canvases(wsId ?? "", projectId), queryFn: () => get(`/workspaces/${wsId}/canvases`, { projectId }), enabled: Boolean(wsId) });
}
export function useCanvas(id: string | undefined, share?: string | null) {
  return useQuery<CanvasDto>({ queryKey: [...qk.canvas(id ?? ""), share ?? null], queryFn: () => get(`/canvases/${id}`, { share: share ?? undefined }), enabled: Boolean(id), retry: false });
}
export function useDocuments(wsId: string | undefined, projectId?: string) {
  return useQuery<DocumentDto[]>({ queryKey: qk.documents(wsId ?? "", projectId), queryFn: () => get(`/workspaces/${wsId}/documents`, { projectId }), enabled: Boolean(wsId) });
}
export function useDocument(id: string | undefined, share?: string | null) {
  return useQuery<DocumentDto>({ queryKey: [...qk.document(id ?? ""), share ?? null], queryFn: () => get(`/documents/${id}`, { share: share ?? undefined }), enabled: Boolean(id), retry: false });
}

export function useThreads(type: string | undefined, id: string | undefined, includeResolved = false, share?: string | null) {
  return useQuery<ThreadDto[]>({ queryKey: [...qk.comments(type ?? "", id ?? ""), includeResolved, share ?? null], queryFn: () => get(`/comments`, { resourceType: type, resourceId: id, includeResolved, share: share ?? undefined }), enabled: Boolean(type && id) });
}

export function useNotifications(params?: { unread?: boolean; type?: string }) {
  return useQuery<Page<NotificationDto> & { unread: number }>({ queryKey: qk.notifications(params), queryFn: () => get(`/notifications`, { ...params, limit: 50 }), refetchInterval: 60_000 });
}

export function useChannels(wsId: string | undefined) {
  return useQuery<ChannelDto[]>({ queryKey: qk.channels(wsId ?? ""), queryFn: () => get(`/workspaces/${wsId}/channels`), enabled: Boolean(wsId) });
}

export function useMeetings(wsId: string | undefined, projectId?: string) {
  return useQuery<MeetingDto[]>({ queryKey: [...qk.meetings(wsId ?? ""), projectId ?? null], queryFn: () => get(`/workspaces/${wsId}/meetings`, { projectId }), enabled: Boolean(wsId) });
}
export function useMeeting(id: string | undefined) {
  return useQuery<MeetingDto>({ queryKey: qk.meeting(id ?? ""), queryFn: () => get(`/meetings/${id}`), enabled: Boolean(id) });
}

export function useTemplates(params?: { kind?: string; q?: string; category?: string }) {
  return useQuery<{ items: TemplateDto[]; categories: string[] }>({ queryKey: qk.templates(params), queryFn: () => get(`/templates`, params), staleTime: 5 * 60_000 });
}

export function useFiles(wsId: string | undefined, params?: Record<string, string | boolean | undefined>) {
  return useQuery<FileAssetDto[]>({ queryKey: qk.files(wsId ?? "", params), queryFn: () => get(`/workspaces/${wsId}/files`, params), enabled: Boolean(wsId) });
}

export function useAiStatus() {
  return useQuery<{ provider: string; enabled: boolean; model: string | null; dataSentToProvider: string }>({ queryKey: qk.aiStatus, queryFn: () => get(`/ai/status`), staleTime: 10 * 60_000 });
}

/** Generic invalidation helper for mutations. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly unknown[][]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k as unknown[] })));
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { resourceType: string; resourceId: string }) => post<{ favorite: boolean }>(`/users/me/favorites`, input),
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: qk.favorites });
      void qc.invalidateQueries({ queryKey: [input.resourceType.toLowerCase(), input.resourceId] });
    },
  });
}

export const mutations = {
  updateTask: (id: string, body: Record<string, unknown>) => patch<TaskDto>(`/tasks/${id}`, body),
  moveTask: (id: string, body: { status: string; beforeId?: string | null; afterId?: string | null }) => post<TaskDto>(`/tasks/${id}/move`, body),
  createTask: (projectId: string, body: Record<string, unknown>) => post<TaskDto>(`/projects/${projectId}/tasks`, body),
  deleteTask: (id: string) => del(`/tasks/${id}`),
  markRead: (id: string, read = true) => patch(`/notifications/${id}`, { read }),
  readAll: () => post(`/notifications/read-all`),
};
