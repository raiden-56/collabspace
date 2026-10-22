"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, MoreHorizontal, Search, UserMinus, UserPlus, X } from "lucide-react";
import { get, patch, del, errorMessage } from "@/lib/api";
import { useMembers } from "@/lib/queries";
import { useApp } from "@/components/app-shell/workspace-context";
import { useCreateDialogs } from "@/components/app-shell/create-dialogs";
import { useHeader } from "@/lib/stores/header-store";
import { usePresence } from "@/lib/realtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/ui/avatar";
import { Card, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ConfirmDialog } from "@/components/ui/overlays";
import { formatDate, cn } from "@/lib/utils";

const ROLE_BADGE: Record<string, "default" | "violet" | "secondary" | "warning"> = { OWNER: "violet", ADMIN: "default", MEMBER: "secondary", GUEST: "warning" };
const ROLE_HELP: Record<string, string> = { OWNER: "Full control, including billing and deletion", ADMIN: "Manage members, settings and all content", MEMBER: "Create and edit workspace content", GUEST: "Only sees what is explicitly shared" };

interface Invitation {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: { name: string };
}

export default function MembersPage() {
  const { workspace, user, canManage, isGuest } = useApp();
  useHeader({ title: "Members" });
  const dialogs = useCreateDialogs();
  const qc = useQueryClient();
  const members = useMembers(workspace?.id);
  const invitations = useQuery<Invitation[]>({ queryKey: ["invitations", workspace?.id], queryFn: () => get(`/workspaces/${workspace!.id}/invitations`), enabled: Boolean(workspace && canManage) });
  const online = usePresence(workspace ? `workspace:${workspace.id}` : null, { status: "online" });
  const onlineIds = new Set(online.map((p) => p.userId));
  const [q, setQ] = useState("");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["members"] });
    void qc.invalidateQueries({ queryKey: ["invitations"] });
  };
  const changeRole = useMutation({ mutationFn: ({ userId, role }: { userId: string; role: string }) => patch(`/workspaces/${workspace!.id}/members/${userId}`, { role }), onSuccess: () => { refresh(); toast.success("Role updated"); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (userId: string) => del(`/workspaces/${workspace!.id}/members/${userId}`), onSuccess: () => { refresh(); toast.success("Member removed"); setRemoving(null); }, onError: (e) => toast.error(errorMessage(e)) });
  const revoke = useMutation({ mutationFn: (id: string) => del(`/workspaces/${workspace!.id}/invitations/${id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const list = (members.data ?? []).filter((m) => !q || m.user.name.toLowerCase().includes(q.toLowerCase()) || m.user.email.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Members"
        description={`${members.data?.length ?? 0} people in ${workspace?.name ?? "this workspace"} · ${online.length} online`}
        actions={
          canManage && !isGuest ? (
            <Button onClick={dialogs.openInvite}>
              <UserPlus /> Invite people
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className="w-64 pl-8" aria-label="Search members" />
        </div>
        <div className="hidden gap-3 text-xs text-text-muted sm:flex">
          {Object.entries(ROLE_HELP).map(([r, h]) => (
            <span key={r} title={h} className="flex items-center gap-1">
              <Badge variant={ROLE_BADGE[r]}>{r.toLowerCase()}</Badge>
            </span>
          ))}
        </div>
      </div>
      {members.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {list.map((m) => {
            const isSelf = m.user.id === user?.id;
            const canEditThis = canManage && !isSelf && m.role !== "OWNER";
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="relative">
                  <UserAvatar user={m.user} size="lg" />
                  <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface", onlineIds.has(m.user.id) ? "bg-success" : "bg-text-muted/40")} aria-label={onlineIds.has(m.user.id) ? "Online" : "Offline"} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.user.name} {isSelf ? <span className="text-text-muted">(you)</span> : null}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {m.user.email} · joined {formatDate(m.joinedAt)}
                  </p>
                </div>
                {canEditThis ? (
                  <SimpleSelect value={m.role} onChange={(role) => changeRole.mutate({ userId: m.user.id, role })} options={(workspace?.role === "OWNER" ? ["OWNER", "ADMIN", "MEMBER", "GUEST"] : ["ADMIN", "MEMBER", "GUEST"]).map((r) => ({ value: r, label: r[0] + r.slice(1).toLowerCase() }))} className="w-32" />
                ) : (
                  <Badge variant={ROLE_BADGE[m.role]} title={ROLE_HELP[m.role]}>
                    {m.role.toLowerCase()}
                  </Badge>
                )}
                {canEditThis || (isSelf && m.role !== "OWNER") ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label="Member actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem destructive onSelect={() => setRemoving({ id: m.user.id, name: isSelf ? "yourself" : m.user.name })}>
                        <UserMinus /> {isSelf ? "Leave workspace" : "Remove from workspace"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="w-7" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && invitations.data?.length ? (
        <Card className="mt-6 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Mail className="size-4 text-primary" /> Pending invitations
          </h2>
          <ul className="divide-y divide-border">
            {invitations.data.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{inv.email}</p>
                  <p className="text-xs text-text-muted">
                    {inv.role.toLowerCase()} · invited by {inv.invitedBy.name} · expires {formatDate(inv.expiresAt)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id)}>
                  <X /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title={removing?.id === user?.id ? "Leave this workspace?" : `Remove ${removing?.name}?`} description="They will lose access to all projects, documents and conversations in this workspace." confirmLabel={removing?.id === user?.id ? "Leave" : "Remove"} destructive onConfirm={() => removing && remove.mutate(removing.id)} />
    </div>
  );
}
