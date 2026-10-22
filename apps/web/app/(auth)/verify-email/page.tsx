"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { post, errorMessage } from "@/lib/api";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/skeleton";

function Verify() {
  const params = useSearchParams();
  const token = params.get("token");
  const qc = useQueryClient();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("This verification link is missing its token.");
      return;
    }
    post("/auth/verify-email", { token })
      .then(() => {
        setState("ok");
        void qc.invalidateQueries({ queryKey: ["me"] });
      })
      .catch((err) => {
        setState("error");
        setError(errorMessage(err));
      });
  }, [token, qc]);

  if (state === "loading")
    return (
      <AuthCard title="Verifying your email…">
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </AuthCard>
    );
  if (state === "ok")
    return (
      <AuthCard title="Email verified" description="Thanks! Your email address is confirmed.">
        <Button asChild className="w-full">
          <Link href="/app">Continue to CollabSpace</Link>
        </Button>
      </AuthCard>
    );
  return (
    <AuthCard title="Verification failed" description={error}>
      <Button asChild variant="outline" className="w-full">
        <Link href="/app/settings">Resend from settings</Link>
      </Button>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
