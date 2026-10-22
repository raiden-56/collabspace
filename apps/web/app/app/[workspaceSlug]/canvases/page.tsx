"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Copy, MoreHorizontal, PenTool, Plus, RotateCcw, Trash2 } from "lucide-react";
import { patch, post, del, errorMessage, type CanvasDto } from "@/lib/api";
import { useCanvases, useProjects } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { SegmentTabs, SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ConfirmDialog } from "@/components/ui/overlays";
import { timeAgo } from "@/lib/utils";

export default function CanvasesPage() {
  const { workspace, workspaceSlug, isGuest } = useApp();
  useHeader({ title: "Canvases" });
  const dialogs = useCreateDialogs();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [projectId, setProjectId] = useState("");
  const projects = useProjects(workspace?.id);
  const canvases = useCanvases(workspace?.id, projectId || undefined);
  const list = (canvases.data ?? []).filter((c) => (tab === "archived" ? c.archivedAt : !c.archivedAt));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Canvases"
        description="Infinite boards for brainstorming, diagrams, planning and retrospectives."
        actions={
          !isGuest ? (
            <Button onClick={() => dialogs.openCanvas(projectId || undefined)}>
              <Plus /> New canvas
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SegmentTabs value={tab} onChange={setTab} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} />
        <SimpleSelect value={projectId || "all"} onChange={(v) => setProjectId(v === "all" ? "" : v)} options={[{ value: "all", label: "All projects" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} className="w-52" />
      </div>
      {canvases.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState icon={<PenTool />} title={tab === "archived" ? "No archived canvases" : "No canvases yet"} description="Start from a template like Brainstorming, Flowchart or Retrospective, or begin with a blank board." action={!isGuest && tab === "active" ? <Button onClick={() => dialogs.openCanvas()}><Plus /> Create a canvas</Button> : undefined} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((c) => (
            <CanvasCard key={c.id} canvas={c} slug={workspaceSlug!} />
          ))}
        </div>
      )}
    </div>
  );
}

function CanvasCard({ canvas: c, slug }: { canvas: CanvasDto; slug: string }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["canvases"] });
  const archive = useMutation({ mutationFn: (archived: boolean) => patch(`/canvases/${c.id}`, { archived }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const duplicate = useMutation({ mutationFn: () => post(`/canvases/${c.id}/duplicate`), onSuccess: () => { refresh(); toast.success("Canvas duplicated"); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => del(`/canvases/${c.id}`), onSuccess: () => { refresh(); toast.success("Canvas deleted"); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md">
      <Link href={`/app/${slug}/canvas/${c.id}`} className="block">
        <div className="relative h-28 overflow-hidden border-b border-border" style={{ background: "var(--canvas-bg)", backgroundImage: "radial-gradient(var(--canvas-grid) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
          <div className="absolute left-5 top-5 h-10 w-14 rotate-[-3deg] rounded bg-[#FFE66D] shadow-sm" />
          <div className="absolute left-24 top-9 h-10 w-14 rotate-[2deg] rounded bg-[#B5EAD7] shadow-sm" />
          <div className="absolute left-44 top-4 h-12 w-16 rounded border-2 border-primary/60 bg-surface" />
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/app/${slug}/canvas/${c.id}`} className="min-w-0 flex-1">
            <p className="truncate font-medium group-hover:text-primary">{c.title}</p>
            <p className="mt-0.5 truncate text-xs text-text-muted">{c.project?.name ?? "No project"}</p>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Canvas actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => duplicate.mutate()}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => archive.mutate(!c.archivedAt)}>
                {c.archivedAt ? <RotateCcw /> : <Archive />} {c.archivedAt ? "Restore" : "Archive"}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => setConfirm(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <UserAvatar user={c.createdBy ?? null} size="xs" /> {c.createdBy?.name}
          </span>
          <span className="flex items-center gap-2">
            {c.visibility === "PRIVATE" ? <Badge variant="outline">private</Badge> : null}
            {timeAgo(c.updatedAt)}
          </span>
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this canvas?" description="The canvas and its version history will be removed." confirmLabel="Delete" destructive onConfirm={() => remove.mutate()} />
    </div>
  );
}
