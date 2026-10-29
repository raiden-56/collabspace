"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppProvider, useApp } from "@/components/app-shell/workspace-context";
import { CreateDialogsProvider } from "@/components/app-shell/create-dialogs";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { CommandPalette } from "@/components/app-shell/command-palette";
import { ShortcutsDialog } from "@/components/app-shell/shortcuts-dialog";
import { AssistantPanel } from "@/components/ai/assistant-panel";
import { useUiStore } from "@/lib/stores/ui-store";
import { useMediaQuery } from "@/lib/hooks/use-debounce";
import { Spinner } from "@/components/ui/skeleton";
import { Dialog, SheetContent } from "@/components/ui/overlays";
import { GUEST_MODE_ENABLED } from "@/lib/guest/session";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <CreateDialogsProvider>
        <Shell>{children}</Shell>
        <CommandPalette />
        <ShortcutsDialog />
      </CreateDialogsProvider>
    </AppProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { me, isLoading } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const assistantOpen = useUiStore((s) => s.assistantOpen);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [mobileNav, setMobileNav] = useState(false);
  const isOnboarding = pathname === "/app/onboarding";

  useEffect(() => {
    if (me && !me.user.onboardingDone && me.workspaces.length === 0 && !isOnboarding) router.replace("/app/onboarding");
  }, [me, isOnboarding, router]);

  useEffect(() => setMobileNav(false), [pathname]);

  // Builds with guest mode may have no backend (static export) to answer with a 401, so send
  // visitors without a session to the login page, where they can continue as a guest.
  useEffect(() => {
    if (GUEST_MODE_ENABLED && !isLoading && !me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, me, pathname, router]);

  if (isLoading && !me) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!me) return null;

  if (isOnboarding) return <div className="min-h-dvh bg-bg">{children}</div>;

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-text">
      {isMobile ? (
        <Dialog open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
            <Sidebar />
          </SheetContent>
        </Dialog>
      ) : (
        <Sidebar />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={isMobile ? () => setMobileNav(true) : undefined} />
        <div className="flex min-h-0 flex-1">
          <main id="main" className="relative min-w-0 flex-1 overflow-auto scrollbar-thin">
            {children}
          </main>
          {assistantOpen ? <AssistantPanel /> : null}
        </div>
      </div>
    </div>
  );
}
