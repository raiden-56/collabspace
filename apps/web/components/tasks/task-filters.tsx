"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Search, X } from "lucide-react";
import type { LabelDto, TaskDto, BoardColumnDto } from "@/lib/api";
import { useLabels, useMembers } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/controls";
import { Button } from "@/components/ui/button";
import { statusLabel } from "@/lib/utils";

export interface TaskFilters {
  q: string;
  status: string;
  assigneeId: string;
  priority: string;
  labelId: string;
  sort: string;
  groupBy: string;
}

export function useTaskFilters(): [TaskFilters, (patch: Partial<TaskFilters>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = useMemo<TaskFilters>(
    () => ({ q: params.get("q") ?? "", status: params.get("status") ?? "", assigneeId: params.get("assignee") ?? "", priority: params.get("priority") ?? "", labelId: params.get("label") ?? "", sort: params.get("sort") ?? "position", groupBy: params.get("group") ?? "" }),
    [params],
  );
  const set = useCallback(
    (patch: Partial<TaskFilters>) => {
      const next = new URLSearchParams(params.toString());
      const map: Record<keyof TaskFilters, string> = { q: "q", status: "status", assigneeId: "assignee", priority: "priority", labelId: "label", sort: "sort", groupBy: "group" };
      for (const [k, v] of Object.entries(patch)) {
        const key = map[k as keyof TaskFilters];
        if (!v || v === "position" && k === "sort") next.delete(key);
        else next.set(key, v);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, router, pathname],
  );
  return [filters, set];
}

export function applyFilters(tasks: TaskDto[], f: TaskFilters, userId?: string): TaskDto[] {
  let out = tasks;
  if (f.q) {
    const q = f.q.toLowerCase();
    out = out.filter((t) => t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  }
  if (f.status) out = out.filter((t) => t.status === f.status);
  if (f.assigneeId) out = out.filter((t) => (f.assigneeId === "none" ? !t.assigneeId : f.assigneeId === "me" ? t.assigneeId === userId : t.assigneeId === f.assigneeId));
  if (f.priority) out = out.filter((t) => t.priority === f.priority);
  if (f.labelId) out = out.filter((t) => t.labels.some((l) => l.id === f.labelId));
  const dir = 1;
  switch (f.sort) {
    case "dueDate":
      out = [...out].sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity));
      break;
    case "priority": {
      const order = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
      out = [...out].sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority));
      break;
    }
    case "createdAt":
      out = [...out].sort((a, b) => dir * (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      break;
    case "updatedAt":
      out = [...out].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    case "title":
      out = [...out].sort((a, b) => a.title.localeCompare(b.title));
      break;
    default:
      out = [...out].sort((a, b) => a.position - b.position);
  }
  return out;
}

export function groupTasks(tasks: TaskDto[], groupBy: string, columns: BoardColumnDto[], labels: LabelDto[]): Array<{ key: string; label: string; color?: string; tasks: TaskDto[] }> {
  if (!groupBy) return [{ key: "all", label: "All tasks", tasks }];
  const groups = new Map<string, { label: string; color?: string; tasks: TaskDto[] }>();
  const push = (key: string, label: string, t: TaskDto, color?: string) => {
    const g = groups.get(key) ?? { label, color, tasks: [] };
    g.tasks.push(t);
    groups.set(key, g);
  };
  for (const t of tasks) {
    if (groupBy === "status") push(t.status, columns.find((c) => c.statusKey === t.status)?.name ?? statusLabel(t.status), t, columns.find((c) => c.statusKey === t.status)?.color);
    else if (groupBy === "assignee") push(t.assigneeId ?? "none", t.assignee?.name ?? "Unassigned", t, t.assignee?.color);
    else if (groupBy === "priority") push(t.priority, t.priority === "NONE" ? "No priority" : t.priority[0] + t.priority.slice(1).toLowerCase(), t);
    else if (groupBy === "label") {
      if (!t.labels.length) push("none", "No label", t);
      for (const l of t.labels) push(l.id, l.name, t, l.color);
    } else if (groupBy === "project") push(t.projectId, t.project.name, t, t.project.color);
  }
  const order = groupBy === "status" ? columns.map((c) => c.statusKey) : groupBy === "priority" ? ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] : groupBy === "label" ? labels.map((l) => l.id) : [];
  return [...groups.entries()].sort((a, b) => (order.indexOf(a[0]) === -1 ? 999 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 999 : order.indexOf(b[0])) || a[1].label.localeCompare(b[1].label)).map(([key, g]) => ({ key, ...g }));
}

