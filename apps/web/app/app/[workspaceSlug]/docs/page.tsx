"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Copy, FileText, Folder, FolderPlus, MoreHorizontal, Plus, RotateCcw, Trash2, Search } from "lucide-react";
import { get, patch, post, del, errorMessage, type DocumentDto } from "@/lib/api";
import { useDocuments, useProjects } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentTabs, SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, ConfirmDialog } from "@/components/ui/overlays";
import { timeAgo, cn } from "@/lib/utils";

interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  _count: { documents: number; canvases: number };
}

export default function DocumentsPage() {
  const { workspace, workspaceSlug, isGuest } = useApp();
  useHeader({ title: "Documents" });
  const dialogs = useCreateDialogs();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [projectId, setProjectId] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const projects = useProjects(workspace?.id);
  const docs = useDocuments(workspace?.id, projectId || undefined);
  const folders = useQuery<FolderDto[]>({ queryKey: ["folders", workspace?.id], queryFn: () => get(`/workspaces/${workspace!.id}/folders`), enabled: Boolean(workspace) });
  const list = (docs.data ?? []).filter((d) => (tab === "archived" ? d.archivedAt : !d.archivedAt)).filter((d) => (folderId ? d.folder?.id === folderId : true)).filter((d) => !q || d.title.toLowerCase().includes(q.toLowerCase()));
  const newFolder = useMutation({
    mutationFn: (name: string) => post(`/workspaces/${workspace!.id}/folders`, { name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["folders"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Documents"
        description="Collaborative rich-text documents with comments and version history."
        actions={
          !isGuest ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  const name = window.prompt("Folder name");
                  if (name?.trim()) newFolder.mutate(name.trim());
                }}
              >
                <FolderPlus /> Folder
              </Button>
              <Button onClick={() => dialogs.openDocument(projectId || undefined)}>
                <Plus /> New document
              </Button>
            </>
          ) : null
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentTabs value={tab} onChange={setTab} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title…" className="w-52 pl-8" aria-label="Filter documents" />
          </div>
          <SimpleSelect value={projectId || "all"} onChange={(v) => setProjectId(v === "all" ? "" : v)} options={[{ value: "all", label: "All projects" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} className="w-48" />
        </div>
      </div>
      {folders.data?.length ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button onClick={() => setFolderId(null)} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", !folderId ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>
            All
          </button>
          {folders.data.map((f) => (
            <button key={f.id} onClick={() => setFolderId(folderId === f.id ? null : f.id)} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", folderId === f.id ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>
              <Folder className="size-3.5" /> {f.name} <span className="text-text-muted">{f._count.documents}</span>
            </button>
          ))}
        </div>
      ) : null}
      {docs.isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<FileText />} title={tab === "archived" ? "No archived documents" : "No documents yet"} description="Write specs, meeting notes and plans together — with live cursors and comments." action={!isGuest && tab === "active" ? <Button onClick={() => dialogs.openDocument()}><Plus /> Create a document</Button> : undefined} />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {list.map((d) => (
            <DocRow key={d.id} doc={d} slug={workspaceSlug!} folders={folders.data ?? []} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DocRow({ doc: d, slug, folders }: { doc: DocumentDto; slug: string; folders: FolderDto[] }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["documents"] });
  const update = useMutation({ mutationFn: (body: Record<string, unknown>) => patch(`/documents/${d.id}`, body), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const duplicate = useMutation({ mutationFn: () => post(`/documents/${d.id}/duplicate`), onSuccess: () => { refresh(); toast.success("Document duplicated"); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => del(`/documents/${d.id}`), onSuccess: () => { refresh(); toast.success("Document deleted"); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <li className="group flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60">
      <span className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-lg">{d.icon ?? "📄"}</span>
      <Link href={`/app/${slug}/docs/${d.id}`} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium group-hover:text-primary">{d.title}</p>
        <p className="truncate text-xs text-text-muted">
          {d.project?.name ?? "No project"}
          {d.folder ? ` · ${d.folder.name}` : ""} · edited {timeAgo(d.updatedAt)}
        </p>
      </Link>
      {d.visibility === "PRIVATE" ? <Badge variant="outline">private</Badge> : null}
      <UserAvatar user={d.createdBy ?? null} size="sm" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Document actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => duplicate.mutate()}>
            <Copy /> Duplicate
          </DropdownMenuItem>
          {folders.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Folder /> Move to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onSelect={() => update.mutate({ folderId: null })}>No folder</DropdownMenuItem>
                {folders.map((f) => (
                  <DropdownMenuItem key={f.id} onSelect={() => update.mutate({ folderId: f.id })}>
                    {f.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem onSelect={() => update.mutate({ archived: !d.archivedAt })}>
            {d.archivedAt ? <RotateCcw /> : <Archive />} {d.archivedAt ? "Restore" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this document?" description="The document and its version history will be removed." confirmLabel="Delete" destructive onConfirm={() => remove.mutate()} />
    </li>
  );
}
