"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { ApiError, get } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, Spinner } from "@/components/ui/skeleton";
import { Eye, LogIn, MessageSquare, PenLine } from "lucide-react";
import { AppProvider } from "@/components/app-shell/workspace-context";
import { CreateDialogsProvider } from "@/components/app-shell/create-dialogs";

const CanvasEditor = dynamic(() => import("@/components/canvas/canvas-editor").then((m) => m.CanvasEditor), { ssr: false, loading: () => <div className="flex h-full items-center justify-center"><Spinner /></div> });
const DocumentEditor = dynamic(() => import("@/components/editor/document-editor").then((m) => m.DocumentEditor), { ssr: false, loading: () => <div className="flex h-full items-center justify-center"><Spinner /></div> });

interface Shared {
  resourceType: string;
  resourceId: string;
  title: string;
  level: "VIEWER" | "COMMENTER" | "EDITOR";
  workspace: { slug: string; name: string } | null;
  expiresAt: string | null;
  requireLogin: boolean;
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <AppProvider>
      <CreateDialogsProvider>
        <ShareContent token={token} />
      </CreateDialogsProvider>
    </AppProvider>
  );
}

function ShareContent({ token }: { token: string }) {
  const router = useRouter();
  const me = useMe();
  const shared = useQuery<Shared>({ queryKey: ["shared", token], queryFn: () => get(`/shared/${token}`, undefined, { silent401: true }), retry: false });
  const err = shared.error as ApiError | null;
  const loginRequired = err?.status === 401;

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-3">
          <Logo compact />
          {shared.data ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{shared.data.title}</span>
              <Badge variant="secondary" className="gap-1">
                {shared.data.level === "EDITOR" ? <PenLine className="size-3" /> : shared.data.level === "COMMENTER" ? <MessageSquare className="size-3" /> : <Eye className="size-3" />}
                Shared · {shared.data.level.toLowerCase()}
              </Badge>
              {shared.data.workspace ? <span className="hidden text-xs text-text-muted sm:inline">from {shared.data.workspace.name}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          {me.data ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/app">Open app</Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href={`/login?next=${encodeURIComponent(`/share/${token}`)}`}>
                <LogIn /> Sign in
              </Link>
            </Button>
          )}
        </div>
      </header>
      <main className="min-h-0 flex-1">
        {shared.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : loginRequired ? (
          <Center title="Sign in to view" description="The owner of this link requires viewers to be signed in.">
            <Button onClick={() => router.push(`/login?next=${encodeURIComponent(`/share/${token}`)}`)}>Sign in</Button>
          </Center>
        ) : shared.isError || !shared.data ? (
          <Center title="This link is no longer available" description="The share link may have expired or been revoked by its owner." />
        ) : shared.data.resourceType === "CANVAS" ? (
          <CanvasEditor canvasId={shared.data.resourceId} shareToken={token} readOnly={shared.data.level === "VIEWER"} />
        ) : shared.data.resourceType === "DOCUMENT" ? (
          <DocumentEditor documentId={shared.data.resourceId} shareToken={token} readOnly={shared.data.level === "VIEWER"} />
        ) : (
          <Center title={shared.data.title} description="This resource type can be opened inside the app.">
            {shared.data.workspace ? (
              <Button asChild>
                <Link href={`/app/${shared.data.workspace.slug}`}>Open workspace</Link>
              </Button>
            ) : null}
          </Center>
        )}
      </main>
    </div>
  );
}

function Center({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="mt-2 text-sm text-text-secondary">{description}</p> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </Card>
    </div>
  );
}
