"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Activity, ArrowLeft, Building2, Shield, Users } from "lucide-react";
import { useMe } from "@/lib/queries";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/admin", label: "Overview", icon: Shield, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/admin/audit-logs", label: "Audit logs", icon: Activity },
  { href: "/admin/system", label: "System", icon: Activity },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (me.data && me.data.user.platformRole !== "ADMIN") router.replace("/app");
  }, [me.data, router]);
  if (me.isLoading)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  if (!me.data || me.data.user.platformRole !== "ADMIN") return null;
  return (
    <div className="flex h-dvh bg-bg text-text">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Logo href="/admin" compact />
          <span className="text-sm font-semibold">Platform admin</span>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {nav.map((n) => {
            const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium", active ? "bg-primary-soft text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text")}>
                <n.icon className="size-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-2">
          <Button asChild variant="ghost" size="sm" className="w-full justify-start">
            <Link href="/app">
              <ArrowLeft /> Back to app
            </Link>
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
          <p className="text-sm text-text-secondary">
            Signed in as <span className="font-medium text-text">{me.data.user.email}</span>
          </p>
          <ThemeToggle compact />
        </header>
        <main className="flex-1 overflow-auto p-6 scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
