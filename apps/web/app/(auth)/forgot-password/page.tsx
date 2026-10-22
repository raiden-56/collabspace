"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { post, errorMessage } from "@/lib/api";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const schema = z.object({ email: z.string().email("Enter a valid email") });

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<{ devResetToken?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await post<{ devResetToken?: string | null }>("/auth/forgot-password", values);
      setSent(res);
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  if (sent) {
    return (
      <AuthCard title="Check your inbox" description="If an account exists for that email, we sent a link to reset your password. The link expires in one hour.">
        {sent.devResetToken ? (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
            Development mode: email delivery is logged, not sent.{" "}
            <Link href={`/reset-password?token=${sent.devResetToken}`} className="font-medium underline">
              Open the reset link
            </Link>
            .
          </p>
        ) : null}
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send you a reset link."
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus placeholder="you@company.com" {...form.register("email")} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}
