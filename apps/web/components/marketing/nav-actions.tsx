"use client";

import Link from "next/link";
import { useMe } from "@/lib/queries";
import { Button } from "@/components/ui/button";

export function MarketingNavActions() {
  const me = useMe();
  if (me.data) {
    return (
      <Button asChild size="sm">
        <Link href="/app">Open workspace</Link>
      </Button>
    );
  }
  return (
    <>
      <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
        <Link href="/login">Sign in</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/register">Start collaborating</Link>
      </Button>
    </>
  );
}
