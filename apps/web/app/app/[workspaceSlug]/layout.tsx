"use client";

import Link from "next/link";
import { useApp } from "@/components/app-shell/workspace-context";
import { Spinner, EmptyState } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/queries";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { workspaceSlug } = useApp();
  const ws = useWorkspace(workspaceSlug);
  if (ws.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (ws.isError) {
    return (
      <div className="mx-auto max-w-lg p-10">
        <EmptyState title="Workspace not available" description="You might not be a member of this workspace, or it no longer exists." action={<Button asChild><Link href="/app">Back to home</Link></Button>} />
      </div>
    );
  }
  return <>{children}</>;
}
