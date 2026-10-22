"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Search, X } from "lucide-react";
import { get, del, type SearchHit } from "@/lib/api";
import { useApp } from "@/components/app-shell/workspace-context";
import { useProjects, useMembers } from "@/lib/queries";
import { useHeader } from "@/lib/stores/header-store";
import { useUiStore } from "@/lib/stores/ui-store";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { ResourceIcon, humanResourceType } from "@/components/shared/resource-link";
import { formatDate, cn } from "@/lib/utils";

const TYPES = ["DOCUMENT", "CANVAS", "PROJECT", "TASK", "MEETING", "COMMENT", "MESSAGE", "FILE"];

function SearchContent() {
  const { me, workspace } = useApp();
  const lastSlug = useUiStore((s) => s.lastWorkspaceSlug);
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  useHeader({ title: "Search" });
  const [q, setQ] = useState(params.get("q") ?? "");
  const [types, setTypes] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [range, setRange] = useState("");
  const [active, setActive] = useState(0);
  const dq = useDebounce(q, 250);
  const ws = workspace ?? me?.workspaces.find((w) => w.slug === lastSlug) ?? me?.workspaces[0];
  const projects = useProjects(ws?.id);
  const members = useMembers(ws?.id);
  const from = useMemo(() => (range === "7d" ? new Date(Date.now() - 7 * 86400_000).toISOString() : range === "30d" ? new Date(Date.now() - 30 * 86400_000).toISOString() : range === "90d" ? new Date(Date.now() - 90 * 86400_000).toISOString() : undefined), [range]);

  const search = useQuery<{ hits: SearchHit[]; suggestions?: { recent: unknown[]; history: string[] } }>({
    queryKey: ["search", ws?.id, dq, types.join(","), projectId, ownerId, from],
    queryFn: () => get(`/search`, { workspaceId: ws!.id, q: dq, types: types.length ? types.join(",") : undefined, projectId: projectId || undefined, ownerId: ownerId || undefined, from, limit: 20 }),
    enabled: Boolean(ws),
    placeholderData: (prev) => prev,
  });
  const history = useQuery<Array<{ id: string; query: string }>>({ queryKey: ["search-history"], queryFn: () => get("/users/me/search-history") });
  const hits = search.data?.hits ?? [];

  useEffect(() => setActive(0), [dq, types, projectId, ownerId, from]);
  useEffect(() => {
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ["search-history"] }), 800);
    return () => clearTimeout(t);
  }, [dq, qc]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && hits[active]) {
      router.push(hits[active]!.href);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoFocus placeholder={ws ? `Search ${ws.name}…` : "Search…"} className="h-12 pl-10 pr-10 text-base" aria-label="Search" />
        {q ? (
          <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text" aria-label="Clear">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button key={t} onClick={() => setTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))} aria-pressed={types.includes(t)} className={cn("rounded-full border px-2.5 py-1 text-xs capitalize", types.includes(t) ? "border-primary bg-primary-soft text-primary" : "border-border text-text-secondary hover:text-text")}>
            {t.toLowerCase()}s
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <SimpleSelect value={projectId || "all"} onChange={(v) => setProjectId(v === "all" ? "" : v)} options={[{ value: "all", label: "Any project" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} className="h-8 w-40 text-xs" />
        <SimpleSelect value={ownerId || "all"} onChange={(v) => setOwnerId(v === "all" ? "" : v)} options={[{ value: "all", label: "Anyone" }, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name }))]} className="h-8 w-40 text-xs" />
        <SimpleSelect value={range || "any"} onChange={(v) => setRange(v === "any" ? "" : v)} options={[{ value: "any", label: "Any time" }, { value: "7d", label: "Past week" }, { value: "30d", label: "Past month" }, { value: "90d", label: "Past 3 months" }]} className="h-8 w-36 text-xs" />
      </div>

      <div className="mt-6">
        {!dq ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text-secondary">
                <Clock className="size-4" /> Recent searches
              </h2>
              {history.data?.length ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={async () => {
                    await del("/users/me/search-history");
                    void qc.invalidateQueries({ queryKey: ["search-history"] });
                  }}
                >
                  Clear history
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {history.data?.map((h) => (
                <button key={h.id} onClick={() => setQ(h.query)} className="rounded-full bg-surface-2 px-3 py-1 text-sm hover:bg-surface-3">
                  {h.query}
                </button>
              ))}
              {history.data?.length === 0 ? <p className="text-sm text-text-muted">Your recent searches will appear here. Try a task key like “PRJ-12”, a document title or a phrase from a meeting transcript.</p> : null}
            </div>
          </div>
        ) : search.isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : hits.length === 0 ? (
          <EmptyState icon={<Search />} title={`No results for “${dq}”`} description="Only content you have access to is searched. Try fewer filters or a different phrase." />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface" role="listbox">
            {hits.map((h, i) => (
              <li key={`${h.type}:${h.id}`} role="option" aria-selected={i === active}>
                <Link href={h.href} onMouseEnter={() => setActive(i)} className={cn("flex items-start gap-3 px-4 py-3", i === active && "bg-surface-2")}>
                  <ResourceIcon type={h.type} className="mt-0.5 size-5 shrink-0 text-text-secondary" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{h.title}</p>
                      <Badge variant="secondary">{humanResourceType(h.type)}</Badge>
                    </div>
                    {h.snippet ? <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary [&_mark]:rounded [&_mark]:bg-warning/40 [&_mark]:px-0.5" dangerouslySetInnerHTML={{ __html: h.snippet }} /> : null}
                  </div>
                  <span className="shrink-0 text-xs text-text-muted">{formatDate(h.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchContent />
    </Suspense>
  );
}
