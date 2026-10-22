"use client";

import { Suspense, use, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Calendar, CheckSquare, FileText, Flag, KanbanSquare, MessageSquare, PenTool, Plus, Settings2, Users, Video } from "lucide-react";
import { get, patch, post, del, errorMessage, type MilestoneDto } from "@/lib/api";
import { useProject, useMembers } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SegmentTabs, Progress, SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { Card, PageHeader, Spinner } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";
import { CommentThreads } from "@/components/comments/comment-thread";
import { activityLabel, resourceHref } from "@/components/shared/resource-link";
import { formatDate, timeAgo, cn } from "@/lib/utils";

function ProjectContent({ projectId }: { projectId: string }) {
  const { workspaceSlug, isGuest } = useApp();
  const params = useSearchParams();
  const project = useProject(projectId);
  const qc = useQueryClient();
  const dialogs = useCreateDialogs();
  const [tab, setTab] = useState<"overview" | "discussion" | "milestones" | "settings">((params.get("tab") as "overview") ?? "overview");
  const p = project.data;
  const slug = workspaceSlug!;
  const canEdit = p?.access === "OWNER" || p?.access === "EDITOR";

  useHeader(
    {
      title: p?.name ?? "Project",
      breadcrumbs: [{ label: "Projects", href: `/app/${slug}/projects` }],
      resource: p ? { type: "PROJECT", id: p.id, access: p.access } : null,
      actions: p?.boardId ? (
        <Button asChild size="sm" variant="secondary">
          <Link href={`/app/${slug}/board/${p.boardId}`}>
            <KanbanSquare /> Board
          </Link>
        </Button>
      ) : null,
    },
    [p?.name, p?.id, p?.access, p?.boardId],
  );

  if (project.isLoading)
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  if (!p) return <div className="p-10 text-center text-text-secondary">Project not found.</div>;
  const d = p.dashboard!;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg text-base font-semibold" style={{ background: `${p.color}22`, color: p.color }}>
              {p.icon ?? p.key.slice(0, 2)}
            </span>
            {p.name}
            <Badge variant={p.status === "ACTIVE" ? "success" : p.status === "ON_HOLD" ? "warning" : "secondary"}>{p.status.toLowerCase().replace("_", " ")}</Badge>
            {p.visibility === "PRIVATE" ? <Badge variant="outline">private</Badge> : null}
          </span>
        }
        description={p.description ?? undefined}
        actions={
          !isGuest && canEdit ? (
            <>
              <Button variant="outline" size="sm" onClick={() => dialogs.openCanvas(p.id)}>
                <PenTool /> Canvas
              </Button>
              <Button variant="outline" size="sm" onClick={() => dialogs.openDocument(p.id)}>
                <FileText /> Document
              </Button>
              <Button size="sm" onClick={() => dialogs.openTask(p.id)}>
                <Plus /> Task
              </Button>
            </>
          ) : null
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <UserAvatar user={p.owner ?? null} size="xs" /> Owner: {p.owner?.name}
          </span>
          {p.startDate ? <span>Start {formatDate(p.startDate)}</span> : null}
          {p.dueDate ? <span>Due {formatDate(p.dueDate)}</span> : null}
          <span>{p.members?.length ?? 0} members</span>
        </div>
      </PageHeader>

      <SegmentTabs value={tab} onChange={setTab} options={[{ value: "overview", label: "Overview" }, { value: "discussion", label: "Discussion" }, { value: "milestones", label: "Milestones", count: d.milestones.length }, ...(canEdit ? [{ value: "settings" as const, label: "Settings" }] : [])]} className="mb-6" />

      {tab === "overview" ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Total tasks" value={d.totals.tasks} icon={<CheckSquare />} />
              <Stat label="Completed" value={d.totals.completed} icon={<CheckSquare />} tone="success" />
              <Stat label="Overdue" value={d.totals.overdue} icon={<AlertTriangle />} tone={d.totals.overdue ? "error" : undefined} />
              <Stat label="Progress" value={`${d.totals.percent}%`} icon={<Flag />} />
            </div>
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Tasks by status</h2>
                <Button asChild variant="ghost" size="xs">
                  <Link href={`/app/${slug}/tasks?project=${p.id}`}>Open task list</Link>
                </Button>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
                {Object.entries(d.byStatus).map(([status, count], i) => (
                  <div key={status} className="h-full" style={{ width: `${(count / Math.max(1, d.totals.tasks)) * 100}%`, background: ["#A0A9BC", "#5B8CFF", "#F4B740", "#9B7BFF", "#31B887", "#2FB7D9"][i % 6] }} title={`${status}: ${count}`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                {Object.entries(d.byStatus).map(([status, count], i) => (
                  <span key={status} className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: ["#A0A9BC", "#5B8CFF", "#F4B740", "#9B7BFF", "#31B887", "#2FB7D9"][i % 6] }} />
                    {status.replace("_", " ")} · {count}
                  </span>
                ))}
              </div>
            </Card>
            <div className="grid gap-6 md:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">Upcoming deadlines</h2>
                <TaskMiniList tasks={d.upcomingDeadlines} slug={slug} empty="No upcoming deadlines." />
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold text-error">Overdue</h2>
                <TaskMiniList tasks={d.overdueTasks} slug={slug} empty="Nothing overdue. Nice." overdue />
              </Card>
            </div>
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
              <ul className="space-y-3">
                {d.recentActivity.map((a) => (
                  <li key={a.id} className="flex gap-2.5 text-xs">
                    <UserAvatar user={a.actor} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-text-secondary">
                        <span className="font-medium text-text">{a.actor?.name ?? "Someone"}</span> {activityLabel(a.type, a.payload)}
                        {a.resourceType && a.resourceId && a.resourceTitle ? (
                          <>
                            {" "}
                            <Link href={resourceHref(slug, a.resourceType, a.resourceId)} className="font-medium text-text hover:underline">
                              {a.resourceTitle}
                            </Link>
                          </>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-text-muted">{timeAgo(a.createdAt)}</p>
                    </div>
                  </li>
                ))}
                {d.recentActivity.length === 0 ? <li className="py-3 text-center text-sm text-text-secondary">No activity yet.</li> : null}
              </ul>
            </Card>
          </div>
          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Users className="size-4 text-primary" /> Team workload
              </h2>
              <ul className="space-y-3">
                {d.workload.map((w) => (
                  <li key={w.user.id} className="flex items-center gap-2.5">
                    <UserAvatar user={w.user} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate font-medium">{w.user.name}</span>
                        <span className="text-xs text-text-muted">
                          {w.open} open · {w.done} done
                        </span>
                      </div>
                      <Progress value={w.open + w.done ? (w.done / (w.open + w.done)) * 100 : 0} className="mt-1" />
                    </div>
                  </li>
                ))}
              </ul>
              {canEdit ? <AddMember projectId={p.id} existing={(p.members ?? []).map((m) => m.userId)} /> : null}
            </Card>
            <LinkedList title="Documents" icon={<FileText className="size-4 text-primary" />} items={d.documents.map((x) => ({ id: x.id, label: `${x.icon ?? "📄"} ${x.title}`, href: `/app/${slug}/docs/${x.id}`, meta: formatDate(x.updatedAt) }))} empty="No documents in this project." />
            <LinkedList title="Canvases" icon={<PenTool className="size-4 text-primary" />} items={d.canvases.map((x) => ({ id: x.id, label: x.title, href: `/app/${slug}/canvas/${x.id}`, meta: formatDate(x.updatedAt) }))} empty="No canvases in this project." />
            <LinkedList title="Meetings" icon={<Video className="size-4 text-primary" />} items={d.meetings.map((x) => ({ id: x.id, label: x.title, href: `/app/${slug}/meetings/${x.id}`, meta: formatDate(x.startsAt) }))} empty="No meetings yet." />
          </div>
        </div>
      ) : null}

      {tab === "discussion" ? (
        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4 text-primary" /> Project discussion
          </h2>
          <p className="mb-4 text-xs text-text-secondary">Threaded conversation about this project. Use @ to mention teammates.</p>
          <CommentThreads resourceType="PROJECT" resourceId={p.id} canComment={!isGuest || canEdit} />
        </Card>
      ) : null}

      {tab === "milestones" ? <Milestones projectId={p.id} milestones={d.milestones} canEdit={Boolean(canEdit)} /> : null}

      {tab === "settings" && canEdit ? <ProjectSettings projectId={p.id} initial={p} onSaved={() => void qc.invalidateQueries({ queryKey: ["project", p.id] })} /> : null}
    </div>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return (
    <Suspense>
      <ProjectContent projectId={projectId} />
    </Suspense>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: number | string; icon: React.ReactNode; tone?: "success" | "error" }) {
  return (
    <Card className="p-4">
      <div className={cn("mb-2 flex size-8 items-center justify-center rounded-md [&_svg]:size-4", tone === "success" ? "bg-success-soft text-success" : tone === "error" ? "bg-error-soft text-error" : "bg-primary-soft text-primary")}>{icon}</div>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-text-secondary">{label}</p>
    </Card>
  );
}

function TaskMiniList({ tasks, slug, empty, overdue }: { tasks: Array<{ id: string; title: string; number: number; dueDate: string | null; status: string }>; slug: string; empty: string; overdue?: boolean }) {
  if (!tasks.length) return <p className="py-3 text-center text-sm text-text-secondary">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link href={`/app/${slug}/tasks?task=${t.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <span className={cn("text-[11px]", overdue ? "text-error" : "text-text-muted")}>{t.dueDate ? formatDate(t.dueDate) : ""}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LinkedList({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: Array<{ id: string; label: string; href: string; meta?: string }>; empty: string }) {
  return (
    <Card className="p-5">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
      </h2>
      {items.length ? (
        <ul className="space-y-0.5">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={it.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.meta ? <span className="text-[11px] text-text-muted">{it.meta}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-3 text-center text-sm text-text-secondary">{empty}</p>
      )}
    </Card>
  );
}

function AddMember({ projectId, existing }: { projectId: string; existing: string[] }) {
  const { workspace } = useApp();
  const members = useMembers(workspace?.id);
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const candidates = (members.data ?? []).filter((m) => !existing.includes(m.user.id));
  const add = useMutation({
    mutationFn: () => post(`/projects/${projectId}/members`, { userId, role: "MEMBER" }),
    onSuccess: () => {
      setUserId("");
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Member added");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!candidates.length) return null;
  return (
    <div className="mt-4 flex gap-2">
      <SimpleSelect value={userId || undefined} onChange={setUserId} placeholder="Add a member…" options={candidates.map((m) => ({ value: m.user.id, label: m.user.name }))} className="flex-1" />
      <Button size="sm" disabled={!userId} loading={add.isPending} onClick={() => add.mutate()}>
        Add
      </Button>
    </div>
  );
}

function Milestones({ projectId, milestones, canEdit }: { projectId: string; milestones: MilestoneDto[]; canEdit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: ["project", projectId] });
  const create = useMutation({
    mutationFn: () => post(`/projects/${projectId}/milestones`, { title, dueDate: new Date(due).toISOString() }),
    onSuccess: () => {
      setOpen(false);
      setTitle("");
      setDue("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Flag className="size-4 text-primary" /> Milestones
        </h2>
        {canEdit ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> Milestone
          </Button>
        ) : null}
      </div>
      {milestones.length === 0 ? <p className="py-6 text-center text-sm text-text-secondary">No milestones yet. Milestones appear on the calendar and timeline.</p> : null}
      <ol className="relative space-y-4 border-l border-border pl-5">
        {milestones.map((m) => {
          const overdue = !m.completedAt && new Date(m.dueDate) < new Date();
          return (
            <li key={m.id} className="relative">
              <span className={cn("absolute -left-[26px] top-1 size-3 rounded-full border-2 border-surface", m.completedAt ? "bg-success" : overdue ? "bg-error" : "bg-primary")} />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className={cn("text-sm font-medium", m.completedAt && "text-text-muted line-through")}>{m.title}</p>
                  <p className="text-xs text-text-muted">
                    <Calendar className="mr-1 inline size-3" /> {formatDate(m.dueDate)} {overdue ? <span className="text-error">· overdue</span> : null}
                  </p>
                  {m.description ? <p className="mt-1 text-xs text-text-secondary">{m.description}</p> : null}
                </div>
                {canEdit ? (
                  <div className="flex gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={async () => {
                        await patch(`/projects/${projectId}/milestones/${m.id}`, { completedAt: m.completedAt ? null : new Date().toISOString() });
                        refresh();
                      }}
                    >
                      {m.completedAt ? "Reopen" : "Complete"}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={async () => {
                        await del(`/projects/${projectId}/milestones/${m.id}`);
                        refresh();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New milestone</DialogTitle>
          </DialogHeader>
          <Field label="Title" htmlFor="ms-title">
            <Input id="ms-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          <Field label="Due date" htmlFor="ms-due">
            <Input id="ms-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!title.trim() || !due} loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProjectSettings({ projectId, initial, onSaved }: { projectId: string; initial: { name: string; description: string | null; status: string; visibility: string; color: string; startDate: string | null; dueDate: string | null; ownerId: string }; onSaved: () => void }) {
  const { workspace } = useApp();
  const members = useMembers(workspace?.id);
  const [form, setForm] = useState({ name: initial.name, description: initial.description ?? "", status: initial.status, visibility: initial.visibility, color: initial.color, startDate: initial.startDate?.slice(0, 10) ?? "", dueDate: initial.dueDate?.slice(0, 10) ?? "", ownerId: initial.ownerId });
  const save = useMutation({
    mutationFn: () => patch(`/projects/${projectId}`, { ...form, description: form.description || null, startDate: form.startDate ? new Date(form.startDate).toISOString() : null, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null, ownerId: form.ownerId !== initial.ownerId ? form.ownerId : undefined }),
    onSuccess: () => {
      toast.success("Project updated");
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const colors = ["#5B8CFF", "#9B7BFF", "#31B887", "#F4B740", "#EF6464", "#2FB7D9", "#E06AB5", "#7FB534"];
  return (
    <Card className="max-w-2xl p-6">
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
        <Settings2 className="size-4" /> Project settings
      </h2>
      <div className="space-y-4">
        <Field label="Name" htmlFor="ps-name">
          <Input id="ps-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description" htmlFor="ps-desc">
          <Textarea id="ps-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <SimpleSelect value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"].map((s) => ({ value: s, label: s.toLowerCase().replace("_", " ") }))} />
          </Field>
          <Field label="Visibility">
            <SimpleSelect value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} options={[{ value: "WORKSPACE", label: "Everyone in workspace" }, { value: "PRIVATE", label: "Project members only" }]} />
          </Field>
          <Field label="Start date" htmlFor="ps-start">
            <Input id="ps-start" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="Due date" htmlFor="ps-due">
            <Input id="ps-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
          <Field label="Owner">
            <SimpleSelect value={form.ownerId} onChange={(v) => setForm({ ...form, ownerId: v })} options={(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))} />
          </Field>
          <Field label="Color">
            <div className="flex flex-wrap gap-2 pt-1">
              {colors.map((c) => (
                <button key={c} aria-label={c} aria-pressed={form.color === c} onClick={() => setForm({ ...form, color: c })} className={cn("size-7 rounded-full ring-offset-2 ring-offset-surface", form.color === c && "ring-2 ring-primary")} style={{ background: c }} />
              ))}
            </div>
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}
