"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Globe, Link2, Lock, Trash2, UserPlus, Check } from "lucide-react";
import { get, post, patch, del, errorMessage, type PermissionDto, type ShareLinkDto } from "@/lib/api";
import { useMembers } from "@/lib/queries";
import { useApp } from "./workspace-context";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SimpleSelect, Switch } from "@/components/ui/controls";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/overlays";

type Level = "VIEWER" | "COMMENTER" | "EDITOR";
const LEVELS: Array<{ value: Level; label: string }> = [
  { value: "VIEWER", label: "Can view" },
  { value: "COMMENTER", label: "Can comment" },
  { value: "EDITOR", label: "Can edit" },
];

export function ShareDialog({ resourceType, resourceId, title, onClose }: { resourceType: string; resourceId: string; title: string; onClose: () => void }) {
  const { workspace } = useApp();
  const qc = useQueryClient();
  const members = useMembers(workspace?.id);
  const grants = useQuery<{ grants: PermissionDto[]; visibility: string; ownerId: string | null; canManage: boolean }>({ queryKey: ["permissions", resourceType, resourceId], queryFn: () => get(`/permissions`, { resourceType, resourceId }) });
  const links = useQuery<ShareLinkDto[]>({ queryKey: ["share-links", resourceType, resourceId], queryFn: () => get(`/share-links`, { resourceType, resourceId }) });
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState<Level>("EDITOR");
  const [linkLevel, setLinkLevel] = useState<Level>("VIEWER");
  const [requireLogin, setRequireLogin] = useState(false);
  const [expires, setExpires] = useState<string>("168");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["permissions", resourceType, resourceId] });
    void qc.invalidateQueries({ queryKey: ["share-links", resourceType, resourceId] });
  };

  const grant = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await post("/permissions", { resourceType, resourceId, userId, level });
      setUserId("");
      refresh();
      toast.success("Access granted");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const createLink = async () => {
    setBusy(true);
    try {
      const res = await post<ShareLinkDto>("/share-links", { resourceType, resourceId, level: linkLevel, requireLogin: linkLevel === "EDITOR" ? true : requireLogin, expiresInHours: expires === "never" ? null : Number(expires) });
      setCreated(res.url ?? null);
      refresh();
      if (res.url) await navigator.clipboard?.writeText(res.url).catch(() => {});
      toast.success("Share link created and copied");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const toggleVisibility = async () => {
    if (!grants.data) return;
    const next = grants.data.visibility === "PRIVATE" ? "WORKSPACE" : "PRIVATE";
    const path = resourceType === "CANVAS" ? `/canvases/${resourceId}` : resourceType === "DOCUMENT" ? `/documents/${resourceId}` : resourceType === "PROJECT" ? `/projects/${resourceId}` : `/meetings/${resourceId}`;
    try {
      await patch(path, { visibility: next });
      refresh();
      void qc.invalidateQueries({ queryKey: [resourceType.toLowerCase(), resourceId] });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const candidates = (members.data ?? []).filter((m) => !grants.data?.grants.some((g) => g.userId === m.user.id) && m.user.id !== grants.data?.ownerId);
  const isPrivate = grants.data?.visibility === "PRIVATE";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Share “{title}”</DialogTitle>
          <DialogDescription>Control who can view, comment on or edit this {resourceType.toLowerCase()}. Permissions are enforced on the server.</DialogDescription>
        </DialogHeader>

        <section className="rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-surface-2">{isPrivate ? <Lock className="size-4" /> : <Globe className="size-4" />}</div>
              <div>
                <p className="text-sm font-medium">{isPrivate ? "Restricted" : `Everyone in ${workspace?.name ?? "the workspace"}`}</p>
                <p className="text-xs text-text-secondary">{isPrivate ? "Only you and people you add below can access it." : "Workspace members can access it; guests need an explicit grant."}</p>
              </div>
            </div>
            {grants.data?.canManage ? (
              <Button size="sm" variant="outline" onClick={() => void toggleVisibility()}>
                {isPrivate ? "Open to workspace" : "Make restricted"}
              </Button>
            ) : null}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">People with access</h3>
          {grants.data?.canManage ? (
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <SimpleSelect value={userId || undefined} onChange={setUserId} placeholder="Add a workspace member or guest…" options={candidates.map((m) => ({ value: m.user.id, label: `${m.user.name} (${m.user.email})` }))} />
              </div>
              <SimpleSelect value={level} onChange={setLevel} options={LEVELS} className="sm:w-40" />
              <Button onClick={() => void grant()} disabled={!userId} loading={busy}>
                <UserPlus /> Add
              </Button>
            </div>
          ) : null}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {grants.data?.grants.length === 0 ? <li className="px-3 py-3 text-sm text-text-secondary">No individual grants yet.</li> : null}
            {grants.data?.grants.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-3 py-2">
                <UserAvatar user={g.user} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{g.user.name}</p>
                  <p className="truncate text-xs text-text-muted">{g.user.email}</p>
                </div>
                {grants.data?.canManage ? (
                  <>
                    <SimpleSelect
                      value={g.level}
                      onChange={async (v) => {
                        await patch(`/permissions/${g.id}`, { level: v });
                        refresh();
                      }}
                      options={LEVELS}
                      className="w-36"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove access"
                      onClick={async () => {
                        await del(`/permissions/${g.id}`);
                        refresh();
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : (
                  <Badge variant="secondary">{g.level.toLowerCase()}</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>

        {grants.data?.canManage ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold">Share links</h3>
            <div className="rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Access">
                  <SimpleSelect value={linkLevel} onChange={setLinkLevel} options={LEVELS} />
                </Field>
                <Field label="Expires">
                  <SimpleSelect value={expires} onChange={setExpires} options={[{ value: "24", label: "In 24 hours" }, { value: "168", label: "In 7 days" }, { value: "720", label: "In 30 days" }, { value: "never", label: "Never" }]} />
                </Field>
                <Field label="Require sign-in">
                  <div className="flex h-9 items-center gap-2">
                    <Switch checked={linkLevel === "EDITOR" ? true : requireLogin} disabled={linkLevel === "EDITOR"} onCheckedChange={setRequireLogin} aria-label="Require sign-in" />
                    <span className="text-xs text-text-secondary">{linkLevel === "EDITOR" ? "Required for edit access" : requireLogin ? "Signed-in users only" : "Anyone with the link"}</span>
                  </div>
                </Field>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" onClick={() => void createLink()} loading={busy}>
                  <Link2 /> Create link
                </Button>
                {created ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-xs">
                    <span className="truncate">{created}</span>
                    <button
                      className="shrink-0 text-primary"
                      onClick={async () => {
                        await navigator.clipboard?.writeText(created);
                        toast.success("Copied");
                      }}
                      aria-label="Copy link"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-text-muted">Links are public by design when sign-in is not required. The full URL is shown only once — anyone with it gets the selected access until it expires or is revoked.</p>
            </div>
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
              {links.data?.filter((l) => l.active).length === 0 ? <li className="px-3 py-3 text-sm text-text-secondary">No active links.</li> : null}
              {links.data
                ?.filter((l) => l.active)
                .map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Link2 className="size-4 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        …{l.tokenPrefix} · {l.level.toLowerCase()} {l.requireLogin ? "· sign-in required" : "· public"}
                      </p>
                      <p className="text-xs text-text-muted">
                        {l.expiresAt ? `Expires ${formatDate(l.expiresAt, true)}` : "Never expires"} · opened {l.accessCount}× · by {l.createdBy.name}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await del(`/share-links/${l.id}`);
                        refresh();
                        toast.success("Link revoked");
                      }}
                    >
                      Revoke
                    </Button>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            <Check /> Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
