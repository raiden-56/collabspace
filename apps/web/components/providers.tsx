"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { useRouter, usePathname } from "next/navigation";
import { setUnauthorizedHandler, ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (pathname?.startsWith("/app") || pathname?.startsWith("/admin")) {
        client.clear();
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [client, pathname, router]);

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster richColors position="bottom-right" closeButton toastOptions={{ classNames: { toast: "!rounded-lg !border !border-border !bg-surface !text-text !shadow-md" } }} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
