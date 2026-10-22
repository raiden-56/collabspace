"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertCircle, Check, CheckSquare, ChevronDown, ChevronRight, Clock, FileText, Gavel, Info, ListChecks, MessageSquare, PenTool, Play, Plus, RefreshCw, Sparkles, Square, Trash2, Upload, Users, X, Pencil } from "lucide-react";
import { get, post, patch, del, errorMessage, type MeetingDto, type ActionItemDto, type SummaryContent } from "@/lib/api";
import { useMeeting, useMembers, useProjects } from "@/lib/queries";
import { useRealtime } from "@/lib/realtime";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { CommentThreads } from "@/components/comments/comment-thread";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SegmentTabs, SimpleSelect, Checkbox } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { Card, Spinner } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Tooltip, ConfirmDialog } from "@/components/ui/overlays";
import { formatDate, cn } from "@/lib/utils";

const DocumentEditor = dynamic(() => import("@/components/editor/document-editor").then((m) => m.DocumentEditor), { ssr: false, loading: () => <div className="flex h-64 items-center justify-center"><Spinner /></div> });

type Tab = "notes" | "summary" | "actions" | "discussion";

export default function MeetingPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = use(params);
  const { workspaceSlug, user } = useApp();
  const qc = useQueryClient();
  const meeting = useMeeting(meetingId);
  const m = meeting.data;
  const canEdit = m?.access === "OWNER" || m?.access === "EDITOR";
  const [tab, setTab] = useState<Tab>("notes");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["meeting", meetingId] });
  useRealtime(`resource:meeting:${meetingId}`, (ev) => {
    if (ev.t === "meeting:updated" || ev.t === "ai:job" || ev.t === "comment:updated") refresh();
  });

  useHeader(
    {
      title: m?.title ?? "Meeting",
      breadcrumbs: workspaceSlug ? [{ label: "Meetings", href: `/app/${workspaceSlug}/meetings` }, ...(m?.project ? [{ label: m.project.name, href: `/app/${workspaceSlug}/projects/${m.project.id}` }] : [])] : [],
      resource: m ? { type: "MEETING", id: meetingId, access: m.access } : null,
      status: m ? <Badge variant={m.status === "COMPLETED" ? "success" : m.status === "IN_PROGRESS" ? "warning" : m.status === "CANCELLED" ? "secondary" : "default"}>{m.status.toLowerCase().replace("_", " ")}</Badge> : null,
    },
    [m?.title, m?.status, m?.access, m?.project?.id],
  );

  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => patch(`/meetings/${meetingId}`, body), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const summarize = useMutation({
    mutationFn: () => post(`/meetings/${meetingId}/summarize`, { consent: true, includeNotes: true }),
    onSuccess: () => {
      setConsentOpen(false);
      setTab("summary");
      refresh();
      toast.success("Summary requested. It will appear here when ready.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rsvp = useMutation({ mutationFn: (status: string) => post(`/meetings/${meetingId}/rsvp`, { status }), onSuccess: refresh });

  if (meeting.isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!m) return <div className="p-10 text-center text-text-secondary">Meeting not found.</div>;
  const latestSummary = m.summaries?.[0];
  const inFlight = latestSummary && (latestSummary.status === "PENDING" || latestSummary.status === "RUNNING");
  const drafts = (m.actionItems ?? []).filter((a) => a.status === "DRAFT").length;
  const mine = m.participants.find((p) => p.userId === user?.id);
  const end = new Date(new Date(m.startsAt).getTime() + m.durationMin * 60_000);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{m.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
            <span className="flex items-center gap-1"><Clock className="size-3.5" /> {formatDate(m.startsAt, true)} – {end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {m.durationMin} min</span>
            {m.facilitator ? <span className="flex items-center gap-1"><UserAvatar user={m.facilitator} size="xs" /> Facilitator: {m.facilitator.name}</span> : null}
            {m.project ? <Link href={`/app/${workspaceSlug}/projects/${m.project.id}`} className="hover:underline">{m.project.name}</Link> : null}
          </p>
          {m.description ? <p className="mt-2 max-w-2xl text-sm text-text-secondary">{m.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mine && mine.status === "INVITED" ? (
            <>
              <Button size="sm" variant="subtle" onClick={() => rsvp.mutate("ACCEPTED")}><Check /> Accept</Button>
              <Button size="sm" variant="outline" onClick={() => rsvp.mutate("TENTATIVE")}>Maybe</Button>
              <Button size="sm" variant="ghost" onClick={() => rsvp.mutate("DECLINED")}>Decline</Button>
            </>
          ) : null}
          {canEdit && m.status === "SCHEDULED" ? <Button size="sm" onClick={() => update.mutate({ status: "IN_PROGRESS" })}><Play /> Start meeting</Button> : null}
          {canEdit && m.status === "IN_PROGRESS" ? <Button size="sm" onClick={() => update.mutate({ status: "COMPLETED" })}><Square /> End meeting</Button> : null}
          {canEdit && m.status === "COMPLETED" ? <Button size="sm" variant="outline" onClick={() => update.mutate({ status: "IN_PROGRESS" })}>Reopen</Button> : null}
          {canEdit ? <Button size="sm" variant="outline" onClick={() => setTranscriptOpen(true)}><Upload /> Add transcript</Button> : null}
          {canEdit ? (
            <Tooltip content={m.transcripts?.length ? (m.ai?.enabled ? "Generate an AI summary from the latest transcript" : "AI is disabled on this server") : "Add a transcript first"}>
              <span><Button size="sm" disabled={!m.transcripts?.length || !m.ai?.enabled || Boolean(inFlight)} loading={Boolean(inFlight)} onClick={() => setConsentOpen(true)}><Sparkles /> {latestSummary ? "Regenerate summary" : "Summarize"}</Button></span>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <SegmentTabs value={tab} onChange={setTab} options={[{ value: "notes", label: <span className="flex items-center gap-1.5"><FileText className="size-4" /> Notes</span> }, { value: "summary", label: <span className="flex items-center gap-1.5"><Sparkles className="size-4" /> AI summary</span>, count: m.summaries?.length }, { value: "actions", label: <span className="flex items-center gap-1.5"><ListChecks className="size-4" /> Action items</span>, count: drafts || undefined }, { value: "discussion", label: <span className="flex items-center gap-1.5"><MessageSquare className="size-4" /> Discussion</span> }]} className="mb-4" />
          {tab === "notes" ? (
            m.notesDocumentId ? (
              <Card className="h-[70vh] overflow-hidden"><DocumentEditor documentId={m.notesDocumentId} embedded /></Card>
            ) : (
              <Card className="p-8 text-center text-sm text-text-secondary">This meeting has no notes document.</Card>
            )
          ) : null}
          {tab === "summary" ? <SummaryTab meeting={m} canEdit={Boolean(canEdit)} onRefresh={refresh} onRequest={() => setConsentOpen(true)} /> : null}
          {tab === "actions" ? <ActionItemsTab meeting={m} canEdit={Boolean(canEdit)} onRefresh={refresh} /> : null}
          {tab === "discussion" ? (
            <Card className="p-5"><CommentThreads resourceType="MEETING" resourceId={meetingId} canComment={Boolean(m.access)} /></Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <AgendaPanel meeting={m} canEdit={Boolean(canEdit)} onSave={(agenda) => update.mutate({ agenda })} />
          <Card className="p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Users className="size-4 text-primary" /> Participants ({m.participants.length})</h3>
            <ul className="space-y-1.5">
              {m.participants.map((p) => (
                <li key={p.userId} className="flex items-center gap-2 text-sm">
                  <UserAvatar user={p.user} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{p.user.name}</span>
                  <Badge variant={p.status === "ACCEPTED" ? "success" : p.status === "DECLINED" ? "error" : p.status === "TENTATIVE" ? "warning" : "secondary"}>{p.status.toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
            {canEdit ? <ParticipantsEditor meeting={m} onSave={(ids) => update.mutate({ participantIds: ids })} /> : null}
          </Card>
          <DecisionsPanel meeting={m} canEdit={Boolean(canEdit)} onRefresh={refresh} />
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Linked resources</h3>
            <ul className="space-y-1 text-sm">
              {m.linked?.canvases.map((c) => <li key={c.id}><Link href={`/app/${workspaceSlug}/canvas/${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2"><PenTool className="size-3.5 text-text-muted" /> {c.title}</Link></li>)}
              {m.linked?.documents.map((d) => <li key={d.id}><Link href={`/app/${workspaceSlug}/docs/${d.id}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2"><span>{d.icon ?? "📄"}</span> {d.title}</Link></li>)}
              {!m.linked?.canvases.length && !m.linked?.documents.length ? <li className="text-xs text-text-muted">No linked canvases or documents.</li> : null}
            </ul>
            {canEdit ? <LinkResources meeting={m} onSave={(body) => update.mutate(body)} /> : null}
          </Card>
          {m.transcripts?.length ? (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">Transcripts</h3>
              <ul className="space-y-2">
                {m.transcripts.map((t) => (
                  <li key={t.id} className="rounded-md border border-border p-2 text-xs">
                    <p className="flex items-center justify-between text-text-muted"><span>{t.source.toLowerCase()} · {formatDate(t.createdAt, true)}</span><span>{t.length.toLocaleString()} chars</span></p>
                    <p className="mt-1 line-clamp-3 text-text-secondary">{t.preview}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {m.history?.length ? (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">Related meetings</h3>
              <ul className="space-y-1 text-sm">
                {m.history.map((h) => <li key={h.id}><Link href={`/app/${workspaceSlug}/meetings/${h.id}`} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-surface-2"><span className="truncate">{h.title}</span><span className="text-xs text-text-muted">{formatDate(h.startsAt)}</span></Link></li>)}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      {transcriptOpen ? <TranscriptDialog meetingId={meetingId} onClose={() => setTranscriptOpen(false)} onAdded={refresh} /> : null}
      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Generate AI summary?</DialogTitle>
            <DialogDescription>The latest transcript and the collaborative notes will be processed by the configured AI provider ({m.ai?.provider}). {m.ai?.dataSentToProvider}</DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-surface-2 p-3 text-xs text-text-secondary">The summary, decisions and action items are drafts linked to transcript excerpts. Nothing becomes a task until you review and confirm it.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentOpen(false)}>Cancel</Button>
            <Button onClick={() => summarize.mutate()} loading={summarize.isPending}><Sparkles /> I understand, summarize</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgendaPanel({ meeting: m, canEdit, onSave }: { meeting: MeetingDto; canEdit: boolean; onSave: (agenda: MeetingDto["agenda"]) => void }) {
  const [items, setItems] = useState(m.agenda);
  const [draft, setDraft] = useState("");
  useEffect(() => setItems(m.agenda), [m.agenda]);
  const commit = (next: MeetingDto["agenda"]) => { setItems(next); onSave(next); };
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">Agenda</h3>
      <ul className="space-y-1">
        {items.map((a, i) => (
          <li key={a.id} className="flex items-start gap-2 text-sm">
            <Checkbox checked={a.done} disabled={!canEdit} onCheckedChange={(v) => commit(items.map((x, j) => (j === i ? { ...x, done: v === true } : x)))} className="mt-0.5" aria-label={`Done ${a.title}`} />
            <span className={cn("min-w-0 flex-1", a.done && "text-text-muted line-through")}>{i + 1}. {a.title}{a.durationMin ? <span className="ml-1 text-xs text-text-muted">· {a.durationMin} min</span> : null}</span>
            {canEdit ? <button onClick={() => commit(items.filter((_, j) => j !== i))} className="text-text-muted hover:text-error" aria-label="Remove agenda item"><X className="size-3.5" /></button> : null}
          </li>
        ))}
        {items.length === 0 ? <li className="text-xs text-text-muted">No agenda items yet.</li> : null}
      </ul>
      {canEdit ? (
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { commit([...items, { id: `a${Date.now()}`, title: draft.trim(), done: false }]); setDraft(""); } }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add agenda item" className="h-8 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}><Plus /></Button>
        </form>
      ) : null}
    </Card>
  );
}

function ParticipantsEditor({ meeting: m, onSave }: { meeting: MeetingDto; onSave: (ids: string[]) => void }) {
  const { workspace } = useApp();
  const members = useMembers(workspace?.id);
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>(m.participants.map((p) => p.userId));
  useEffect(() => setIds(m.participants.map((p) => p.userId)), [m.participants]);
  if (!open) return <Button variant="ghost" size="xs" className="mt-2" onClick={() => setOpen(true)}><Plus /> Manage participants</Button>;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
        {(members.data ?? []).map((mem) => (
          <button key={mem.user.id} type="button" onClick={() => setIds((x) => (x.includes(mem.user.id) ? x.filter((y) => y !== mem.user.id) : [...x, mem.user.id]))} aria-pressed={ids.includes(mem.user.id)} className={cn("rounded-full border px-2 py-0.5 text-xs", ids.includes(mem.user.id) ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>{mem.user.name}</button>
        ))}
      </div>
      <div className="flex gap-1.5"><Button size="xs" onClick={() => { onSave(ids); setOpen(false); }}>Save</Button><Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>
  );
}

function LinkResources({ meeting: m, onSave }: { meeting: MeetingDto; onSave: (body: { linkedCanvasIds?: string[]; linkedDocumentIds?: string[] }) => void }) {
  const { workspace } = useApp();
  const [open, setOpen] = useState(false);
  const canvases = useQuery<Array<{ id: string; title: string }>>({ queryKey: ["canvases", workspace?.id, null], queryFn: () => get(`/workspaces/${workspace!.id}/canvases`), enabled: open && Boolean(workspace) });
  const docs = useQuery<Array<{ id: string; title: string }>>({ queryKey: ["documents", workspace?.id, null], queryFn: () => get(`/workspaces/${workspace!.id}/documents`), enabled: open && Boolean(workspace) });
  if (!open) return <Button variant="ghost" size="xs" className="mt-2" onClick={() => setOpen(true)}><Plus /> Link canvas or document</Button>;
  return (
    <div className="mt-3 space-y-2">
      <SimpleSelect value={undefined} onChange={(id) => onSave({ linkedCanvasIds: [...new Set([...m.linkedCanvasIds, id])] })} placeholder="Add a canvas…" options={(canvases.data ?? []).filter((c) => !m.linkedCanvasIds.includes(c.id)).map((c) => ({ value: c.id, label: c.title }))} className="h-8 text-xs" />
      <SimpleSelect value={undefined} onChange={(id) => onSave({ linkedDocumentIds: [...new Set([...m.linkedDocumentIds, id])] })} placeholder="Add a document…" options={(docs.data ?? []).filter((d) => !m.linkedDocumentIds.includes(d.id) && d.id !== m.notesDocumentId).map((d) => ({ value: d.id, label: d.title }))} className="h-8 text-xs" />
      <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Done</Button>
    </div>
  );
}

function DecisionsPanel({ meeting: m, canEdit, onRefresh }: { meeting: MeetingDto; canEdit: boolean; onRefresh: () => void }) {
  const [text, setText] = useState("");
  const add = useMutation({ mutationFn: () => post(`/meetings/${m.id}/decisions`, { text: text.trim() }), onSuccess: () => { setText(""); onRefresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/meetings/${m.id}/decisions/${id}`), onSuccess: onRefresh });
  return (
    <Card className="p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Gavel className="size-4 text-primary" /> Decisions ({m.decisions?.length ?? 0})</h3>
      <ul className="space-y-1.5">
        {m.decisions?.map((d) => (
          <li key={d.id} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 flex-1">{d.text}{d.source.startsWith("ai:") ? <Badge variant="violet" className="ml-1.5">AI</Badge> : null}</span>
            {canEdit ? <button onClick={() => remove.mutate(d.id)} className="text-text-muted hover:text-error" aria-label="Remove decision"><X className="size-3.5" /></button> : null}
          </li>
        ))}
        {!m.decisions?.length ? <li className="text-xs text-text-muted">No decisions recorded yet.</li> : null}
      </ul>
      {canEdit ? (
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Record a decision" className="h-8 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={!text.trim()}><Plus /></Button>
        </form>
      ) : null}
    </Card>
  );
}

function SummaryTab({ meeting: m, canEdit, onRefresh, onRequest }: { meeting: MeetingDto; canEdit: boolean; onRefresh: () => void; onRequest: () => void }) {
  const [index, setIndex] = useState(0);
  const s = m.summaries?.[index];
  const [editing, setEditing] = useState(false);
  const [recap, setRecap] = useState("");
  const content: SummaryContent | null = (s?.editedContent ?? s?.content) ?? null;
  useEffect(() => setRecap(content?.recap ?? ""), [content?.recap]);
  const save = useMutation({ mutationFn: () => patch(`/meetings/${m.id}/summaries/${s!.id}`, { editedContent: { ...content, recap } }), onSuccess: () => { setEditing(false); onRefresh(); toast.success("Summary edited"); }, onError: (e) => toast.error(errorMessage(e)) });

  if (!m.summaries?.length) {
    return (
      <Card className="p-8 text-center">
        <Sparkles className="mx-auto mb-3 size-8 text-secondary" />
        <h3 className="font-semibold">No summary yet</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">Add a transcript (paste or upload) and generate a summary. You will see a recap, discussion topics, decisions, open questions and action-item drafts, each linked to the transcript excerpt that supports it.</p>
        {canEdit ? <Button className="mt-5" disabled={!m.transcripts?.length || !m.ai?.enabled} onClick={onRequest}><Sparkles /> Summarize</Button> : null}
        {!m.ai?.enabled ? <p className="mt-3 text-xs text-warning">AI features are disabled on this server.</p> : null}
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {m.summaries.length > 1 ? (
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          Version
          <SimpleSelect value={String(index)} onChange={(v) => setIndex(Number(v))} options={m.summaries.map((x, i) => ({ value: String(i), label: `${formatDate(x.createdAt, true)} · ${x.status.toLowerCase()}` }))} className="h-7 w-56 text-xs" />
        </div>
      ) : null}
      {s?.status === "PENDING" || s?.status === "RUNNING" ? (
        <Card className="flex items-center gap-3 p-6"><Spinner /><div><p className="font-medium">Generating summary…</p><p className="text-xs text-text-secondary">Using {s.model ?? m.ai?.provider}. This usually takes a few seconds; the page updates automatically.</p></div></Card>
      ) : s?.status === "FAILED" ? (
        <Card className="flex items-start gap-3 border-error/40 p-5"><AlertCircle className="mt-0.5 size-5 text-error" /><div className="flex-1"><p className="font-medium">Summary failed</p><p className="text-sm text-text-secondary">{s.error ?? s.aiJob?.error ?? "The AI provider returned an error."}</p>{canEdit ? <Button size="sm" variant="outline" className="mt-3" onClick={onRequest}><RefreshCw /> Try again</Button> : null}</div></Card>
      ) : content ? (
        <>
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-secondary" /> Recap <Badge variant="violet">AI-generated · {content.generatedBy}</Badge>{s?.editedContent ? <Badge variant="secondary">edited</Badge> : null}</h3>
              {canEdit ? <Button size="xs" variant="ghost" onClick={() => setEditing(!editing)}><Pencil /> {editing ? "Cancel" : "Edit"}</Button> : null}
            </div>
            {editing ? (
              <div className="space-y-2"><Textarea value={recap} onChange={(e) => setRecap(e.target.value)} rows={4} /><Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Save edit</Button></div>
            ) : (
              <p className="text-sm leading-relaxed">{content.recap}</p>
            )}
            <p className="mt-3 flex items-center gap-1 text-[11px] text-text-muted"><Info className="size-3" /> Generated {s ? formatDate(s.createdAt, true) : ""} from the transcript{m.notesDocumentId ? " and collaborative notes" : ""}. Items reference verbatim excerpts; verify before acting.</p>
          </Card>
          {content.topics.length ? (
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold">Discussion by topic</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {content.topics.map((t) => (
                  <div key={t.title} className="rounded-lg bg-surface-2 p-3">
                    <p className="mb-1 text-sm font-medium">{t.title}</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-secondary">{t.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Gavel className="size-4" /> Proposed decisions ({content.decisions.length})</h3>
              <Excerpts items={content.decisions} empty="No decisions detected." />
            </Card>
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-semibold">Open questions ({content.openQuestions.length})</h3>
              <Excerpts items={content.openQuestions} empty="No unresolved questions detected." />
            </Card>
          </div>
          <Card className="p-5">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><ListChecks className="size-4" /> Action items ({content.actionItems.length})</h3>
            <p className="mb-3 text-xs text-text-secondary">These were added to the Action items tab as drafts for review.</p>
            <Excerpts items={content.actionItems.map((a) => ({ text: `${a.text}${a.suggestedOwner ? ` — ${a.suggestedOwner}` : ""}${a.suggestedDue ? ` · ${a.suggestedDue}` : ""}`, excerpt: a.excerpt }))} empty="No action items detected." />
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Excerpts({ items, empty }: { items: Array<{ text: string; excerpt?: string }>; empty: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!items.length) return <p className="text-xs text-text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="text-sm">
          <button className="flex w-full items-start gap-1.5 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            {it.excerpt ? (open === i ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-text-muted" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-text-muted" />) : <span className="mt-2 size-1.5 shrink-0 rounded-full bg-text-muted" />}
            <span>{it.text}</span>
          </button>
          {open === i && it.excerpt ? <blockquote className="ml-5 mt-1 border-l-2 border-secondary pl-2 text-xs italic text-text-secondary">“{it.excerpt}”</blockquote> : null}
        </li>
      ))}
    </ul>
  );
}

function ActionItemsTab({ meeting: m, canEdit, onRefresh }: { meeting: MeetingDto; canEdit: boolean; onRefresh: () => void }) {
  const { workspace, workspaceSlug } = useApp();
  const projects = useProjects(workspace?.id);
  const members = useMembers(workspace?.id);
  const items = m.actionItems ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set(items.filter((a) => a.status === "DRAFT" || a.status === "APPROVED").map((a) => a.id)));
  const [overrides, setOverrides] = useState<Record<string, { title?: string; assigneeId?: string; dueDate?: string }>>({});
  const [projectId, setProjectId] = useState(m.projectId ?? "");
  const [newText, setNewText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const effectiveProject = projectId || projects.data?.[0]?.id || "";
  const guessAssignee = (a: ActionItemDto) => (a.suggestedOwner ? members.data?.find((mem) => mem.user.name.toLowerCase().startsWith(a.suggestedOwner!.toLowerCase().split(" ")[0]!))?.user.id : undefined);

  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/meetings/${m.id}/action-items/${id}`, body), onSuccess: onRefresh, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/meetings/${m.id}/action-items/${id}`), onSuccess: onRefresh });
  const add = useMutation({ mutationFn: () => post(`/meetings/${m.id}/action-items`, { text: newText.trim() }), onSuccess: () => { setNewText(""); onRefresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const convert = useMutation({
    mutationFn: () =>
      post<Array<{ itemId: string; task: { key: string } }>>(`/meetings/${m.id}/action-items/convert`, {
        items: items.filter((a) => selected.has(a.id) && a.status !== "CONVERTED" && a.status !== "REJECTED").map((a) => ({ id: a.id, title: overrides[a.id]?.title ?? a.text, projectId: effectiveProject, assigneeId: overrides[a.id]?.assigneeId ?? guessAssignee(a) ?? null, dueDate: overrides[a.id]?.dueDate ? new Date(overrides[a.id]!.dueDate!).toISOString() : a.suggestedDue ?? null })),
      }),
    onSuccess: (res) => {
      setConfirm(false);
      setSelected(new Set());
      onRefresh();
      toast.success(`Created ${res.length} task${res.length === 1 ? "" : "s"}: ${res.map((r) => r.task.key).join(", ")}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pending = items.filter((a) => a.status === "DRAFT" || a.status === "APPROVED");
  const toConvert = pending.filter((a) => selected.has(a.id));

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Review action items</h3>
            <p className="text-xs text-text-secondary">AI-extracted items are drafts. Edit titles, pick owners and due dates, then convert the ones you approve into tasks.</p>
          </div>
          {canEdit && pending.length ? (
            <div className="flex items-center gap-2">
              <SimpleSelect value={effectiveProject} onChange={setProjectId} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder="Project" className="h-8 w-44 text-xs" />
              <Button size="sm" disabled={!toConvert.length || !effectiveProject} onClick={() => setConfirm(true)}><CheckSquare /> Create {toConvert.length} task{toConvert.length === 1 ? "" : "s"}</Button>
            </div>
          ) : null}
        </div>
        {items.length === 0 ? <p className="py-6 text-center text-sm text-text-secondary">No action items yet. Generate a summary or add items manually below.</p> : null}
        <ul className="divide-y divide-border">
          {items.map((a) => {
            const done = a.status === "CONVERTED";
            const rejected = a.status === "REJECTED";
            const o = overrides[a.id] ?? {};
            return (
              <li key={a.id} className={cn("flex flex-col gap-2 py-3 sm:flex-row sm:items-start", (done || rejected) && "opacity-70")}>
                {canEdit && !done && !rejected ? <Checkbox checked={selected.has(a.id)} onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(a.id); else n.delete(a.id); return n; })} className="mt-2" aria-label="Select action item" /> : <span className="w-4" />}
                <div className="min-w-0 flex-1 space-y-1.5">
                  {canEdit && !done && !rejected ? <Input value={o.title ?? a.text} onChange={(e) => setOverrides((x) => ({ ...x, [a.id]: { ...o, title: e.target.value } }))} className="h-8 text-sm" aria-label="Task title" /> : <p className={cn("text-sm", rejected && "line-through")}>{a.text}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    {a.source.startsWith("ai:") ? <Badge variant="violet">AI</Badge> : <Badge variant="secondary">manual</Badge>}
                    <Badge variant={done ? "success" : rejected ? "error" : a.status === "APPROVED" ? "default" : "warning"}>{a.status.toLowerCase()}</Badge>
                    {a.suggestedOwner ? <span>Suggested owner: {a.suggestedOwner}</span> : null}
                    {a.suggestedDue ? <span>Suggested due: {formatDate(a.suggestedDue)}</span> : null}
                    {done && a.task ? <Link href={`/app/${workspaceSlug}/tasks?task=${a.task.id}`} className="font-medium text-primary hover:underline">{a.task.project.key}-{a.task.number} · {a.task.status.replace("_", " ")}</Link> : null}
                  </div>
                  {a.excerpt ? <blockquote className="border-l-2 border-secondary pl-2 text-xs italic text-text-secondary">“{a.excerpt}”</blockquote> : null}
                  {canEdit && !done && !rejected && selected.has(a.id) ? (
                    <div className="flex flex-wrap gap-2">
                      <SimpleSelect value={o.assigneeId ?? guessAssignee(a) ?? "none"} onChange={(v) => setOverrides((x) => ({ ...x, [a.id]: { ...o, assigneeId: v === "none" ? "" : v } }))} options={[{ value: "none", label: "Unassigned" }, ...(members.data ?? []).map((mem) => ({ value: mem.user.id, label: mem.user.name }))]} className="h-7 w-40 text-xs" />
                      <Input type="date" value={o.dueDate ?? (a.suggestedDue ? a.suggestedDue.slice(0, 10) : "")} onChange={(e) => setOverrides((x) => ({ ...x, [a.id]: { ...o, dueDate: e.target.value } }))} className="h-7 w-36 text-xs" aria-label="Due date" />
                    </div>
                  ) : null}
                </div>
                {canEdit && !done ? (
                  <div className="flex shrink-0 gap-1">
                    {!rejected ? <Tooltip content="Reject"><Button size="icon-xs" variant="ghost" aria-label="Reject" onClick={() => update.mutate({ id: a.id, body: { status: "REJECTED" } })}><X /></Button></Tooltip> : <Button size="xs" variant="ghost" onClick={() => update.mutate({ id: a.id, body: { status: "DRAFT" } })}>Restore</Button>}
                    <Tooltip content="Delete"><Button size="icon-xs" variant="ghost" aria-label="Delete" onClick={() => remove.mutate(a.id)}><Trash2 /></Button></Tooltip>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {canEdit ? (
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newText.trim()) add.mutate(); }}>
            <Input value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Add an action item manually…" className="h-8 text-xs" />
            <Button type="submit" size="sm" variant="outline" disabled={!newText.trim()}><Plus /> Add</Button>
          </form>
        ) : null}
      </Card>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Create ${toConvert.length} task${toConvert.length === 1 ? "" : "s"}?`} description={`Tasks will be created in ${projects.data?.find((p) => p.id === effectiveProject)?.name ?? "the selected project"} with a link back to this meeting. Assignees are notified.`} confirmLabel="Create tasks" onConfirm={() => convert.mutate()} loading={convert.isPending} />
    </div>
  );
}

function TranscriptDialog({ meetingId, onClose, onAdded }: { meetingId: string; onClose: () => void; onAdded: () => void }) {
  const [content, setContent] = useState("");
  const [source, setSource] = useState<"PASTE" | "UPLOAD">("PASTE");
  const [fileName, setFileName] = useState<string | null>(null);
  const add = useMutation({ mutationFn: () => post(`/meetings/${meetingId}/transcripts`, { content: content.trim(), source }), onSuccess: () => { toast.success("Transcript added"); onAdded(); onClose(); }, onError: (e) => toast.error(errorMessage(e)) });
  const onFile = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) return toast.error("Transcript files must be under 5 MB");
    if (!/^text\/|\.(txt|md|vtt|srt)$/i.test(f.type || f.name)) return toast.error("Upload a plain-text transcript (.txt, .md, .vtt, .srt)");
    const text = await f.text();
    setContent(text.replace(/^WEBVTT[^\n]*\n/, "").replace(/\d{2}:\d{2}:\d{2}[.,]\d{3} --> [^\n]+\n/g, "").replace(/^\d+\n/gm, ""));
    setSource("UPLOAD");
    setFileName(f.name);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add a transcript</DialogTitle>
          <DialogDescription>Paste meeting notes or a transcript, or upload a text/VTT/SRT file. Audio recording and transcription require a configured provider and are not enabled on this server.</DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong p-4 text-sm text-text-secondary hover:bg-surface-2">
          <Upload className="size-4" /> {fileName ?? "Upload .txt / .md / .vtt / .srt"}
          <input type="file" accept=".txt,.md,.vtt,.srt,text/plain,text/vtt" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        <Field label="Transcript text" htmlFor="transcript-text" hint={`${content.length.toLocaleString()} characters`}>
          <Textarea id="transcript-text" value={content} onChange={(e) => { setContent(e.target.value); setSource("PASTE"); }} rows={12} placeholder={"Alex: Let's start with progress…\nSam: The editor is done, comments are still missing…"} className="font-mono text-xs" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!content.trim()} loading={add.isPending} onClick={() => add.mutate()}>Save transcript</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
