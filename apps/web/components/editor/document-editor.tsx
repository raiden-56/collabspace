"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import Mention from "@tiptap/extension-mention";
import { toast } from "sonner";
import { BookOpen, CheckSquare, History, List, Maximize2, MessageSquare, Minimize2, X } from "lucide-react";
import { baseDocumentExtensions, DOCUMENT_FRAGMENT } from "@collabspace/shared/editor";
import { get, post, patch, uploadFile, errorMessage, type TaskDto } from "@/lib/api";
import { useDocument, useMembers, useProjects, useThreads } from "@/lib/queries";
import { useCollab, useAwareness } from "@/lib/yjs";
import { useShortcut } from "@/lib/hooks/use-shortcut";
import { useHeader } from "@/lib/stores/header-store";
import { useApp } from "@/components/app-shell/workspace-context";
import { DocSyncStatus } from "@/components/app-shell/connection-status";
import { CommentMark } from "./comment-mark";
import { SlashCommand } from "./slash-command";
import { mentionSuggestion } from "./mention-suggestion";
import { EditorToolbar } from "./editor-toolbar";
import { CommentThreads } from "@/components/comments/comment-thread";
import { VersionHistoryPanel } from "@/components/shared/version-history";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/skeleton";
import { Tooltip, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/overlays";
import { Field, Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/controls";
import { cn } from "@/lib/utils";

type Panel = "comments" | "versions" | "outline" | null;

export function DocumentEditor({ documentId, shareToken, readOnly: forcedReadOnly, embedded }: { documentId: string; shareToken?: string | null; readOnly?: boolean; embedded?: boolean }) {
  const { user, workspace, workspaceSlug } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const document = useDocument(documentId, shareToken);
  const access = document.data?.access;
  const readOnly = forcedReadOnly || !(access === "OWNER" || access === "EDITOR");
  const canComment = access === "OWNER" || access === "EDITOR" || access === "COMMENTER";
  const collab = useCollab("document", documentId, { shareToken, user: user ? { userId: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl } : null, enabled: Boolean(document.data) });
  const others = useAwareness(collab.conn?.awareness ?? null);
  const members = useMembers(workspace?.id);
  const membersRef = useRef(members.data ?? []);
  membersRef.current = members.data ?? [];
  const [panel, setPanel] = useState<Panel>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<string | null>(null);
  const [convert, setConvert] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threads = useThreads("DOCUMENT", documentId, false, shareToken);

  useEffect(() => {
    if (document.data) setTitle(document.data.title);
  }, [document.data?.title, document.data]);

  const doc = collab.conn?.doc ?? null;
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !readOnly && !readingMode,
      extensions: doc
        ? [
            ...baseDocumentExtensions().filter((e) => e.name !== "mention"),
            Mention.configure({ HTMLAttributes: { class: "mention" }, suggestion: mentionSuggestion(() => membersRef.current.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl, color: m.user.color }))), renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}` }),
            Collaboration.configure({ document: doc, field: DOCUMENT_FRAGMENT }),
            ...(collab.conn?.provider && user ? [CollaborationCaret.configure({ provider: collab.conn.provider, user: { name: user.name, color: user.color } })] : []),
            Placeholder.configure({ placeholder: ({ node }) => (node.type.name === "heading" ? "Heading" : "Type '/' for commands, '@' to mention…") }),
            SlashCommand,
            CommentMark.configure({ onClick: (id) => { setPanel("comments"); setActiveThread(id); } }),
          ]
        : // Schema-only placeholder while the collaborative document is still connecting.
          baseDocumentExtensions(),
      editorProps: {
        attributes: { class: "tiptap", "aria-label": "Document body", spellcheck: "true" },
        handleClick: (_view, _pos, event) => {
          const el = (event.target as HTMLElement).closest?.(".comment-mark") as HTMLElement | null;
          if (el?.dataset.threadId) {
            setPanel("comments");
            setActiveThread(el.dataset.threadId);
            return true;
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const files = event.dataTransfer?.files;
          if (files?.length && !readOnly) {
            event.preventDefault();
            Array.from(files).forEach((f) => void uploadImage(f));
            return true;
          }
          return false;
        },
        handlePaste: (_view, event) => {
          const files = event.clipboardData?.files;
          if (files?.length && !readOnly) {
            Array.from(files).forEach((f) => void uploadImage(f));
            return true;
          }
          return false;
        },
      },
    },
    [doc, collab.conn?.provider, readOnly, readingMode],
  );

  const uploadImage = useCallback(
    async (file: File) => {
      if (!document.data || !editor) return;
      if (!file.type.startsWith("image/")) return toast.error("Only images can be embedded inline. Use the Files page for other attachments.");
      const t = toast.loading(`Uploading ${file.name}…`);
      try {
        const asset = await uploadFile(file, { workspaceId: document.data.workspaceId, projectId: document.data.projectId ?? undefined, resourceType: "DOCUMENT", resourceId: documentId });
        editor.chain().focus().setImage({ src: `${location.origin}/api/v1/files/${asset.id}/download`, alt: asset.name }).run();
        toast.success("Image added", { id: t });
      } catch (err) {
        toast.error(errorMessage(err), { id: t });
      }
    },
    [document.data, editor, documentId],
  );
  useEffect(() => {
    const h = () => fileInputRef.current?.click();
    window.addEventListener("collabspace:editor-upload", h);
    return () => window.removeEventListener("collabspace:editor-upload", h);
  }, []);

  // Title save
  const saveTitle = useMutation({
    mutationFn: (t: string) => patch(`/documents/${documentId}`, { title: t }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["document", documentId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Inline comment on selection
  const commentOnSelection = useCallback(async () => {
    if (!editor || !canComment) return;
    const { from, to } = editor.state.selection;
    if (from === to) return toast("Select some text first");
    const quote = editor.state.doc.textBetween(from, to, " ").slice(0, 300);
    const body = window.prompt(`Comment on “${quote.slice(0, 60)}${quote.length > 60 ? "…" : ""}”`);
    if (!body?.trim()) return;
    try {
      const res = await post<{ threadId: string }>("/comments", { resourceType: "DOCUMENT", resourceId: documentId, body: body.trim(), anchor: { kind: "doc-range", quote, from, to } });
      if (!readOnly) editor.chain().focus().setTextSelection({ from, to }).setCommentMark(res.threadId).run();
      void qc.invalidateQueries({ queryKey: ["comments", "DOCUMENT", documentId] });
      setPanel("comments");
      setActiveThread(res.threadId);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [editor, canComment, documentId, qc, readOnly]);
  useShortcut("mod+shift+m", () => void commentOnSelection(), { allowInInputs: true, enabled: canComment });
  useShortcut("mod+shift+f", () => setFocusMode((f) => !f), { allowInInputs: true });
  useShortcut("escape", () => { if (focusMode) setFocusMode(false); }, { allowInInputs: true, enabled: focusMode });

  // Remove comment marks whose thread was deleted
  useEffect(() => {
    if (!editor || !threads.data || readOnly) return;
    const ids = new Set(threads.data.map((t) => t.id));
    const stale = new Set<string>();
    editor.state.doc.descendants((node) => {
      node.marks.forEach((m) => {
        if (m.type.name === "commentMark" && m.attrs.threadId && !ids.has(m.attrs.threadId) && !threads.isFetching) stale.add(m.attrs.threadId);
      });
    });
    // Resolved threads are hidden from the default list; only unset marks for threads that truly no longer exist.
    if (stale.size) {
      void get<Array<{ id: string }>>(`/comments`, { resourceType: "DOCUMENT", resourceId: documentId, includeResolved: true }).then((all) => {
        const allIds = new Set(all.map((t) => t.id));
        for (const id of stale) if (!allIds.has(id)) editor.commands.unsetCommentMark(id);
      });
    }
  }, [editor, threads.data, threads.isFetching, readOnly, documentId]);

  // Highlight active thread mark
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.isInitialized) return;
    editor.view.dom.querySelectorAll(".comment-mark.active").forEach((el) => el.classList.remove("active"));
    if (activeThread) editor.view.dom.querySelectorAll(`.comment-mark[data-thread-id="${CSS.escape(activeThread)}"]`).forEach((el) => el.classList.add("active"));
  }, [editor, activeThread, threads.data]);

  // Outline (table of contents)
  const [outline, setOutline] = useState<Array<{ level: number; text: string; pos: number }>>([]);
  useEffect(() => {
    if (!editor) return;
    const compute = () => {
      const out: Array<{ level: number; text: string; pos: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") out.push({ level: node.attrs.level as number, text: node.textContent, pos });
      });
      setOutline(out);
    };
    compute();
    editor.on("update", compute);
    return () => {
      editor.off("update", compute);
    };
  }, [editor]);

  const checklistItems = useMemo(() => {
    if (!editor) return [] as Array<{ text: string; checked: boolean }>;
    const out: Array<{ text: string; checked: boolean }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "taskItem") out.push({ text: node.textContent.trim(), checked: Boolean(node.attrs.checked) });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, outline]);

  useHeader(
    {
      title: document.data?.title ?? "Document",
      breadcrumbs: document.data && workspaceSlug ? [{ label: "Documents", href: `/app/${workspaceSlug}/docs` }, ...(document.data.project ? [{ label: document.data.project.name, href: `/app/${workspaceSlug}/projects/${document.data.project.id}` }] : [])] : [],
      resource: document.data ? { type: "DOCUMENT", id: documentId, access } : null,
      status: <DocSyncStatus status={collab.status} synced={collab.synced} />,
      actions: (
        <>
          <Tooltip content={readingMode ? "Exit reading mode" : "Reading mode"}>
            <Button variant={readingMode ? "subtle" : "ghost"} size="icon-sm" aria-label="Reading mode" onClick={() => setReadingMode((r) => !r)}><BookOpen /></Button>
          </Tooltip>
          <Tooltip content="Outline">
            <Button variant={panel === "outline" ? "subtle" : "ghost"} size="icon-sm" aria-label="Outline" onClick={() => setPanel(panel === "outline" ? null : "outline")}><List /></Button>
          </Tooltip>
          <Tooltip content="Comments">
            <Button variant={panel === "comments" ? "subtle" : "ghost"} size="icon-sm" aria-label="Comments" onClick={() => setPanel(panel === "comments" ? null : "comments")}><MessageSquare /></Button>
          </Tooltip>
          <Tooltip content="Version history">
            <Button variant={panel === "versions" ? "subtle" : "ghost"} size="icon-sm" aria-label="Version history" onClick={() => setPanel(panel === "versions" ? null : "versions")}><History /></Button>
          </Tooltip>
          <Tooltip content="Focus mode (⌘⇧F)">
            <Button variant="ghost" size="icon-sm" aria-label="Focus mode" onClick={() => setFocusMode(true)}><Maximize2 /></Button>
          </Tooltip>
        </>
      ),
    },
    [document.data?.title, document.data?.project?.id, access, collab.status, collab.synced, panel, readingMode],
    !embedded,
  );

  if (document.isError) return <div className="flex h-full items-center justify-center text-text-secondary">You don&apos;t have access to this document.</div>;
  if (!document.data || !editor) return <div className="flex h-full items-center justify-center"><Spinner /></div>;

  const editorBody = (
    <div className={cn("mx-auto w-full px-6 pt-6", embedded ? "pb-10" : "pb-32", readingMode ? "max-w-2xl" : "max-w-3xl")}>
      {document.data.meeting && !embedded ? (
        <button onClick={() => router.push(`/app/${workspaceSlug}/meetings/${document.data!.meeting!.id}`)} className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-secondary-soft px-2.5 py-1 text-xs font-medium text-secondary">
          Notes for meeting “{document.data.meeting.title}” →
        </button>
      ) : null}
      {embedded ? (
        <div className="mb-2 flex items-center justify-between text-xs text-text-muted"><span>Collaborative notes</span><div className="flex items-center gap-2"><DocSyncStatus status={collab.status} synced={collab.synced} /><button className="hover:text-text" onClick={() => router.push(`/app/${workspaceSlug}/docs/${documentId}`)}>Open full document →</button></div></div>
      ) : null}
      {!embedded ? <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== document.data?.title && saveTitle.mutate(title.trim())}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor.commands.focus("start"); } }}
        readOnly={readOnly}
        aria-label="Document title"
        placeholder="Untitled"
        className={cn("mb-4 w-full bg-transparent text-4xl font-bold tracking-tight outline-none placeholder:text-text-muted", readingMode && "text-3xl")}
      /> : null}
      {others.length ? (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-text-muted">
          <span className="flex -space-x-1">
            {others.slice(0, 5).map((o) => <span key={o.clientId} className="size-4 rounded-full ring-2 ring-surface" style={{ background: o.user.color }} title={o.user.name} />)}
          </span>
          {others.length === 1 ? `${others[0]!.user.name} is here` : `${others.length} people are here`}
        </div>
      ) : null}
      <EditorContent editor={editor} className={cn(readingMode && "[&_.tiptap]:text-[17px] [&_.tiptap]:leading-8")} />
      {!readOnly && checklistItems.length ? (
        <div className="mt-10 rounded-lg border border-dashed border-border p-3 text-xs text-text-secondary">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-text"><CheckSquare className="size-3.5" /> {checklistItems.filter((c) => !c.checked).length} open checklist item{checklistItems.filter((c) => !c.checked).length === 1 ? "" : "s"}</p>
          <p>Turn any item into a tracked task: <button className="text-primary underline" onClick={() => setConvert(checklistItems.find((c) => !c.checked)?.text ?? "")}>convert the first open item</button>, or open the outline panel to pick one.</p>
        </div>
      ) : null}
      <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { if (e.target.files?.[0]) void uploadImage(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );

  return (
    <div className={cn("flex h-full", focusMode && "fixed inset-0 z-50 bg-bg")}>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {!readOnly && !readingMode && !embedded ? (
          <div className="sticky top-0 z-10 flex justify-center px-4 pt-3">
            <EditorToolbar editor={editor} readOnly={readOnly} onComment={canComment ? () => void commentOnSelection() : undefined} onImage={() => fileInputRef.current?.click()} />
          </div>
        ) : null}
        {focusMode ? (
          <Button variant="ghost" size="sm" className="absolute right-4 top-3 z-20" onClick={() => setFocusMode(false)}><Minimize2 /> Exit focus</Button>
        ) : null}
        {readOnly ? <div className="mx-auto mt-3 w-fit rounded-full border border-border px-3 py-1 text-xs text-text-secondary glass">View-only{canComment ? " · select text and press ⌘⇧M to comment" : ""}</div> : null}
        <div className="flex-1 overflow-y-auto scrollbar-thin">{editorBody}</div>
      </div>
      {panel && !focusMode ? (
        <aside className="w-80 shrink-0 border-l border-border bg-surface">
          {panel === "comments" ? (
            <div className="flex h-full flex-col">
              <div className="flex h-12 items-center justify-between border-b border-border px-3"><h2 className="text-sm font-semibold">Comments</h2><Button variant="ghost" size="icon-xs" onClick={() => setPanel(null)} aria-label="Close"><X /></Button></div>
              <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
                <CommentThreads resourceType="DOCUMENT" resourceId={documentId} canComment={canComment} highlightThreadId={activeThread} shareToken={shareToken} onCreateThread={canComment ? () => void commentOnSelection() : undefined} />
                {canComment ? <p className="mt-3 text-xs text-text-muted">Select text and press ⌘⇧M (or use the toolbar) to start an inline thread. General discussion threads can be added below.</p> : null}
                {canComment ? <div className="mt-3"><CommentThreads resourceType="DOCUMENT" resourceId={documentId} canComment={canComment} anchorFilter={() => false} compact /></div> : null}
              </div>
            </div>
          ) : panel === "outline" ? (
            <div className="flex h-full flex-col">
              <div className="flex h-12 items-center justify-between border-b border-border px-3"><h2 className="text-sm font-semibold">Outline</h2><Button variant="ghost" size="icon-xs" onClick={() => setPanel(null)} aria-label="Close"><X /></Button></div>
              <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
                {outline.length === 0 ? <p className="text-sm text-text-secondary">Add headings to build a table of contents.</p> : null}
                <ul className="space-y-0.5">
                  {outline.map((h, i) => (
                    <li key={i}>
                      <button onClick={() => editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run()} className={cn("w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-surface-2", h.level === 1 && "font-semibold", h.level === 2 && "pl-4", h.level >= 3 && "pl-6 text-text-secondary")}>
                        {h.text || "Untitled heading"}
                      </button>
                    </li>
                  ))}
                </ul>
                {checklistItems.length ? (
                  <div className="mt-5">
                    <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Checklist items</h3>
                    <ul className="space-y-1">
                      {checklistItems.map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <span className={cn("flex-1 truncate", c.checked && "text-text-muted line-through")}>{c.text || "(empty)"}</span>
                          {!readOnly && c.text ? <button className="text-primary hover:underline" onClick={() => setConvert(c.text)}>→ task</button> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <VersionHistoryPanel type="document" id={documentId} canEdit={!readOnly} onClose={() => { setPanel(null); setPreviewVersion(null); }} onPreview={setPreviewVersion} previewingId={previewVersion} />
          )}
        </aside>
      ) : null}
      {previewVersion ? <VersionPreview documentId={documentId} versionId={previewVersion} onClose={() => setPreviewVersion(null)} /> : null}
      {convert !== null ? <ConvertChecklistDialog documentId={documentId} text={convert} onClose={() => setConvert(null)} /> : null}
    </div>
  );
}

function VersionPreview({ documentId, versionId, onClose }: { documentId: string; versionId: string; onClose: () => void }) {
  const q = useQuery<{ text: string }>({ queryKey: ["version", "document", documentId, versionId], queryFn: () => get(`/documents/${documentId}/versions/${versionId}`) });
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Version preview (read-only)</h3>
          <Button size="sm" variant="outline" onClick={onClose}>Exit preview</Button>
        </div>
        {q.data ? <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{q.data.text || "(empty)"}</pre> : <Spinner />}
      </div>
    </div>
  );
}

function ConvertChecklistDialog({ documentId, text, onClose }: { documentId: string; text: string; onClose: () => void }) {
  const { workspace } = useApp();
  const projects = useProjects(workspace?.id);
  const qc = useQueryClient();
  const [title, setTitle] = useState(text);
  const [projectId, setProjectId] = useState("");
  const effective = projectId || projects.data?.[0]?.id || "";
  const convert = useMutation({
    mutationFn: () => post<TaskDto>(`/documents/${documentId}/convert-to-task`, { projectId: effective, text, title }),
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
        <DialogHeader><DialogTitle>Create task from checklist item</DialogTitle></DialogHeader>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Project"><SimpleSelect value={effective} onChange={setProjectId} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder="Choose a project" /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!effective || !title.trim()} loading={convert.isPending} onClick={() => convert.mutate()}>Create task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
