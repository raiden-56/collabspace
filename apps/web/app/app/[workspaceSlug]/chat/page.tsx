"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useHeader } from "@/lib/stores/header-store";
import { ChatView } from "@/components/chat/chat-view";

function ChatContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useHeader({ title: "Team chat" });
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return <ChatView channelId={params.get("channel")} threadId={params.get("thread")} messageId={params.get("message")} onSelectChannel={(id) => set({ channel: id, thread: null, message: null })} onSelectThread={(id) => set({ thread: id })} />;
}

export default function ChatPage() {
  return (
    <Suspense>
      <ChatContent />
    </Suspense>
  );
}
