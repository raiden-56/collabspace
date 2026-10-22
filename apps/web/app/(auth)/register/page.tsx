"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { post, errorMessage } from "@/lib/api";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().trim().min(1, "Tell us your name").max(80),
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), "Use letters and numbers"),
});
type Form = z.infer<typeof schema>;

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const inviteToken = params.get("invite") ?? undefined;
  const presetEmail = params.get("email") ?? "";
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { name: "", email: presetEmail, password: "" } });
  const password = form.watch("password");
  const strength = [password.length >= 10, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await post<{ joinedWorkspace: { slug: string } | null }>("/auth/register", { ...values, inviteToken }, { silent401: true });
      qc.clear();
      if (res.joinedWorkspace) router.replace(`/app/${res.joinedWorkspace.slug}`);
      else router.replace("/app/onboarding");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  return (
    <AuthCard
      title="Create your account"
      description={inviteToken ? "Finish signing up to join the workspace you were invited to." : "Start collaborating in minutes. No credit card required."}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Full name" htmlFor="name" error={form.formState.errors.name?.message}>
          <Input id="name" autoComplete="name" autoFocus placeholder="Alex Rivera" {...form.register("name")} />
        </Field>
        <Field label="Work email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" readOnly={Boolean(presetEmail && inviteToken)} {...form.register("email")} />
        </Field>
        <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message} hint="At least 10 characters with letters and numbers.">
          <Input id="password" type="password" autoComplete="new-password" placeholder="Create a strong password" {...form.register("password")} />
          <div className="mt-2 flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < strength ? (strength >= 3 ? "bg-success" : "bg-warning") : "bg-surface-3"}`} />
            ))}
          </div>
        </Field>
        {error ? (
          <p role="alert" className="rounded-md bg-error-soft px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-xs text-text-muted">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthCard>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
