"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, Spinner } from "@/components/ui/skeleton";

interface InvitePreview {
  email: string;
  role: string;
  workspace: { id: string; name: string; slug: string; logoUrl: string | null };
  invitedBy: string;
  expired: boolean;
  status: string;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const invite = useQuery<InvitePreview>({ queryKey: ["invite", token], queryFn: () => get(`/invitations/${token}`), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const res = await post<{ workspace: { slug: string } }>(`/invitations/${token}/accept`);
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace(`/app/${res.workspace.slug}`);
    } catch (err) {
      setError(errorMessage(err));
      setAccepting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <Card className="w-full max-w-md p-8 text-center shadow-lg">
          {invite.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : invite.isError || !invite.data ? (
            <>
              <h1 className="text-xl font-semibold">Invitation not found</h1>
              <p className="mt-2 text-sm text-text-secondary">This invitation link is invalid or has been revoked.</p>
              <Button asChild className="mt-6">
                <Link href="/">Go home</Link>
              </Button>
            </>
          ) : invite.data.expired ? (
            <>
              <h1 className="text-xl font-semibold">This invitation has expired</h1>
              <p className="mt-2 text-sm text-text-secondary">Ask {invite.data.invitedBy} to send you a new invitation to {invite.data.workspace.name}.</p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-2xl font-bold text-primary">{invite.data.workspace.name.slice(0, 1).toUpperCase()}</div>
              <h1 className="text-xl font-semibold">Join {invite.data.workspace.name}</h1>
              <p className="mt-2 text-sm text-text-secondary">
                {invite.data.invitedBy} invited <span className="font-medium text-text">{invite.data.email}</span> to join as {invite.data.role.toLowerCase()}.
              </p>
              {error ? <p className="mt-4 rounded-md bg-error-soft px-3 py-2 text-sm text-error">{error}</p> : null}
              <div className="mt-6 space-y-2">
                {me.data ? (
                  me.data.user.email.toLowerCase() === invite.data.email.toLowerCase() ? (
                    <Button className="w-full" onClick={accept} loading={accepting}>
                      Accept invitation
                    </Button>
                  ) : (
                    <>
                      <p className="text-xs text-text-muted">
                        You are signed in as {me.data.user.email}. Sign in with {invite.data.email} to accept.
                      </p>
                      <Button asChild variant="outline" className="w-full">
                        <Link href={`/login?switch=1&next=${encodeURIComponent(`/invite/${token}`)}`}>Switch account</Link>
                      </Button>
                    </>
                  )
                ) : (
                  <>
                    <Button asChild className="w-full">
                      <Link href={`/register?invite=${token}&email=${encodeURIComponent(invite.data.email)}`}>Create account & join</Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full">
                      <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>I already have an account</Link>
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
