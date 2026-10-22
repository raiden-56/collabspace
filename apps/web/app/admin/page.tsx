"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, Building2, Users, Cpu } from "lucide-react";
import { get } from "@/lib/api";
import { Card, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface System {
  version: string;
  node: string;
  uptimeSeconds: number;
  services: { database: boolean; redis: boolean; sync: boolean; storage: string; email: string; ai: { provider: string; enabled: boolean; model: string | null } };
  counts: { users: number; workspaces: number; activeSessions: number; aiJobs: number; pendingJobs: number; failedJobs: number; collabDocs: number };
}

export default function AdminHome() {
  const sys = useQuery<System>({ queryKey: ["admin-system"], queryFn: () => get("/admin/system"), refetchInterval: 30_000 });
  const s = sys.data;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Platform overview" description="Operational snapshot of this CollabSpace deployment." />
      {!s ? (
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat href="/admin/users" icon={<Users />} label="Users" value={s.counts.users} />
            <Stat href="/admin/workspaces" icon={<Building2 />} label="Workspaces" value={s.counts.workspaces} />
            <Stat href="/admin/system" icon={<Activity />} label="Active sessions" value={s.counts.activeSessions} />
            <Stat href="/admin/system" icon={<Cpu />} label="Collab documents" value={s.counts.collabDocs} />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Service health</h2>
              <ul className="space-y-2 text-sm">
                <Row label="PostgreSQL" ok={s.services.database} />
                <Row label="Redis (optional)" ok={s.services.redis} okLabel="connected" badLabel="not configured" neutral />
                <Row label="Sync service" ok={s.services.sync} />
                <li className="flex items-center justify-between">
                  <span>Object storage</span>
                  <Badge variant="secondary">{s.services.storage}</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span>Email</span>
                  <Badge variant="secondary">{s.services.email}</Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span>AI provider</span>
                  <Badge variant={s.services.ai.enabled ? "violet" : "error"}>
                    {s.services.ai.provider}
                    {s.services.ai.model ? ` · ${s.services.ai.model}` : ""}
                  </Badge>
                </li>
              </ul>
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold">Background jobs</h2>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-surface-2 p-3">
                  <p className="text-2xl font-semibold">{s.counts.aiJobs}</p>
                  <p className="text-xs text-text-muted">total</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3">
                  <p className="text-2xl font-semibold text-warning">{s.counts.pendingJobs}</p>
                  <p className="text-xs text-text-muted">pending</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-3">
                  <p className="text-2xl font-semibold text-error">{s.counts.failedJobs}</p>
                  <p className="text-xs text-text-muted">failed</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-text-muted">
                API v{s.version} · Node {s.node} · up {Math.round(s.uptimeSeconds / 60)} min
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: number }) {
  return (
    <Link href={href}>
      <Card className="p-5 transition-shadow hover:shadow-md">
        <div className="mb-2 flex size-8 items-center justify-center rounded-md bg-primary-soft text-primary [&_svg]:size-4">{icon}</div>
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-xs text-text-secondary">{label}</p>
      </Card>
    </Link>
  );
}

function Row({ label, ok, okLabel = "healthy", badLabel = "unavailable", neutral }: { label: string; ok: boolean; okLabel?: string; badLabel?: string; neutral?: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span>{label}</span>
      <Badge variant={ok ? "success" : neutral ? "secondary" : "error"}>{ok ? okLabel : badLabel}</Badge>
    </li>
  );
}
