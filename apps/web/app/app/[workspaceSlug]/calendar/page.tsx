"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { get, post, ApiError, errorMessage, type CalendarItem } from "@/lib/api";
import { useProjects, useMembers } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SegmentTabs, SimpleSelect } from "@/components/ui/controls";
import { Card, Spinner } from "@/components/ui/skeleton";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "agenda";
const KIND_LABEL: Record<string, string> = { task: "Task", meeting: "Meeting", milestone: "Milestone", event: "Event" };

export default function CalendarPage() {
  const { workspace, isGuest } = useApp();
  useHeader({ title: "Calendar" });
  const qc = useQueryClient();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(new Date());
  const [projectId, setProjectId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [types, setTypes] = useState<string[]>(["task", "meeting", "milestone", "event"]);
  const [newEvent, setNewEvent] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<{ item: CalendarItem; start: Date; conflicts: Array<{ title: string }> } | null>(null);
  const projects = useProjects(workspace?.id);
  const members = useMembers(workspace?.id);

  const range = useMemo(() => {
    if (view === "month") return { from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), to: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) };
    if (view === "week") return { from: startOfWeek(cursor, { weekStartsOn: 1 }), to: endOfWeek(cursor, { weekStartsOn: 1 }) };
    return { from: startOfWeek(cursor, { weekStartsOn: 1 }), to: addDays(startOfWeek(cursor, { weekStartsOn: 1 }), 42) };
  }, [view, cursor]);

  const items = useQuery<CalendarItem[]>({
    queryKey: ["calendar", workspace?.id, range.from.toISOString(), range.to.toISOString(), projectId, assigneeId, types.join(",")],
    queryFn: () => get(`/workspaces/${workspace!.id}/calendar`, { from: range.from.toISOString(), to: range.to.toISOString(), projectId: projectId || undefined, assigneeId: assigneeId || undefined, types: types.join(",") }),
    enabled: Boolean(workspace) && types.length > 0,
    placeholderData: (prev) => prev,
  });

  const reschedule = useMutation({
    mutationFn: ({ item, start, confirm }: { item: CalendarItem; start: Date; confirm?: boolean }) => {
      const dur = item.end ? new Date(item.end).getTime() - new Date(item.start).getTime() : 0;
      return post(`/workspaces/${workspace!.id}/calendar/reschedule`, { kind: item.kind, id: item.id, start: start.toISOString(), end: item.kind === "task" ? start.toISOString() : new Date(start.getTime() + dur).toISOString(), confirmConflicts: confirm });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Rescheduled");
      setConflict(null);
    },
    onError: (err, vars) => {
      if (err instanceof ApiError && err.status === 409) {
        const details = err.details as { conflicts: Array<{ title: string }> };
        setConflict({ item: vars.item, start: vars.start, conflicts: details.conflicts });
      } else toast.error(errorMessage(err));
    },
  });

  const onDropOnDay = (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-calendar-item");
    if (!raw || isGuest) return;
    const item = JSON.parse(raw) as CalendarItem;
    const orig = new Date(item.start);
    const start = new Date(day);
    start.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    if (isSameDay(start, orig)) return;
    reschedule.mutate({ item, start });
  };

  const move = (dir: 1 | -1) => setCursor((c) => (view === "month" ? addMonths(c, dir) : addWeeks(c, dir)));
  const title = view === "month" ? format(cursor, "MMMM yyyy") : view === "week" ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}` : `Agenda from ${format(range.from, "MMM d")}`;

  return (
    <div className="flex h-full flex-col px-4 py-4 sm:px-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => move(-1)} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => move(1)} aria-label="Next">
            <ChevronRight />
          </Button>
          <h1 className="ml-2 text-lg font-semibold">{title}</h1>
          {items.isFetching ? <Spinner className="size-4" /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentTabs value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "week", label: "Week" }, { value: "agenda", label: "Agenda" }]} className="border-b-0" />
          <SimpleSelect value={projectId || "all"} onChange={(v) => setProjectId(v === "all" ? "" : v)} options={[{ value: "all", label: "All projects" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} className="h-8 w-40 text-xs" />
          <SimpleSelect value={assigneeId || "all"} onChange={(v) => setAssigneeId(v === "all" ? "" : v)} options={[{ value: "all", label: "Anyone" }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} className="h-8 w-36 text-xs" />
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <button key={k} onClick={() => setTypes((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k]))} aria-pressed={types.includes(k)} className={cn("rounded-full border px-2.5 py-1 text-xs", types.includes(k) ? "border-primary bg-primary-soft text-primary" : "border-border text-text-secondary")}>
              {l}s
            </button>
          ))}
          {!isGuest ? (
            <Button size="sm" onClick={() => setNewEvent(new Date())}>
              <Plus /> Event
            </Button>
          ) : null}
        </div>
      </div>

      {view === "agenda" ? (
        <AgendaView items={items.data ?? []} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
          <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className={cn("grid flex-1 grid-cols-7 overflow-auto", view === "month" ? "auto-rows-fr" : "")}>
            {eachDay(range.from, range.to).map((day) => {
              const dayItems = (items.data ?? []).filter((it) => isSameDay(new Date(it.start), day) || (it.end && !it.allDay && new Date(it.start) < day && new Date(it.end) > day && it.kind === "event"));
              return (
                <div
                  key={day.toISOString()}
                  className={cn("min-h-[110px] border-b border-r border-border p-1.5 transition-colors", !isSameMonth(day, cursor) && view === "month" && "bg-surface-2/40 text-text-muted", view === "week" && "min-h-[60vh]")}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onDropOnDay(e, day)}
                  onDoubleClick={() => !isGuest && setNewEvent(day)}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cn("flex size-6 items-center justify-center rounded-full text-xs", isToday(day) && "bg-primary font-semibold text-white")}>{format(day, "d")}</span>
                    {dayItems.length > 3 && view === "month" ? <span className="text-[10px] text-text-muted">{dayItems.length}</span> : null}
                  </div>
                  <div className="space-y-1">
                    {(view === "month" ? dayItems.slice(0, 3) : dayItems).map((it) => (
                      <CalendarChip key={`${it.kind}:${it.id}`} item={it} draggable={!isGuest} />
                    ))}
                    {view === "month" && dayItems.length > 3 ? <button className="text-[10px] text-text-muted hover:text-text" onClick={() => { setCursor(day); setView("week"); }}>+{dayItems.length - 3} more</button> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {newEvent ? <NewEventDialog day={newEvent} onClose={() => setNewEvent(null)} /> : null}
      <ConfirmDialog
        open={Boolean(conflict)}
        onOpenChange={(o) => !o && setConflict(null)}
        title="Schedule conflict"
        description={conflict ? `This overlaps with ${conflict.conflicts.map((c) => `“${c.title}”`).join(", ")} for some participants. Move it anyway?` : ""}
        confirmLabel="Move anyway"
        onConfirm={() => { if (conflict) reschedule.mutate({ item: conflict.item, start: conflict.start, confirm: true }); }}
      />
    </div>
  );
}

function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let d = new Date(from);
  while (d <= to) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

function CalendarChip({ item, draggable }: { item: CalendarItem; draggable: boolean }) {
  const completed = Boolean(item.meta?.completed);
  return (
    <Tooltip content={`${KIND_LABEL[item.kind]}: ${item.title}${item.allDay ? "" : ` · ${format(new Date(item.start), "p")}`}`}>
      <Link
        href={item.href}
        draggable={draggable}
        onDragStart={(e) => e.dataTransfer.setData("application/x-calendar-item", JSON.stringify(item))}
        className={cn("block truncate rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white hover:brightness-110", completed && "opacity-50 line-through", item.kind === "milestone" && "border border-dashed border-white/50")}
        style={{ background: item.color ?? "var(--primary)" }}
      >
        {!item.allDay ? <span className="opacity-80">{format(new Date(item.start), "HH:mm")} </span> : null}
        {item.title}
      </Link>
    </Tooltip>
  );
}

function AgendaView({ items }: { items: CalendarItem[] }) {
  const groups = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const k = format(new Date(it.start), "yyyy-MM-dd");
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  if (!items.length) return <Card className="p-10 text-center text-sm text-text-secondary">Nothing scheduled in this period.</Card>;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-auto">
      {[...groups.entries()].map(([day, list]) => (
        <Card key={day} className="overflow-hidden">
          <div className={cn("border-b border-border px-4 py-2 text-sm font-semibold", isToday(new Date(day)) && "text-primary")}>{format(new Date(day), "EEEE, MMMM d")}</div>
          <ul className="divide-y divide-border">
            {list.map((it) => (
              <li key={`${it.kind}:${it.id}`}>
                <Link href={it.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <span className="size-2.5 rounded-full" style={{ background: it.color ?? "var(--primary)" }} />
                  <span className="w-16 text-xs text-text-muted">{it.allDay ? "All day" : format(new Date(it.start), "p")}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{it.title}</span>
                  <span className="text-[11px] uppercase tracking-wider text-text-muted">{KIND_LABEL[it.kind]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function NewEventDialog({ day, onClose }: { day: Date; onClose: () => void }) {
  const { workspace } = useApp();
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", date: format(day, "yyyy-MM-dd"), start: "10:00", end: "11:00", allDay: false });
  const create = useMutation({
    mutationFn: () => post(`/workspaces/${workspace!.id}/calendar/events`, { title: form.title, description: form.description || undefined, allDay: form.allDay, startsAt: new Date(`${form.date}T${form.allDay ? "00:00" : form.start}`).toISOString(), endsAt: new Date(`${form.date}T${form.allDay ? "23:59" : form.end}`).toISOString() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      toast.success("Event created");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New team event</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title" htmlFor="ev-title">
            <Input id="ev-title" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Team offsite" />
          </Field>
          <Field label="Date" htmlFor="ev-date">
            <Input id="ev-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="accent-primary" /> All day
          </label>
          {!form.allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start" htmlFor="ev-start">
                <Input id="ev-start" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </Field>
              <Field label="End" htmlFor="ev-end">
                <Input id="ev-end" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </Field>
            </div>
          ) : null}
          <Field label="Description" htmlFor="ev-desc">
            <Textarea id="ev-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
