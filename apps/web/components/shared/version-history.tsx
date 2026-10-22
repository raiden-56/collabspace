"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bookmark, History, RotateCcw, X, Eye, GitCompare } from "lucide-react";
import { get, post, errorMessage, type VersionDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/overlays";
import { formatDate, formatBytes, cn } from "@/lib/utils";

const KIND: Record<VersionDto["kind"], { label: string; variant: "secondary" | "default" | "success" | "warning" }> = {
  AUTO: { label: "auto", variant: "secondary" },
  NAMED: { label: "checkpoint", variant: "default" },
  RESTORE: { label: "restored", variant: "success" },
  PRE_RESTORE: { label: "before restore", variant: "warning" },
};

export function VersionHistoryPanel({ type, id, canEdit, onClose, onPreview, previewingId }: { type: "canvas" | "document"; id: string; canEdit: boolean; onClose: () => void; onPreview?: (versionId: string | null) => void; previewingId?: string | null }) {
  const base = type === "canvas" ? `/canvases/${id}` : `/documents/${id}`;
  const qc = useQueryClient();
  const versions = useQuery<VersionDto[]>({ queryKey: ["versions", type, id], queryFn: () => get(`${base}/versions`) });
  const [name, setName] = useState("");
  const [restoring, setRestoring] = useState<VersionDto | null>(null);
  const [compare, setCompare] = useState<[VersionDto, VersionDto] | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["versions", type, id] });
  const create = useMutation({ mutationFn: () => post(`${base}/versions`, { name: name.trim() }), onSuccess: () => { setName(""); refresh(); toast.success("Checkpoint saved"); }, onError: (e) => toast.error(errorMessage(e)) });
  const restore = useMutation({
    mutationFn: (versionId: string) => post(`${base}/restore`, { versionId }),
    onSuccess: () => {
      refresh();
      setRestoring(null);
      onPreview?.(null);
      toast.success("Version restored. The previous state was saved as a recovery point.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = versions.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4" /> Version history
        </h2>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close">
          <X />
        </Button>
      </div>
      {canEdit ? (
        <form
          className="flex gap-2 border-b border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this checkpoint…" className="h-8 text-xs" />
          <Button type="submit" size="sm" variant="subtle" disabled={!name.trim()} loading={create.isPending}>
            <Bookmark /> Save
          </Button>
        </form>
      ) : null}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {versions.isLoading ? <p className="p-3 text-xs text-text-muted">Loading…</p> : null}
        {list.length === 0 && !versions.isLoading ? <p className="p-3 text-xs text-text-secondary">No versions yet. Automatic checkpoints are created every 10 minutes while editing.</p> : null}
        <ul className="space-y-1">
          {list.map((v, i) => (
            <li key={v.id} className={cn("rounded-lg border p-2.5 text-sm", previewingId === v.id ? "border-primary bg-primary-soft/40" : "border-border")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{v.name ?? (v.kind === "AUTO" ? "Automatic checkpoint" : "Version")}</p>
                  <p className="text-[11px] text-text-muted">
                    {formatDate(v.createdAt, true)} · {formatBytes(v.sizeBytes)}
                    {v.objectCount !== undefined ? ` · ${v.objectCount} objects` : ""}
                  </p>
                </div>
                <Badge variant={KIND[v.kind].variant}>{KIND[v.kind].label}</Badge>
              </div>
              {v.preview ? <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{v.preview}</p> : null}
              <div className="mt-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  {v.author ? (
                    <>
                      <UserAvatar user={v.author} size="xs" /> {v.author.name}
                    </>
                  ) : (
                    "System"
                  )}
                </span>
                <div className="flex gap-1">
                  {onPreview ? (
                    <Button size="xs" variant={previewingId === v.id ? "subtle" : "ghost"} onClick={() => onPreview(previewingId === v.id ? null : v.id)}>
                      <Eye /> {previewingId === v.id ? "Exit" : "Preview"}
                    </Button>
                  ) : null}
                  {i < list.length - 1 ? (
                    <Button size="xs" variant="ghost" onClick={() => setCompare([v, list[i + 1]!])} aria-label="Compare with previous">
                      <GitCompare />
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button size="xs" variant="outline" onClick={() => setRestoring(v)}>
                      <RotateCcw /> Restore
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <ConfirmDialog
        open={Boolean(restoring)}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="Restore this version?"
        description="The current state is saved as a recovery point first, so nothing is lost. Everyone connected will see the restored content immediately."
        confirmLabel="Restore"
        onConfirm={() => restoring && restore.mutate(restoring.id)}
        loading={restore.isPending}
      />
      {compare ? <CompareDialog type={type} id={id} a={compare[0]} b={compare[1]} onClose={() => setCompare(null)} /> : null}
    </div>
  );
}

function CompareDialog({ type, id, a, b, onClose }: { type: "canvas" | "document"; id: string; a: VersionDto; b: VersionDto; onClose: () => void }) {
  const base = type === "canvas" ? `/canvases/${id}` : `/documents/${id}`;
  const va = useQuery<{ text?: string; objects?: Array<{ id: string; type: string; text: string; title: string }> }>({ queryKey: ["version", type, id, a.id], queryFn: () => get(`${base}/versions/${a.id}`) });
  const vb = useQuery<{ text?: string; objects?: Array<{ id: string; type: string; text: string; title: string }> }>({ queryKey: ["version", type, id, b.id], queryFn: () => get(`${base}/versions/${b.id}`) });
  const diff = (() => {
    if (!va.data || !vb.data) return null;
    if (type === "document") {
      const la = (va.data.text ?? "").split("\n");
      const lb = (vb.data.text ?? "").split("\n");
      const setA = new Set(la);
      const setB = new Set(lb);
      return { added: la.filter((l) => l && !setB.has(l)), removed: lb.filter((l) => l && !setA.has(l)) };
    }
    const ma = new Map((va.data.objects ?? []).map((o) => [o.id, o]));
    const mb = new Map((vb.data.objects ?? []).map((o) => [o.id, o]));
    return {
      added: [...ma.values()].filter((o) => !mb.has(o.id)).map((o) => `${o.type}: ${o.text || o.title || o.id}`),
      removed: [...mb.values()].filter((o) => !ma.has(o.id)).map((o) => `${o.type}: ${o.text || o.title || o.id}`),
      changed: [...ma.values()].filter((o) => mb.has(o.id) && JSON.stringify(o) !== JSON.stringify(mb.get(o.id))).map((o) => `${o.type}: ${o.text || o.title || o.id}`),
    };
  })();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Compare versions</DialogTitle>
          <DialogDescription>
            {a.name ?? KIND[a.kind].label} ({formatDate(a.createdAt, true)}) vs {b.name ?? KIND[b.kind].label} ({formatDate(b.createdAt, true)})
          </DialogDescription>
        </DialogHeader>
        {!diff ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <DiffList title={`Added in newer (${diff.added.length})`} items={diff.added} tone="success" />
            <DiffList title={`Removed since older (${diff.removed.length})`} items={diff.removed} tone="error" />
            {"changed" in diff ? <DiffList title={`Changed (${diff.changed.length})`} items={diff.changed} tone="warning" /> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DiffList({ title, items, tone }: { title: string; items: string[]; tone: "success" | "error" | "warning" }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h3>
      <ul className={cn("max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-xs", items.length === 0 && "text-text-muted")}>
        {items.length === 0 ? <li>None</li> : items.slice(0, 50).map((it, i) => (
          <li key={i} className={cn("rounded px-1.5 py-0.5", tone === "success" && "bg-success-soft text-success", tone === "error" && "bg-error-soft text-error line-through", tone === "warning" && "bg-warning-soft text-warning")}>
            {it.slice(0, 160)}
          </li>
        ))}
      </ul>
    </div>
  );
}
