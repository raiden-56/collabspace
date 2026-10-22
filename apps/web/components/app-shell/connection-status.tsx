"use client";

import { Wifi, WifiOff, RefreshCw, CloudOff, Cloud, CloudCog } from "lucide-react";
import { useConnectionStatus } from "@/lib/realtime";
import type { SyncStatus } from "@/lib/yjs";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

export function ConnectionStatus({ className }: { className?: string }) {
  const status = useConnectionStatus();
  const meta = {
    connected: { icon: Wifi, label: "Live · realtime connected", color: "text-success" },
    connecting: { icon: RefreshCw, label: "Connecting to realtime service…", color: "text-warning animate-spin" },
    disconnected: { icon: WifiOff, label: "Reconnecting… changes are kept locally", color: "text-warning" },
    offline: { icon: WifiOff, label: "You are offline. Supported edits are saved locally and sync when you reconnect.", color: "text-error" },
  }[status];
  const Icon = meta.icon;
  return (
    <Tooltip content={meta.label}>
      <div className={cn("flex size-8 items-center justify-center rounded-md", className)} role="status" aria-live="polite" aria-label={meta.label}>
        <Icon className={cn("size-4", meta.color)} />
      </div>
    </Tooltip>
  );
}

/** Sync indicator for a specific collaborative document (Yjs provider status). */
export function DocSyncStatus({ status, synced, pendingLocal }: { status: SyncStatus; synced: boolean; pendingLocal?: boolean }) {
  const m =
    status === "offline"
      ? { icon: CloudOff, label: "Offline — edits saved on this device", cls: "text-error bg-error-soft" }
      : status === "disconnected"
        ? { icon: CloudCog, label: "Reconnecting — edits saved on this device", cls: "text-warning bg-warning-soft" }
        : status === "connecting" || !synced
          ? { icon: RefreshCw, label: "Syncing…", cls: "text-text-secondary bg-surface-2 [&_svg]:animate-spin" }
          : { icon: Cloud, label: pendingLocal ? "Saving…" : "All changes saved", cls: "text-success bg-success-soft" };
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium", m.cls)} role="status" aria-live="polite">
      <Icon className="size-3.5" />
      <span className="hidden sm:inline">{m.label}</span>
    </span>
  );
}
