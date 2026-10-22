"use client";

import { useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCorners, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Calendar, GitBranch, MessageSquare, Paperclip, Plus } from "lucide-react";
import { mutations } from "@/lib/queries";
import { errorMessage, type BoardColumnDto, type TaskDto } from "@/lib/api";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { formatDate, PRIORITY_META, cn } from "@/lib/utils";

export interface KanbanProps {
  columns: BoardColumnDto[];
  tasks: TaskDto[];
  readOnly?: boolean;
  onOpen: (taskId: string) => void;
  onCreate?: (status: string) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Query keys to optimistically patch */
  invalidateKeys: unknown[][];
}

export function KanbanBoard({ columns, tasks, readOnly, onOpen, onCreate, selectable, selected, onToggleSelect, invalidateKeys }: KanbanProps) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [localTasks, setLocalTasks] = useState<TaskDto[] | null>(null);
  const list = localTasks ?? tasks;
  const byStatus = useMemo(() => {
    const m = new Map<string, TaskDto[]>();
    for (const c of columns) m.set(c.statusKey, []);
    for (const t of list) {
      if (t.parentId && list.some((p) => p.id === t.parentId)) continue; // subtasks shown inside parents
      const arr = m.get(t.status) ?? m.set(t.status, []).get(t.status)!;
      arr.push(t);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [list, columns]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const move = useMutation({
    mutationFn: ({ id, status, beforeId, afterId }: { id: string; status: string; beforeId: string | null; afterId: string | null }) => mutations.moveTask(id, { status, beforeId, afterId }),
    onSuccess: () => {
      setLocalTasks(null);
      for (const k of invalidateKeys) void qc.invalidateQueries({ queryKey: k });
    },
    onError: (e) => {
      setLocalTasks(null);
      toast.error(errorMessage(e, "Could not move task"));
    },
  });

  const findColumn = (id: string) => (columns.some((c) => c.statusKey === id) ? id : list.find((t) => t.id === id)?.status ?? null);

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setLocalTasks(tasks);
  };
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const from = findColumn(String(active.id));
    const to = findColumn(String(over.id));
    if (!from || !to || from === to) return;
    setLocalTasks((prev) => (prev ?? tasks).map((t) => (t.id === active.id ? { ...t, status: to, position: Number.MAX_SAFE_INTEGER } : t)));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over || readOnly) return setLocalTasks(null);
    const id = String(active.id);
    const toStatus = findColumn(String(over.id));
    if (!toStatus) return setLocalTasks(null);
    const current = (localTasks ?? tasks).filter((t) => t.status === toStatus && (!t.parentId || !list.some((p) => p.id === t.parentId))).sort((a, b) => a.position - b.position);
    const ids = current.map((t) => t.id);
    const fromIdx = ids.indexOf(id);
    const overIdx = ids.indexOf(String(over.id));
    let ordered = ids;
    if (fromIdx !== -1 && overIdx !== -1 && fromIdx !== overIdx) ordered = arrayMove(ids, fromIdx, overIdx);
    else if (fromIdx === -1) ordered = overIdx === -1 ? [...ids, id] : [...ids.slice(0, overIdx), id, ...ids.slice(overIdx)];
    const idx = ordered.indexOf(id);
    const beforeId = ordered[idx - 1] ?? null;
    const afterId = ordered[idx + 1] ?? null;
    const original = tasks.find((t) => t.id === id);
    if (original && original.status === toStatus && beforeId === (ids[ids.indexOf(id) - 1] ?? null) && afterId === (ids[ids.indexOf(id) + 1] ?? null)) return setLocalTasks(null);
    // Optimistic: reposition locally while the server responds
    setLocalTasks((prev) => {
      const base = prev ?? tasks;
      const before = base.find((t) => t.id === beforeId)?.position ?? null;
      const after = base.find((t) => t.id === afterId)?.position ?? null;
      const pos = before == null && after == null ? 1000 : before == null ? (after as number) - 1 : after == null ? before + 1 : (before + after) / 2;
      return base.map((t) => (t.id === id ? { ...t, status: toStatus, position: pos } : t));
    });
    move.mutate({ id, status: toStatus, beforeId, afterId });
  };

  const activeTask = activeId ? list.find((t) => t.id === activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setLocalTasks(null); }}>
      <div className="flex h-full gap-3 overflow-x-auto px-4 pb-4 scrollbar-thin">
        {columns.map((col) => {
          const colTasks = byStatus.get(col.statusKey) ?? [];
          const overWip = col.wipLimit ? colTasks.length > col.wipLimit : false;
          return (
            <Column key={col.id} column={col} count={colTasks.length} overWip={overWip} onCreate={!readOnly && onCreate ? () => onCreate(col.statusKey) : undefined}>
              <SortableContext items={colTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {colTasks.map((t) => (
                  <SortableCard key={t.id} task={t} subtasks={list.filter((s) => s.parentId === t.id)} disabled={readOnly} onOpen={() => onOpen(t.id)} selectable={selectable} selected={selected?.has(t.id)} onToggleSelect={onToggleSelect} />
                ))}
              </SortableContext>
              {colTasks.length === 0 ? <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-text-muted">Drop tasks here</div> : null}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 150 }}>{activeTask ? <TaskCard task={activeTask} subtasks={[]} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ column, count, overWip, onCreate, children }: { column: BoardColumnDto; count: number; overWip: boolean; onCreate?: () => void; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.statusKey });
  return (
    <div ref={setNodeRef} className={cn("flex h-full w-72 shrink-0 flex-col rounded-xl bg-surface-2/70 transition-colors", isOver && "bg-primary-soft/40 ring-2 ring-primary/30")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="size-2.5 rounded-full" style={{ background: column.color }} />
        <h3 className="text-sm font-semibold">{column.name}</h3>
        <span className={cn("rounded-full px-1.5 text-[11px] font-medium", overWip ? "bg-error-soft text-error" : "bg-surface-3 text-text-muted")}>
          {count}
          {column.wipLimit ? `/${column.wipLimit}` : ""}
        </span>
        {column.isDone ? <Badge variant="success">done</Badge> : null}
        {onCreate ? (
          <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={onCreate} aria-label={`Add task to ${column.name}`}>
            <Plus />
          </Button>
        ) : null}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2 scrollbar-thin">{children}</div>
    </div>
  );
}

function SortableCard({ task, subtasks, disabled, onOpen, selectable, selected, onToggleSelect }: { task: TaskDto; subtasks: TaskDto[]; disabled?: boolean; onOpen: () => void; selectable?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className={cn(isDragging && "opacity-40")}>
      <TaskCard task={task} subtasks={subtasks} onOpen={onOpen} selectable={selectable} selected={selected} onToggleSelect={onToggleSelect} />
    </div>
  );
}

export function TaskCard({ task: t, subtasks, onOpen, overlay, selectable, selected, onToggleSelect }: { task: TaskDto; subtasks: TaskDto[]; onOpen?: () => void; overlay?: boolean; selectable?: boolean; selected?: boolean; onToggleSelect?: (id: string) => void }) {
  const overdue = t.dueDate && !t.completedAt && new Date(t.dueDate) < new Date();
  const doneSubs = subtasks.filter((s) => s.completedAt).length;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
      className={cn("group cursor-pointer rounded-lg border bg-surface p-3 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", overlay && "rotate-1 shadow-lg", selected ? "border-primary ring-1 ring-primary/30" : "border-border", t.completedAt && "opacity-70")}
    >
      <div className="mb-1.5 flex items-center gap-2">
        {selectable ? (
          <span onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <Checkbox checked={selected} onCheckedChange={() => onToggleSelect?.(t.id)} aria-label="Select task" />
          </span>
        ) : null}
        <span className="font-mono text-[10px] text-text-muted">{t.key}</span>
        {t.priority !== "NONE" ? <span className="size-2 rounded-full" style={{ background: PRIORITY_META[t.priority]!.color }} title={PRIORITY_META[t.priority]!.label} /> : null}
        {t.blocked ? <AlertTriangle className="size-3.5 text-error" aria-label="Blocked" /> : null}
        <span className="ml-auto">{t.assignee ? <UserAvatar user={t.assignee} size="xs" /> : null}</span>
      </div>
      <p className={cn("text-sm font-medium leading-snug", t.completedAt && "line-through")}>{t.title}</p>
      {t.labels.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {t.labels.map((l) => (
            <span key={l.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ background: l.color }}>
              {l.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-3 text-[11px] text-text-muted">
        {t.dueDate ? (
          <span className={cn("flex items-center gap-1", overdue && "font-medium text-error")}>
            <Calendar className="size-3" /> {formatDate(t.dueDate)}
          </span>
        ) : null}
        {subtasks.length ? (
          <span>
            {doneSubs}/{subtasks.length} subtasks
          </span>
        ) : t.subtaskCount ? (
          <span>{t.subtaskCount} subtasks</span>
        ) : null}
        {t.blockedBy.length ? (
          <span className="flex items-center gap-1">
            <GitBranch className="size-3" /> {t.blockedBy.length}
          </span>
        ) : null}
        {t.attachmentCount ? (
          <span className="flex items-center gap-1">
            <Paperclip className="size-3" /> {t.attachmentCount}
          </span>
        ) : null}
        {t.sourceType ? <MessageSquare className="ml-auto size-3 opacity-60" aria-label={`From ${t.sourceType}`} /> : null}
      </div>
    </div>
  );
}
