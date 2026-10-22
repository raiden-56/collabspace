"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, Plus, Video, Clock, FileText, Sparkles } from "lucide-react";
import { post, errorMessage, type MeetingDto } from "@/lib/api";
import { useMeetings, useProjects, useMembers } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SegmentTabs, SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { AvatarStack } from "@/components/ui/avatar";
import { Card, EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { formatDate, cn } from "@/lib/utils";

const STATUS_BADGE: Record<string, "default" | "success" | "secondary" | "warning" | "error"> = { SCHEDULED: "default", IN_PROGRESS: "warning", COMPLETED: "success", CANCELLED: "secondary" };

function MeetingsContent() {
  const { workspace, workspaceSlug, isGuest } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  useHeader({ title: "Meetings" });
  const [tab, setTab] = useState<"upcoming" | "past" | "all">("upcoming");
  const [projectId, setProjectId] = useState("");
  const [open, setOpen] = useState(params.get("new") === "1");
  useEffect(() => setOpen(params.get("new") === "1"), [params]);
  const meetings = useMeetings(workspace?.id, projectId || undefined);
  const projects = useProjects(workspace?.id);
  const now = Date.now();
  const list = (meetings.data ?? []).filter((m) => {
    const end = new Date(m.startsAt).getTime() + m.durationMin * 60_000;
    if (tab === "upcoming") return end >= now && m.status !== "CANCELLED" && m.status !== "COMPLETED";
    if (tab === "past") return end < now || m.status === "COMPLETED" || m.status === "CANCELLED";
    return true;
  });
  const sorted = tab === "upcoming" ? [...list].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()) : list;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Meetings"
        description="Agendas, collaborative notes, decisions and AI-assisted summaries."
        actions={
          !isGuest ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New meeting
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentTabs value={tab} onChange={setTab} options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past" }, { value: "all", label: "All" }]} />
        <SimpleSelect value={projectId || "all"} onChange={(v) => setProjectId(v === "all" ? "" : v)} options={[{ value: "all", label: "All projects" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} className="w-48" />
      </div>
      {meetings.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Video />} title={tab === "upcoming" ? "No upcoming meetings" : "No meetings"} description="Create a meeting to prepare an agenda, take collaborative notes and generate an AI summary from the transcript." action={!isGuest ? <Button onClick={() => setOpen(true)}><Plus /> Schedule a meeting</Button> : undefined} />
      ) : (
        <ul className="space-y-2">
          {sorted.map((m) => (
            <li key={m.id}>
              <Link href={`/app/${workspaceSlug}/meetings/${m.id}`} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-2 text-center">
                  <span className="text-[10px] font-semibold uppercase text-text-muted">{new Date(m.startsAt).toLocaleDateString(undefined, { month: "short" })}</span>
                  <span className="text-xl font-semibold leading-none">{new Date(m.startsAt).getDate()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{m.title}</p>
                    <Badge variant={STATUS_BADGE[m.status]}>{m.status.toLowerCase().replace("_", " ")}</Badge>
                    {m._count?.transcripts ? (
                      <Badge variant="violet">
                        <Sparkles className="size-3" /> transcript
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" /> {formatDate(m.startsAt, true)} · {m.durationMin} min
                    </span>
                    {m.project ? <span>{m.project.name}</span> : null}
                    {m._count?.actionItems ? <span>{m._count.actionItems} action items</span> : null}
                    {m.notesDocument ? (
                      <span className="flex items-center gap-1">
                        <FileText className="size-3" /> notes
                      </span>
                    ) : null}
                  </p>
                </div>
                <AvatarStack users={m.participants.map((p) => p.user)} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewMeetingDialog
        open={open}
        onClose={() => {
          setOpen(false);
          if (params.get("new")) router.replace(`/app/${workspaceSlug}/meetings`);
        }}
      />
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense>
      <MeetingsContent />
    </Suspense>
  );
}

function NewMeetingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace, workspaceSlug, user } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const projects = useProjects(workspace?.id);
  const members = useMembers(workspace?.id);
  const defaultDate = new Date(Date.now() + 60 * 60_000);
  defaultDate.setMinutes(0, 0, 0);
  const [form, setForm] = useState({ title: "", description: "", date: defaultDate.toISOString().slice(0, 10), time: `${String(defaultDate.getHours()).padStart(2, "0")}:00`, durationMin: 30, projectId: "", facilitatorId: user?.id ?? "", participantIds: [] as string[], agenda: "" });
  const create = useMutation({
    mutationFn: () =>
      post<MeetingDto>("/meetings", {
        workspaceId: workspace!.id,
        title: form.title.trim(),
        description: form.description || undefined,
        startsAt: new Date(`${form.date}T${form.time}`).toISOString(),
        durationMin: form.durationMin,
        projectId: form.projectId || null,
        facilitatorId: form.facilitatorId || null,
        participantIds: form.participantIds,
        agenda: form.agenda
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((title, i) => ({ id: `a${i + 1}`, title: title.replace(/^\d+[.)]\s*/, ""), done: false })),
      }),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: ["meetings"] });
      onClose();
      router.push(`/app/${workspaceSlug}/meetings/${m.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = (id: string) => setForm((f) => ({ ...f, participantIds: f.participantIds.includes(id) ? f.participantIds.filter((x) => x !== id) : [...f.participantIds, id] }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
          <DialogDescription>A collaborative notes document is created automatically. Participants receive an invitation.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="m-title" className="sm:col-span-2">
            <Input id="m-title" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Sprint planning" />
          </Field>
          <Field label="Date" htmlFor="m-date">
            <Input id="m-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" htmlFor="m-time">
              <Input id="m-time" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </Field>
            <Field label="Duration">
              <SimpleSelect value={String(form.durationMin)} onChange={(v) => setForm({ ...form, durationMin: Number(v) })} options={[15, 30, 45, 60, 90, 120].map((d) => ({ value: String(d), label: `${d} min` }))} />
            </Field>
          </div>
          <Field label="Project">
            <SimpleSelect value={form.projectId || "none"} onChange={(v) => setForm({ ...form, projectId: v === "none" ? "" : v })} options={[{ value: "none", label: "No project" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          </Field>
          <Field label="Facilitator">
            <SimpleSelect value={form.facilitatorId} onChange={(v) => setForm({ ...form, facilitatorId: v })} options={(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))} />
          </Field>
          <Field label="Participants" className="sm:col-span-2">
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {(members.data ?? [])
                .filter((m) => m.user.id !== user?.id)
                .map((m) => (
                  <button key={m.user.id} type="button" onClick={() => toggle(m.user.id)} aria-pressed={form.participantIds.includes(m.user.id)} className={cn("rounded-full border px-2.5 py-1 text-xs", form.participantIds.includes(m.user.id) ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>
                    {m.user.name}
                  </button>
                ))}
            </div>
          </Field>
          <Field label="Agenda" htmlFor="m-agenda" hint="One item per line." className="sm:col-span-2">
            <Textarea id="m-agenda" rows={3} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} placeholder={"Progress since last week\nBlockers\nNext steps"} />
          </Field>
          <Field label="Description" htmlFor="m-desc" className="sm:col-span-2">
            <Textarea id="m-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!form.title.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            <Calendar /> Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
