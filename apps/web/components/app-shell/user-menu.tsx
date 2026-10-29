"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Settings, Shield, User, Keyboard, LayoutGrid } from "lucide-react";
import { post } from "@/lib/api";
import { realtime } from "@/lib/realtime";
import { endGuestSession } from "@/lib/guest/session";
import { useUiStore } from "@/lib/stores/ui-store";
import { useApp } from "./workspace-context";
import { UserAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/overlays";

export function UserMenu() {
  const { user } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  if (!user) return null;

  const logout = async () => {
    await post("/auth/logout").catch(() => {});
    realtime.disable();
    endGuestSession();
    qc.clear();
    router.replace("/login");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full p-0.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
          <UserAvatar user={user} size="md" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <div className="flex items-center gap-2.5 py-1">
            <UserAvatar user={user} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text">{user.name}</p>
              <p className="truncate text-xs font-normal text-text-muted">{user.email}</p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <User /> Profile & settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/workspaces">
            <LayoutGrid /> Workspaces
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setShortcutsOpen(true)} shortcut="?">
          <Keyboard /> Keyboard shortcuts
        </DropdownMenuItem>
        {user.platformRole === "ADMIN" ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield /> Platform admin
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings#preferences">
            <Settings /> Preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout()} destructive>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
