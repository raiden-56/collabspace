"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { Card, PageHeader, Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";

interface System {
  version: string;
  node: string;
  uptimeSeconds: number;
  memory: number;
  services: { database: boolean; redis: boolean; sync: boolean; storage: string; email: string; ai: { provider: string; enabled: boolean; model: string | null; dataSentToProvider: string } };
  counts: Record<string, number>;
}

export default function SystemPage() {
  const sys = useQuery<System>({ queryKey: ["admin-system"], queryFn: () => get("/admin/system"), refetchInterval: 15_000 });
  const s = sys.data;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="System" description="Health of the API, sync service and dependencies. Refreshes every 15 seconds." />
      {!s ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Services</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Item label="PostgreSQL" value={<Badge variant={s.services.database ? "success" : "error"}>{s.services.database ? "connected" : "unavailable"}</Badge>} />
              <Item label="Redis" value={<Badge variant={s.services.redis ? "success" : "secondary"}>{s.services.redis ? "connected (multi-instance fan-out enabled)" : "not configured (single instance)"}</Badge>} />
              <Item label="Sync service" value={<Badge variant={s.services.sync ? "success" : "error"}>{s.services.sync ? "reachable" : "unreachable"}</Badge>} />
              <Item label="Object storage" value={<Badge variant="secondary">{s.services.storage}</Badge>} />
              <Item label="Email delivery" value={<Badge variant={s.services.email === "smtp" ? "success" : "warning"}>{s.services.email}</Badge>} />
              <Item label="AI provider" value={<Badge variant={s.services.ai.enabled ? "violet" : "error"}>{s.services.ai.provider}{s.services.ai.model ? ` · ${s.services.ai.model}` : ""}</Badge>} />
            </dl>
            <p className="mt-4 rounded-md bg-surface-2 p-3 text-xs text-text-secondary">
              <span className="font-medium text-text">What is sent to the AI provider:</span> {s.services.ai.dataSentToProvider}
            </p>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Process</h2>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Item label="API version" value={s.version} />
              <Item label="Node.js" value={s.node} />
              <Item label="Uptime" value={`${Math.floor(s.uptimeSeconds / 3600)}h ${Math.floor((s.uptimeSeconds % 3600) / 60)}m`} />
              <Item label="Memory (RSS)" value={formatBytes(s.memory)} />
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Counters</h2>
            <dl className="grid gap-3 sm:grid-cols-4">
              {Object.entries(s.counts).map(([k, v]) => (
                <Item key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()} value={v} />
              ))}
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Operational settings</h2>
            <p className="text-sm text-text-secondary">Runtime configuration is environment-based (see <code className="rounded bg-surface-2 px-1">.env.example</code>): database and Redis URLs, session secret, storage, SMTP, AI provider and trusted origins. Restart the API and sync services after changing them.</p>
          </Card>
        </div>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
