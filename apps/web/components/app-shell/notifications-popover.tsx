"use client";

import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNotifications, mutations } from "@/lib/queries";
import { timeAgo, cn } from "@/lib/utils";
import type { NotificationDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import { UserAvatar } from "@/components/ui/avatar";

export const NOTIFICATION_ICONS: Record<string, string> = {
  MENTION: "@",
  COMMENT: "💬",
  COMMENT_REPLY: "↩",
  TASK_ASSIGNED: "✓",
  TASK_DUE: "⏰",
  TASK_STATUS: "→",
  MEETING_INVITE: "📅",
  MEETING_SUMMARY: "✨",
  SHARE_ACCESS: "🔗",
  WORKSPACE_INVITE: "👋",
  PROJECT_UPDATE: "📁",
  CHAT_MESSAGE: "💬",
  AUTOMATION: "⚡",
  SYSTEM: "ℹ",
};

export function NotificationItem({ n, compact, onOpen }: { n: NotificationDto; compact?: boolean; onOpen?: () => void }) {
  const qc = useQueryClient();
  const markRead = async () => {
    if (!n.readAt) {
      await mutations.markRead(n.id, true).catch(() => {});
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    onOpen?.();
  };
  const inner = (
    <div className={cn("flex gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-2", !n.readAt && "bg-primary-soft/40")}>
      <div className="relative shrink-0">
        {n.actor ? <UserAvatar user={n.actor} size="md" /> : <div className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-sm">{NOTIFICATION_ICONS[n.type] ?? "•"}</div>}
        {n.actor ? <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-surface text-[9px] ring-1 ring-border">{NOTIFICATION_ICONS[n.type] ?? "•"}</span> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug", !n.readAt ? "font-medium text-text" : "text-text-secondary")}>{n.title}</p>
        {n.body && !compact ? <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{n.body}</p> : null}
        <p className="mt-1 text-[11px] text-text-muted">
          {timeAgo(n.createdAt)}
          {n.workspace ? ` · ${n.workspace.name}` : ""}
        </p>
      </div>
      {!n.readAt ? <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
    </div>
  );
  return n.href ? (
    <Link href={n.href} onClick={() => void markRead()} className="block">
      {inner}
    </Link>
  ) : (
    <button onClick={() => void markRead()} className="block w-full text-left">
      {inner}
    </button>
  );
}

export function NotificationsPopover() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const unread = data?.unread ?? 0;
  const items = data?.items.slice(0, 8) ?? [];
  return (
    <Popover>
      <Tooltip content="Notifications">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell />
            {unread > 0 ? <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span> : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Notifications</h3>
          <div className="flex items-center gap-1">
            {unread > 0 ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  await mutations.readAll();
                  void qc.invalidateQueries({ queryKey: ["notifications"] });
                }}
              >
                <CheckCheck /> Mark all read
              </Button>
            ) : null}
            <Button asChild variant="ghost" size="xs">
              <Link href="/app/inbox">View all</Link>
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1.5 scrollbar-thin">
          {items.length === 0 ? <p className="px-4 py-10 text-center text-sm text-text-secondary">You&apos;re all caught up.</p> : items.map((n) => <NotificationItem key={n.id} n={n} compact />)}
        </div>
      </PopoverContent>
    </Popover>
  );
}
