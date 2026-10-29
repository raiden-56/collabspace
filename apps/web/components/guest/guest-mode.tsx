"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, UserRound } from "lucide-react";
import { GUEST_WORKSPACE_SLUG } from "@/lib/guest/ids";
import { GUEST_MODE_ENABLED, startGuestSession } from "@/lib/guest/session";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";

/** "Continue as guest" on the login page; only rendered in builds with NEXT_PUBLIC_GUEST_MODE=true. */
export function ContinueAsGuest({ next }: { next?: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  if (!GUEST_MODE_ENABLED) return null;
  const start = () => {
    startGuestSession();
    qc.clear();
    router.replace(next && next.startsWith("/app") ? next : `/app/${GUEST_WORKSPACE_SLUG}`);
  };
  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="subtle" size="lg" className="w-full" onClick={start}>
        <UserRound /> Continue as guest
      </Button>
      <p className="text-center text-xs text-text-secondary">Explore a demo workspace with sample data — no account needed. Changes stay in this browser tab.</p>
    </div>
  );
}

/** Persistent reminder in the app shell that the guest is looking at sample data. */
export function GuestModeChip() {
  return (
    <Tooltip content="You're exploring a demo workspace in guest mode. Everything runs in your browser and resets when you reload or close the tab. Sign out to leave guest mode.">
      <span role="status" className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-warning-soft px-2.5 text-[11px] font-medium text-warning">
        <FlaskConical className="size-3.5" />
        <span>Guest mode</span>
        <span className="hidden xl:inline">– sample data, changes aren&apos;t saved</span>
      </span>
    </Tooltip>
  );
}
