"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Plus, Users } from "lucide-react";
import { post, errorMessage, type WorkspaceDto } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useHeader } from "@/lib/stores/header-store";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, PageHeader } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/overlays";

function WorkspacesContent() {
  const { me } = useApp();
  useHeader({ title: "Workspaces" });
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(params.get("new") === "1");
  useEffect(() => setOpen(params.get("new") === "1"), [params]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Workspaces"
        description="Switch between the teams you belong to or create a new one."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New workspace
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {me?.workspaces.map((w) => (
          <Card key={w.id} className="flex flex-col p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-lg font-bold text-white">{w.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-semibold">{w.name}</h2>
                  {w.isDemo ? <Badge variant="warning">demo</Badge> : null}
                </div>
                <p className="text-xs text-text-muted">
                  /{w.slug} · {w.role.toLowerCase()}
                </p>
                {w.description ? <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{w.description}</p> : null}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <Users className="size-3.5" /> {w.memberCount} members · {w.projectCount} projects
              </span>
              <Button asChild size="sm" variant="subtle">
                <Link href={`/app/${w.slug}`}>
                  Open <ArrowRight />
                </Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <CreateWorkspaceDialog
        open={open}
        onClose={() => {
          setOpen(false);
          router.replace("/app/workspaces");
        }}
      />
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <Suspense>
      <WorkspacesContent />
    </Suspense>
  );
}

export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const ws = await post<WorkspaceDto>("/workspaces", { name: name.trim(), description: description || undefined, demo });
      await qc.invalidateQueries({ queryKey: ["me"] });
      onClose();
      router.push(`/app/${ws.slug}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>You&apos;ll be the owner and can invite teammates afterwards.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Name" htmlFor="ws-name">
            <Input id="ws-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Design" required />
          </Field>
          <Field label="Description" htmlFor="ws-desc">
            <Textarea id="ws-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-surface-2">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-1 accent-primary" />
            <span className="text-sm">
              <span className="font-medium">Include demo content</span>
              <span className="block text-text-secondary">Sample project, canvases, document and meeting labeled [Demo].</span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!name.trim()}>
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
