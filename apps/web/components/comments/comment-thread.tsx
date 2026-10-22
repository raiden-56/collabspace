"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckSquare, MessageSquare, MoreHorizontal, RotateCcw, Send, SmilePlus, Trash2, Pencil } from "lucide-react";
import { post, patch, del, errorMessage, type CommentDto, type ThreadDto } from "@/lib/api";
import { useThreads, useMembers, useProjects } from "@/lib/queries";
import { useRealtime } from "@/lib/realtime";
import { useApp } from "@/components/app-shell/workspace-context";
import { activeMentionQuery, mentionToken, parseMentions } from "@/lib/mentions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { UserAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/overlays";
import { SimpleSelect } from "@/components/ui/controls";
import { Field } from "@/components/ui/input";
import { timeAgo, cn } from "@/lib/utils";

const EMOJIS = ["👍", "❤️", "🎉", "👀", "🤔", "✅", "🚀", "😂"];

export function MentionText({ body, className }: { body: string; className?: string }) {
  const parts = useMemo(() => parseMentions(body), [body]);
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {parts.map((p, i) =>
        p.type === "mention" ? (
          <span key={i} className="rounded bg-primary-soft px-1 font-medium text-primary">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/** Textarea with @mention autocomplete (workspace members). */
export function MentionComposer({ value, onChange, onSubmit, placeholder, autoFocus, disabled, submitLabel = "Comment", compact, onTyping }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder?: string; autoFocus?: boolean; disabled?: boolean; submitLabel?: string; compact?: boolean; onTyping?: () => void }) {
  const { workspace } = useApp();
  const members = useMembers(workspace?.id);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return (members.data ?? []).filter((m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, members.data]);

  const update = (next: string) => {
    onChange(next);
    onTyping?.();
    const caret = ref.current?.selectionStart ?? next.length;
    setMention(activeMentionQuery(next, caret));
    setActive(0);
  };
  const pick = (u: { id: string; name: string }) => {
    if (!mention) return;
    const caret = ref.current?.selectionStart ?? value.length;
    const next = value.slice(0, mention.start) + mentionToken(u) + " " + value.slice(caret);
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => ref.current?.focus());
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(candidates[active]!.user);
        return;
      }
      if (e.key === "Escape") {
        setMention(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || (!e.shiftKey && compact))) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="relative">
      <Textarea ref={ref} value={value} onChange={(e) => update(e.target.value)} onKeyDown={onKey} onClick={() => setMention(activeMentionQuery(value, ref.current?.selectionStart ?? 0))} placeholder={placeholder ?? "Write a comment… use @ to mention"} rows={compact ? 1 : 2} autoFocus={autoFocus} disabled={disabled} className={cn("resize-none pr-11", compact ? "min-h-[40px]" : "min-h-[64px]")} aria-label={placeholder ?? "Comment"} />
      <Button type="button" size="icon-xs" className="absolute bottom-2 right-2" onClick={onSubmit} disabled={disabled || !value.trim()} aria-label={submitLabel}>
        <Send />
      </Button>
      {mention && candidates.length ? (
        <ul role="listbox" className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-md">
          {candidates.map((m, i) => (
            <li key={m.user.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.user)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", i === active && "bg-surface-2")}>
                <UserAvatar user={m.user} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.user.name}</span>
                  <span className="block truncate text-[11px] text-text-muted">{m.user.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CommentThreads({ resourceType, resourceId, canComment, anchorFilter, onCreateThread, highlightThreadId, showResolved: initialShowResolved = false, compact, shareToken }: { resourceType: string; resourceId: string; canComment: boolean; anchorFilter?: (t: ThreadDto) => boolean; onCreateThread?: () => void; highlightThreadId?: string | null; showResolved?: boolean; compact?: boolean; shareToken?: string | null }) {
  const [showResolved, setShowResolved] = useState(initialShowResolved);
  const threads = useThreads(resourceType, resourceId, showResolved, shareToken);
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ["comments", resourceType, resourceId] });
  useRealtime(`resource:${resourceType.toLowerCase()}:${resourceId}`, (ev) => {
    if (ev.t === "comment:updated") refresh();
  });
  const [draft, setDraft] = useState("");
  const create = useMutation({
    mutationFn: () => post("/comments", { resourceType, resourceId, body: draft }),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = (threads.data ?? []).filter((t) => !anchorFilter || anchorFilter(t));
  const openCount = list.filter((t) => !t.resolvedAt).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>
          {openCount} open thread{openCount === 1 ? "" : "s"}
        </span>
        <button className="hover:text-text" onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? "Hide resolved" : "Show resolved"}
        </button>
      </div>
      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-text-secondary">
          <MessageSquare className="mx-auto mb-2 size-5 text-text-muted" />
          No comments yet.{onCreateThread ? " Select something and add a comment." : " Start the conversation below."}
        </div>
      ) : null}
      {list.map((t) => (
        <ThreadCard key={t.id} thread={t} resourceType={resourceType} resourceId={resourceId} canComment={canComment} highlighted={highlightThreadId === t.id} onChanged={refresh} compact={compact} />
      ))}
      {canComment && !onCreateThread ? <MentionComposer value={draft} onChange={setDraft} onSubmit={() => draft.trim() && create.mutate()} disabled={create.isPending} placeholder="Start a new thread… use @ to mention" /> : null}
    </div>
  );
}

export function ThreadCard({ thread, resourceType, resourceId, canComment, highlighted, onChanged, compact }: { thread: ThreadDto; resourceType: string; resourceId: string; canComment: boolean; highlighted?: boolean; onChanged: () => void; compact?: boolean }) {
  const { user, workspaceSlug } = useApp();
  const [reply, setReply] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlighted]);
  const send = useMutation({
    mutationFn: () => post("/comments", { resourceType, resourceId, threadId: thread.id, body: reply }),
    onSuccess: () => {
      setReply("");
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: (resolved: boolean) => post(`/comment-threads/${thread.id}/resolve`, { resolved }),
    onSuccess: onChanged,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const anchor = thread.anchor as { kind?: string; quote?: string } | null;
  const visible = thread.comments.filter((c) => !c.deletedAt || thread.comments.length === 1);

  return (
    <div ref={ref} className={cn("rounded-lg border bg-surface", highlighted ? "border-primary ring-2 ring-primary/20" : "border-border", thread.resolvedAt && "opacity-70")}>
      {anchor?.kind === "doc-range" && anchor.quote ? <div className="border-b border-border px-3 py-1.5 text-xs italic text-text-secondary">“{anchor.quote.slice(0, 120)}”</div> : null}
      <div className="divide-y divide-border/60">
        {visible.map((c) => (
          <CommentRow key={c.id} comment={c} isOwn={c.authorId === user?.id} onChanged={onChanged} compact={compact} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-1.5">
        <div className="flex items-center gap-1">
          {canComment ? (
            thread.resolvedAt ? (
              <Button size="xs" variant="ghost" onClick={() => resolve.mutate(false)}>
                <RotateCcw /> Reopen
              </Button>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => resolve.mutate(true)}>
                <Check /> Resolve
              </Button>
            )
          ) : null}
          {canComment && workspaceSlug ? (
            <Button size="xs" variant="ghost" onClick={() => setConvertOpen(true)}>
              <CheckSquare /> Task
            </Button>
          ) : null}
        </div>
        <span className="text-[11px] text-text-muted">{thread.resolvedAt ? `Resolved ${timeAgo(thread.resolvedAt)}` : timeAgo(thread.updatedAt)}</span>
      </div>
      {canComment && !thread.resolvedAt ? (
        <div className="border-t border-border p-2">
          <MentionComposer compact value={reply} onChange={setReply} onSubmit={() => reply.trim() && send.mutate()} disabled={send.isPending} placeholder="Reply…" submitLabel="Reply" />
        </div>
      ) : null}
      {convertOpen ? <ConvertThreadDialog threadId={thread.id} defaultTitle={thread.comments[0]?.body ?? ""} onClose={() => setConvertOpen(false)} /> : null}
    </div>
  );
}

function CommentRow({ comment: c, isOwn, onChanged, compact }: { comment: CommentDto; isOwn: boolean; onChanged: () => void; compact?: boolean }) {
  const { user } = useApp();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(c.body);
  const edit = useMutation({
    mutationFn: () => patch(`/comments/${c.id}`, { body }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: () => del(`/comments/${c.id}`), onSuccess: onChanged, onError: (e) => toast.error(errorMessage(e)) });
  const react = useMutation({ mutationFn: (emoji: string) => post(`/comments/${c.id}/reactions`, { emoji }), onSuccess: onChanged });
  return (
    <div className={cn("group flex gap-2.5 px-3", compact ? "py-2" : "py-2.5")}>
      <UserAvatar user={c.author} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{c.author.name}</span>
          <span className="text-[11px] text-text-muted">
            {timeAgo(c.createdAt)}
            {c.editedAt ? " · edited" : ""}
          </span>
          <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Popover>
              <PopoverTrigger asChild>
                <button className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text" aria-label="Add reaction">
                  <SmilePlus className="size-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-1.5" align="end">
                <div className="flex gap-1">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => react.mutate(e)} className="rounded p-1 text-base hover:bg-surface-2" aria-label={`React ${e}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {isOwn && !c.deletedAt ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text" aria-label="Comment actions">
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={() => remove.mutate()}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {c.deletedAt ? (
          <p className="text-sm italic text-text-muted">This comment was deleted.</p>
        ) : editing ? (
          <div className="mt-1">
            <MentionComposer compact value={body} onChange={setBody} onSubmit={() => edit.mutate()} submitLabel="Save" />
            <button className="mt-1 text-xs text-text-muted hover:text-text" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <MentionText body={c.body} className="text-sm leading-relaxed" />
        )}
        {c.reactions.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {c.reactions.map((r) => (
              <button key={r.emoji} onClick={() => react.mutate(r.emoji)} className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs", r.userIds.includes(user?.id ?? "") ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2")} aria-pressed={r.userIds.includes(user?.id ?? "")}>
                {r.emoji} {r.count}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConvertThreadDialog({ threadId, defaultTitle, onClose }: { threadId: string; defaultTitle: string; onClose: () => void }) {
  const { workspace } = useApp();
  const projects = useProjects(workspace?.id);
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState(defaultTitle.replace(/@\[([^\]]+)\]\([^)]+\)/g, "@$1").slice(0, 200));
  const effective = projectId || projects.data?.[0]?.id || "";
  const convert = useMutation({
    mutationFn: () => post<{ key: string }>(`/comment-threads/${threadId}/convert-to-task`, { projectId: effective, title }),
    onSuccess: (t) => {
      toast.success(`Created ${t.key}`);
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Create a follow-up task</DialogTitle>
        </DialogHeader>
        <Field label="Title">
          <Textarea rows={2} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Project">
          <SimpleSelect value={effective} onChange={setProjectId} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!effective || !title.trim()} loading={convert.isPending} onClick={() => convert.mutate()}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
