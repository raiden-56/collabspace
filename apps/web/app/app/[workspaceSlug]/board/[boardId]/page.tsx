"use client";

import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GripVertical, List, Plus, Settings2, Trash2, X } from "lucide-react";
import { patch, errorMessage, type BoardColumnDto } from "@/lib/api";
import { useBoard } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { useShortcut } from "@/lib/hooks/use-shortcut";
import { useTaskFilters, applyFilters, TaskFilterBar } from "@/components/tasks/task-filters";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/controls";
import { Spinner } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";

function BoardContent({ boardId }: { boardId: string }) {
  const { workspaceSlug, user, isGuest } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const dialogs = useCreateDialogs();
  const board = useBoard(boardId);
  const [filters, setFilters] = useTaskFilters();
  const [settings, setSettings] = useState(false);
  const taskId = params.get("task");
  const b = board.data;
  const canEdit = b?.access === "OWNER" || b?.access === "EDITOR";

  useHeader(
    {
      title: b ? `${b.project.name} · Board` : "Board",
      breadcrumbs: b && workspaceSlug ? [{ label: "Projects", href: `/app/${workspaceSlug}/projects` }, { label: b.project.name, href: `/app/${workspaceSlug}/projects/${b.projectId}` }] : [],
      resource: b ? { type: "BOARD", id: boardId, access: b.access } : null,
      actions: b ? (
        <>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/app/${workspaceSlug}/tasks?project=${b.projectId}`}><List /> List view</Link>
          </Button>
          {canEdit ? (
            <Button variant="ghost" size="sm" onClick={() => setSettings(true)}>
              <Settings2 /> Columns
            </Button>
          ) : null}
        </>
      ) : null,
    },
    [b?.project.name, b?.access, boardId, canEdit],
  );

  const setTask = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("task", id);
    else next.delete("task");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  useShortcut("c", () => b && !isGuest && dialogs.openTask(b.projectId), { enabled: !taskId });

  if (board.isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!b) return <div className="p-10 text-center text-text-secondary">Board not found.</div>;
  const filtered = applyFilters(b.tasks, { ...filters, sort: "position" }, user?.id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <TaskFilterBar filters={filters} setFilters={setFilters} columns={b.columns} showGroup={false} />
        {canEdit ? (
          <Button size="sm" onClick={() => dialogs.openTask(b.projectId)}>
            <Plus /> New task
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 pt-4">
        <KanbanBoard columns={b.columns} tasks={filtered} onOpen={setTask} onCreate={canEdit ? (status) => dialogs.openTask(b.projectId, { status }) : undefined} readOnly={!canEdit} invalidateKeys={[["board", boardId], ["tasks"], ["project", b.projectId]]} />
      </div>
      <TaskDetailDrawer taskId={taskId} onClose={() => setTask(null)} />
      {settings ? <ColumnSettings boardId={boardId} name={b.name} columns={b.columns} onClose={() => setSettings(false)} /> : null}
    </div>
  );
}

export default function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = use(params);
  return (
    <Suspense>
      <BoardContent boardId={boardId} />
    </Suspense>
  );
}

function ColumnSettings({ boardId, name, columns, onClose }: { boardId: string; name: string; columns: BoardColumnDto[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [cols, setCols] = useState(columns.map((c) => ({ id: c.id, name: c.name, statusKey: c.statusKey, color: c.color, isDone: c.isDone, wipLimit: c.wipLimit })));
  const [boardName, setBoardName] = useState(name);
  const save = useMutation({
    mutationFn: () => patch(`/boards/${boardId}`, { name: boardName, columns: cols.map((c) => ({ id: c.id || undefined, name: c.name, statusKey: c.statusKey, color: c.color, isDone: c.isDone, wipLimit: c.wipLimit })) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["board", boardId] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Board updated");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const move = (i: number, dir: -1 | 1) => setCols((c) => { const n = [...c]; const j = i + dir; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Board columns</DialogTitle>
          <DialogDescription>Each column maps to a task status. Columns that still contain tasks cannot be removed; at least one column must be marked as done.</DialogDescription>
        </DialogHeader>
        <Input value={boardName} onChange={(e) => setBoardName(e.target.value)} aria-label="Board name" />
        <ul className="space-y-2">
          {cols.map((c, i) => (
            <li key={c.id || i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
              <div className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-text-muted disabled:opacity-30" aria-label="Move up"><GripVertical className="size-3 rotate-90" /></button>
                <button onClick={() => move(i, 1)} disabled={i === cols.length - 1} className="text-text-muted disabled:opacity-30" aria-label="Move down"><GripVertical className="size-3 -rotate-90" /></button>
              </div>
              <input type="color" value={c.color} onChange={(e) => setCols((x) => x.map((y, j) => (j === i ? { ...y, color: e.target.value } : y)))} className="size-8 cursor-pointer rounded border-0 bg-transparent" aria-label="Column color" />
              <Input value={c.name} onChange={(e) => setCols((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value, statusKey: y.id ? y.statusKey : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") } : y)))} className="h-8 w-40 text-xs" aria-label="Column name" />
              <code className="rounded bg-surface-2 px-1.5 text-[11px] text-text-muted">{c.statusKey}</code>
              <label className="flex items-center gap-1.5 text-xs"><Switch checked={c.isDone} onCheckedChange={(v) => setCols((x) => x.map((y, j) => (j === i ? { ...y, isDone: v } : y)))} /> Done</label>
              <label className="flex items-center gap-1.5 text-xs">WIP <Input type="number" min={1} value={c.wipLimit ?? ""} placeholder="—" onChange={(e) => setCols((x) => x.map((y, j) => (j === i ? { ...y, wipLimit: e.target.value ? Number(e.target.value) : null } : y)))} className="h-7 w-16 text-xs" /></label>
              <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label="Remove column" onClick={() => setCols((x) => x.filter((_, j) => j !== i))}><Trash2 /></Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" onClick={() => setCols((c) => [...c, { id: "", name: "New column", statusKey: `col_${c.length + 1}`, color: "#A0A9BC", isDone: false, wipLimit: null }])}>
          <Plus /> Add column
        </Button>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}><X /> Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={cols.length === 0 || !cols.some((c) => c.isDone)}>Save columns</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