export function TaskFilterBar({ filters, setFilters, columns, showGroup = true, extra }: { filters: TaskFilters; setFilters: (p: Partial<TaskFilters>) => void; columns?: BoardColumnDto[]; showGroup?: boolean; extra?: React.ReactNode }) {
  const { workspace } = useApp();
  const members = useMembers(workspace?.id);
  const labels = useLabels(workspace?.id);
  const active = [filters.status, filters.assigneeId, filters.priority, filters.labelId, filters.q].filter(Boolean).length;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <Input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Search tasks…" className="h-8 w-48 pl-8 text-xs" aria-label="Search tasks" />
      </div>
      {columns ? <SimpleSelect value={filters.status || "all"} onChange={(v) => setFilters({ status: v === "all" ? "" : v })} options={[{ value: "all", label: "Any status" }, ...columns.map((c) => ({ value: c.statusKey, label: c.name }))]} className="h-8 w-36 text-xs" /> : null}
      <SimpleSelect value={filters.assigneeId || "all"} onChange={(v) => setFilters({ assigneeId: v === "all" ? "" : v })} options={[{ value: "all", label: "Anyone" }, { value: "me", label: "Assigned to me" }, { value: "none", label: "Unassigned" }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} className="h-8 w-40 text-xs" />
      <SimpleSelect value={filters.priority || "all"} onChange={(v) => setFilters({ priority: v === "all" ? "" : v })} options={[{ value: "all", label: "Any priority" }, ...["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => ({ value: p, label: p === "NONE" ? "No priority" : p[0] + p.slice(1).toLowerCase() }))]} className="h-8 w-36 text-xs" />
      <SimpleSelect value={filters.labelId || "all"} onChange={(v) => setFilters({ labelId: v === "all" ? "" : v })} options={[{ value: "all", label: "Any label" }, ...(labels.data ?? []).map((l) => ({ value: l.id, label: l.name }))]} className="h-8 w-36 text-xs" />
      <SimpleSelect value={filters.sort} onChange={(v) => setFilters({ sort: v })} options={[{ value: "position", label: "Manual order" }, { value: "dueDate", label: "Due date" }, { value: "priority", label: "Priority" }, { value: "updatedAt", label: "Recently updated" }, { value: "createdAt", label: "Newest" }, { value: "title", label: "Title" }]} className="h-8 w-40 text-xs" />
      {showGroup ? <SimpleSelect value={filters.groupBy || "none"} onChange={(v) => setFilters({ groupBy: v === "none" ? "" : v })} options={[{ value: "none", label: "No grouping" }, { value: "status", label: "Group by status" }, { value: "assignee", label: "Group by assignee" }, { value: "priority", label: "Group by priority" }, { value: "label", label: "Group by label" }, { value: "project", label: "Group by project" }]} className="h-8 w-44 text-xs" /> : null}
      {active ? (
        <Button variant="ghost" size="xs" onClick={() => setFilters({ q: "", status: "", assigneeId: "", priority: "", labelId: "" })}>
          <X /> Clear {active}
        </Button>
      ) : (
        <span className="flex items-center gap-1 text-xs text-text-muted">
          <Filter className="size-3.5" />
        </span>
      )}
      {extra}
    </div>
  );
}
