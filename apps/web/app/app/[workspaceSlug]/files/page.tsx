"use client";

import { Suspense, useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, File as FileIcon, FileText, Film, Image as ImageIcon, Music, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { del, patch, post, errorMessage, uploadFile, type FileAssetDto } from "@/lib/api";
import { useFiles, useProjects } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { SegmentTabs, SimpleSelect, Progress } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, ConfirmDialog } from "@/components/ui/overlays";
import { formatBytes, formatDate, cn } from "@/lib/utils";

const MIME_ICON = (m: string) => (m.startsWith("image/") ? ImageIcon : m.startsWith("video/") ? Film : m.startsWith("audio/") ? Music : m === "application/pdf" || m.startsWith("text/") ? FileText : FileIcon);

interface UploadState {
  id: string;
  name: string;
  progress: number;
  error?: string;
  file: File;
  abort?: () => void;
}

function FilesContent() {
  const { workspace, isGuest } = useApp();
  const params = useSearchParams();
  useHeader({ title: "Files" });
  const qc = useQueryClient();
  const [type, setType] = useState<"" | "image" | "document" | "video" | "audio" | "other">("");
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [preview, setPreview] = useState<FileAssetDto | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const projects = useProjects(workspace?.id);
  const files = useFiles(workspace?.id, { type: type || undefined, projectId: projectId || undefined, q: q || undefined, deleted: deleted || undefined });
  const highlight = params.get("file");

  const startUpload = useCallback(
    (list: FileList | File[]) => {
      if (!workspace) return;
      for (const file of Array.from(list)) {
        const id = `${file.name}-${Date.now()}-${Math.random()}`;
        const state: UploadState = { id, name: file.name, progress: 0, file };
        setUploads((u) => [...u, state]);
        const p = uploadFile(file, { workspaceId: workspace.id, projectId: projectId || undefined }, (pct) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: pct } : x))));
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, abort: p.abort } : x)));
        p.then(() => {
          setUploads((u) => u.filter((x) => x.id !== id));
          void qc.invalidateQueries({ queryKey: ["files"] });
          toast.success(`Uploaded ${file.name}`);
        }).catch((err) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: errorMessage(err) } : x))));
      }
    },
    [workspace, projectId, qc],
  );

  return (
    <div
      className={cn("relative mx-auto max-w-6xl px-4 py-6 sm:px-6", dragging && "after:pointer-events-none after:absolute after:inset-2 after:rounded-2xl after:border-2 after:border-dashed after:border-primary after:bg-primary/5")}
      onDragOver={(e) => {
        if (isGuest) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!isGuest && e.dataTransfer.files.length) startUpload(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title="Files"
        description="Shared files and attachments. Drag and drop anywhere to upload."
        actions={
          !isGuest ? (
            <>
              <input ref={inputRef} type="file" multiple className="sr-only" onChange={(e) => e.target.files && startUpload(e.target.files)} />
              <Button onClick={() => inputRef.current?.click()}>
                <Upload /> Upload
              </Button>
            </>
          ) : null
        }
      />
      {uploads.length ? (
        <div className="mb-4 space-y-2 rounded-xl border border-border bg-surface p-3">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              {u.error ? (
                <>
                  <span className="text-xs text-error">{u.error}</span>
                  <Button size="xs" variant="outline" onClick={() => { setUploads((x) => x.filter((y) => y.id !== u.id)); startUpload([u.file]); }}>
                    <RotateCcw /> Retry
                  </Button>
                </>
              ) : (
                <Progress value={u.progress} className="w-40" />
              )}
              <button onClick={() => { u.abort?.(); setUploads((x) => x.filter((y) => y.id !== u.id)); }} className="text-text-muted hover:text-text" aria-label="Cancel">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentTabs value={type} onChange={setType} options={[{ value: "", label: "All" }, { value: "image", label: "Images" }, { value: "document", label: "Documents" }, { value: "video", label: "Video" }, { value: "audio", label: "Audio" }, { value: "other", label: "Other" }]} />
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files…" className="w-48 pl-8" aria-label="Search files" />
          </div>
          <SimpleSelect value={projectId || "all"} onChange={(v) => setProjectId(v === "all" ? "" : v)} options={[{ value: "all", label: "All projects" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} className="w-44" />
          <Button variant={deleted ? "subtle" : "ghost"} size="sm" onClick={() => setDeleted(!deleted)}>
            <Trash2 /> {deleted ? "Viewing trash" : "Trash"}
          </Button>
        </div>
      </div>
      {files.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : files.data?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {files.data.map((f) => (
            <FileCard key={f.id} file={f} highlighted={highlight === f.id} inTrash={deleted} onOpen={() => setPreview(f)} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Upload />} title={deleted ? "Trash is empty" : "No files yet"} description={deleted ? "Deleted files stay here for 30 days." : "Upload images, PDFs, spreadsheets and more. Files can be attached to tasks, canvases and chat."} action={!isGuest && !deleted ? <Button onClick={() => inputRef.current?.click()}><Upload /> Upload a file</Button> : undefined} />
      )}
      {preview ? <FilePreview file={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

export default function FilesPage() {
  return (
    <Suspense>
      <FilesContent />
    </Suspense>
  );
}

function FileCard({ file: f, highlighted, inTrash, onOpen }: { file: FileAssetDto; highlighted: boolean; inTrash: boolean; onOpen: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["files"] });
  const remove = useMutation({ mutationFn: () => del(`/files/${f.id}`), onSuccess: () => { refresh(); toast.success("Moved to trash"); }, onError: (e) => toast.error(errorMessage(e)) });
  const restore = useMutation({ mutationFn: () => post(`/files/${f.id}/restore`), onSuccess: () => { refresh(); toast.success("File restored"); }, onError: (e) => toast.error(errorMessage(e)) });
  const Icon = MIME_ICON(f.mimeType);
  const isImage = f.mimeType.startsWith("image/");
  return (
    <div className={cn("group flex flex-col overflow-hidden rounded-xl border bg-surface shadow-sm transition-shadow hover:shadow-md", highlighted ? "border-primary ring-2 ring-primary/20" : "border-border")}>
      <button onClick={onOpen} className="relative flex h-28 items-center justify-center bg-surface-2" aria-label={`Preview ${f.name}`}>
        {isImage && !inTrash ? <img src={`/api/v1/files/${f.id}/download`} alt={f.altText ?? f.name} className="size-full object-cover" loading="lazy" /> : <Icon className="size-10 text-text-muted" />}
      </button>
      <div className="flex flex-1 flex-col p-3">
        <p className="truncate text-sm font-medium" title={f.name}>
          {f.name}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {formatBytes(f.sizeBytes)} · {formatDate(f.createdAt)}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <span className="flex items-center gap-1 text-[11px] text-text-muted">
            <UserAvatar user={f.uploader} size="xs" /> {f.uploader.name}
          </span>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {inTrash ? (
              <Button size="icon-xs" variant="ghost" aria-label="Restore" onClick={() => restore.mutate()}>
                <RotateCcw />
              </Button>
            ) : (
              <>
                <Button asChild size="icon-xs" variant="ghost" aria-label="Download">
                  <a href={`/api/v1/files/${f.id}/download?download=1`}>
                    <Download />
                  </a>
                </Button>
                <Button size="icon-xs" variant="ghost" aria-label="Delete" onClick={() => setConfirm(true)}>
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`Delete ${f.name}?`} description="The file moves to the trash and is permanently removed after 30 days." confirmLabel="Delete" destructive onConfirm={() => remove.mutate()} />
    </div>
  );
}

function FilePreview({ file: f, onClose }: { file: FileAssetDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(f.name);
  const [alt, setAlt] = useState(f.altText ?? "");
  const [replacing, setReplacing] = useState(false);
  const save = useMutation({ mutationFn: () => patch(`/files/${f.id}`, { name, altText: alt || null }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["files"] }); toast.success("Saved"); }, onError: (e) => toast.error(errorMessage(e)) });
  const isImage = f.mimeType.startsWith("image/");
  const isPdf = f.mimeType === "application/pdf";
  const isVideo = f.mimeType.startsWith("video/");
  const isAudio = f.mimeType.startsWith("audio/");
  const url = `/api/v1/files/${f.id}/download`;
  const replace = async (file: File) => {
    setReplacing(true);
    try {
      await uploadFile(file, { workspaceId: f.workspaceId, projectId: f.projectId ?? undefined, replaceFileId: f.id });
      void qc.invalidateQueries({ queryKey: ["files"] });
      toast.success("File replaced");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReplacing(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{f.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <div className="flex min-h-[300px] items-center justify-center overflow-hidden rounded-lg bg-surface-2">
            {isImage ? <img src={url} alt={f.altText ?? f.name} className="max-h-[60vh] max-w-full object-contain" /> : isPdf ? <iframe src={url} title={f.name} className="h-[60vh] w-full" sandbox="" /> : isVideo ? <video src={url} controls className="max-h-[60vh] max-w-full" /> : isAudio ? <audio src={url} controls /> : <div className="text-center text-sm text-text-secondary"><FileIcon className="mx-auto mb-2 size-10 text-text-muted" />No preview available for {f.mimeType}.</div>}
          </div>
          <div className="space-y-4">
            <dl className="space-y-1 text-xs text-text-secondary">
              <div className="flex justify-between"><dt>Type</dt><dd className="font-medium text-text">{f.mimeType}</dd></div>
              <div className="flex justify-between"><dt>Size</dt><dd className="font-medium text-text">{formatBytes(f.sizeBytes)}</dd></div>
              <div className="flex justify-between"><dt>Uploaded</dt><dd className="font-medium text-text">{formatDate(f.createdAt, true)}</dd></div>
              <div className="flex justify-between"><dt>By</dt><dd className="font-medium text-text">{f.uploader.name}</dd></div>
              {f.project ? <div className="flex justify-between"><dt>Project</dt><dd className="font-medium text-text">{f.project.name}</dd></div> : null}
              {f.resourceType ? <div className="flex justify-between"><dt>Attached to</dt><dd><Badge variant="secondary">{f.resourceType.toLowerCase()}</Badge></dd></div> : null}
            </dl>
            <Field label="Name" htmlFor="file-name">
              <Input id="file-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {isImage ? (
              <Field label="Alt text" htmlFor="file-alt" hint="Describe the image for screen readers.">
                <Input id="file-alt" value={alt} onChange={(e) => setAlt(e.target.value)} />
              </Field>
            ) : null}
            <Button size="sm" className="w-full" onClick={() => save.mutate()} loading={save.isPending}>
              Save details
            </Button>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline" className="flex-1">
                <a href={`${url}?download=1`}>
                  <Download /> Download
                </a>
              </Button>
              <label className={cn("inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-surface-2", replacing && "opacity-50")}>
                <Upload className="size-4" /> {replacing ? "Replacing…" : "Replace"}
                <input type="file" className="sr-only" disabled={replacing} onChange={(e) => e.target.files?.[0] && void replace(e.target.files[0])} />
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
