"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, CheckSquare, GanttChart, KanbanSquare, List, Plus, User, X, Trash2, Archive } from "lucide-react";
import { get, post, errorMessage, type MilestoneDto, type TaskDto } from "@/lib/api";
import { useProjects, useProjectTasks, useWorkspaceTasks, useLabels, useMembers } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { useShortcut } from "@/lib/hooks/use-shortcut";
import { useTaskFilters, applyFilters, groupTasks, TaskFilterBar } from "@/components/tasks/task-filters";
import { TaskList } from "@/components/tasks/task-list";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TimelineView } from "@/components/tasks/timeline-view";
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer";
import { Button } from "@/components/ui/button";
import { SegmentTabs, SimpleSelect } from "@/components/ui/controls";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_BOARD_COLUMNS } from "@collabspace/shared";
import type { BoardColumnDto } from "@/lib/api";

type View = "list" | "board" | "timeline" | "mine";

function TasksContent() {
  const { workspace, workspaceSlug, user, isGuest } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const dialogs = useCreateDialogs();
  useHeader({ title: "Tasks" });
  const view = (params.get("view") as View) ?? "list";
  const projectId = params.get("project") ?? "";
  const taskId = params.get("task");
  const [filters, setFilters] = useTaskFilters();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const projects = useProjects(workspace?.id);
  const labels = useLabels(workspace?.id);
  const members = useMembers(workspace?.id);
  const projectTasks = useProjectTasks(view !== "mine" && projectId ? projectId : undefined, { limit: 500, includeArchived: false });
  const wsTasks = useWorkspaceTasks(workspace?.id && (view === "mine" || !projectId) ? workspace.id : undefined, { mine: view === "mine" ? true : undefined, limit: 500 });
  const milestones = useQuery<MilestoneDto[]>({ queryKey: ["milestones", projectId], queryFn: () => get(`/projects/${projectId}/milestones`), enabled: Boolean(projectId) && view === "timeline" });

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  useShortcut("c", () => !isGuest && dialogs.openTask(projectId || undefined), { enabled: !taskId });

  const rawTasks: TaskDto[] = (view !== "mine" && projectId ? projectTasks.data?.tasks : wsTasks.data?.tasks) ?? [];
  const columns: BoardColumnDto[] = projectTasks.data?.columns ?? DEFAULT_BOARD_COLUMNS.map((c, i) => ({ id: c.statusKey, boardId: "", name: c.name, statusKey: c.statusKey, color: c.color, position: i, isDone: c.isDone, wipLimit: null }));
  const isLoading = view !== "mine" && projectId ? projectTasks.isLoading : wsTasks.isLoading;
  const filtered = useMemo(() => applyFilters(rawTasks, filters, user?.id), [rawTasks, filters, user?.id]);
  const groups = useMemo(() => groupTasks(filtered, filters.groupBy || (view === "mine" || !projectId ? "project" : ""), columns, labels.data ?? []), [filtered, filters.groupBy, columns, labels.data, view, projectId]);
  const invalidateKeys: unknown[][] = [["tasks"], ["board"], ["project", projectId]];

  const bulk = useMutation({
    mutationFn: (patch: Record<string, unknown>) => post(`/workspaces/${workspace!.id}/tasks/bulk`, { taskIds: [...selected], patch }),
    onSuccess: () => {
      setSelected(new Set());
      invalidateKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      toast.success("Tasks updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openTask = (id: string) => setParam("task", id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentTabs value={view} onChange={(v) => setParam("view", v === "list" ? null : v)} options={[{ value: "list", label: <span className="flex items-center gap-1.5"><List className="size-4" /> List</span> }, { value: "board", label: <span className="flex items-center gap-1.5"><KanbanSquare className="size-4" /> Board</span> }, { value: "timeline", label: <span className="flex items-center gap-1.5"><GanttChart className="size-4" /> Timeline</span> }, { value: "mine", label: <span className="flex items-center gap-1.5"><User className="size-4" /> My tasks</span> }]} className="border-b-0" />
            {view !== "mine" ? <SimpleSelect value={projectId || "all"} onChange={(v) => setParam("project", v === "all" ? null : v)} options={[{ value: "all", label: "All projects" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} className="h-8 w-48 text-xs" /> : null}
            {workspaceSlug ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/app/${workspaceSlug}/calendar`}><Calendar /> Calendar</Link>
              </Button>
            ) : null}
          </div>
          {!isGuest ? (
            <Button size="sm" onClick={() => dialogs.openTask(projectId || undefined)}>
              <Plus /> New task <kbd className="kbd ml-1 !bg-white/20 !text-white">C</kbd>
            </Button>
          ) : null}
        </div>
        <TaskFilterBar filters={filters} setFilters={setFilters} columns={projectId ? columns : undefined} showGroup={view === "list"} />
        {selected.size ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary-soft/40 px-3 py-2 text-sm">
            <span className="font-medium">{selected.size} selected</span>
            <SimpleSelect value={undefined} onChange={(status) => bulk.mutate({ status })} placeholder="Set status…" options={columns.map((c) => ({ value: c.statusKey, label: c.name }))} className="h-7 w-36 text-xs" />
            <SimpleSelect value={undefined} onChange={(priority) => bulk.mutate({ priority })} placeholder="Set priority…" options={["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => ({ value: p, label: p[0] + p.slice(1).toLowerCase() }))} className="h-7 w-36 text-xs" />
            <SimpleSelect value={undefined} onChange={(assigneeId) => bulk.mutate({ assigneeId: assigneeId === "none" ? null : assigneeId })} placeholder="Assign to…" options={[{ value: "none", label: "Unassigned" }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} className="h-7 w-40 text-xs" />
            <SimpleSelect value={undefined} onChange={(labelId) => bulk.mutate({ addLabelIds: [labelId] })} placeholder="Add label…" options={(labels.data ?? []).map((l) => ({ value: l.id, label: l.name }))} className="h-7 w-36 text-xs" />
            <Button size="xs" variant="outline" onClick={() => bulk.mutate({ archived: true })}><Archive /> Archive</Button>
            <Button size="xs" variant="outline" className="text-error" onClick={() => { if (confirm(`Delete ${selected.size} tasks?`)) bulk.mutate({ delete: true }); }}><Trash2 /> Delete</Button>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}><X /> Clear</Button>
          </div>
        ) : null}
      </div>

      <div className={view === "board" ? "min-h-0 flex-1 pt-4" : "flex-1 overflow-y-auto px-4 py-4 sm:px-6"}>
        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : rawTasks.length === 0 ? (
          <EmptyState icon={<CheckSquare />} title={view === "mine" ? "Nothing assigned to you" : "No tasks yet"} description={view === "mine" ? "Tasks assigned to you across all projects show up here." : "Create a task, or convert sticky notes, checklist items and meeting action items into tasks."} action={!isGuest && view !== "mine" ? <Button onClick={() => dialogs.openTask(projectId || undefined)}><Plus /> Create a task</Button> : undefined} />
        ) : view === "board" ? (
          projectId ? (
            <KanbanBoard columns={columns} tasks={filtered} onOpen={openTask} onCreate={!isGuest ? (status) => dialogs.openTask(projectId, { status }) : undefined} readOnly={isGuest} selectable selected={selected} onToggleSelect={toggleSelect} invalidateKeys={invalidateKeys} />
          ) : (
            <div className="px-4">
              <EmptyState icon={<KanbanSquare />} title="Pick a project to use the board" description="Boards are per project so columns can be configured independently." action={<SimpleSelect value={undefined} onChange={(v) => setParam("project", v)} placeholder="Choose a project" options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} className="w-64" />} />
            </div>
          )
        ) : view === "timeline" ? (
          projectId ? (
            <TimelineView tasks={filtered} milestones={milestones.data ?? []} onOpen={openTask} />
          ) : (
            <EmptyState icon={<GanttChart />} title="Pick a project to view its timeline" description="The timeline shows task date ranges, dependencies and milestones for one project." action={<SimpleSelect value={undefined} onChange={(v) => setParam("project", v)} placeholder="Choose a project" options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} className="w-64" />} />
          )
        ) : (
          <TaskList groups={groups} columns={projectId ? columns : undefined} onOpen={openTask} readOnly={isGuest} selectable selected={selected} onToggleSelect={toggleSelect} showProject={!projectId} invalidateKeys={invalidateKeys} />
        )}
      </div>
      <TaskDetailDrawer taskId={taskId} onClose={() => setParam("task", null)} />
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense>
      <TasksContent />
    </Suspense>
  );
}
