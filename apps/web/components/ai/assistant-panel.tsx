"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Send, X, Check, XCircle, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { get, post, errorMessage } from "@/lib/api";
import { useAiStatus } from "@/lib/queries";
import { useUiStore } from "@/lib/stores/ui-store";
import { useHeaderStore } from "@/lib/stores/header-store";
import { useApp } from "@/components/app-shell/workspace-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedActions?: Array<{ id: string; type: string; status: string; payload: { title: string; projectId: string }; resultTaskId?: string }> | null;
  sources?: string[] | null;
  createdAt: string;
}

const SUGGESTIONS = ["What should we work on next?", "Summarize this", "Which tasks are overdue?", "Draft a status report for this project", "Turn these notes into a task breakdown"];

export function AssistantPanel() {
  const { workspace } = useApp();
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const width = useUiStore((s) => s.rightPanelWidth);
  const resource = useHeaderStore((s) => s.resource);
  const pathname = usePathname();
  const qc = useQueryClient();
  const ai = useAiStatus();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [optimistic, setOptimistic] = useState<Message[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversation = useQuery<{ messages: Message[] }>({ queryKey: ["ai-conversation", conversationId], queryFn: () => get(`/ai/conversations/${conversationId}`), enabled: Boolean(conversationId) });
  const messages = [...(conversation.data?.messages ?? []), ...optimistic];

  const chat = useMutation({
    mutationFn: (message: string) =>
      post<{ conversationId: string; message: Message }>("/ai/chat", {
        workspaceId: workspace!.id,
        conversationId: conversationId ?? undefined,
        message,
        context: resource && ["CANVAS", "DOCUMENT", "MEETING", "PROJECT"].includes(resource.type) ? { resourceType: resource.type, resourceId: resource.id } : undefined,
      }),
    onMutate: (message) => setOptimistic([{ id: `tmp-${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString() }]),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setOptimistic([]);
      void qc.invalidateQueries({ queryKey: ["ai-conversation", res.conversationId] });
    },
    onError: (err) => {
      setOptimistic([]);
      toast.error(errorMessage(err));
    },
  });

  const confirm = useMutation({
    mutationFn: (input: { messageId: string; actionId: string; approve: boolean }) => post("/ai/confirm", input),
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: ["ai-conversation", conversationId] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(input.approve ? "Task created" : "Suggestion dismissed");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, chat.isPending]);

  // New conversation when moving between resources
  useEffect(() => {
    setConversationId(null);
    setOptimistic([]);
  }, [pathname]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || chat.isPending || !workspace) return;
    setInput("");
    chat.mutate(t);
  };

  if (!workspace) return null;

  return (
    <aside className="flex h-full shrink-0 flex-col border-l border-border bg-surface" style={{ width }} aria-label="AI assistant">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-secondary" /> Assistant
          {ai.data ? (
            <Tooltip content={ai.data.dataSentToProvider}>
              <Badge variant={ai.data.enabled ? (ai.data.provider === "mock" ? "warning" : "violet") : "error"} className="cursor-help">
                {ai.data.enabled ? ai.data.provider : "disabled"}
              </Badge>
            </Tooltip>
          ) : null}
        </div>
        <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)} aria-label="Close assistant">
          <X />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-2 p-3 text-sm text-text-secondary">
              <p>
                I can summarize, find overdue work, suggest next steps and draft tasks using the content you have access to{resource ? ` — currently focused on this ${resource.type.toLowerCase()}` : ""}. I&apos;ll always ask before creating anything.
              </p>
              {ai.data?.provider === "mock" ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs">
                  <Info className="mt-0.5 size-3.5 shrink-0" /> The offline mock provider is active. Configure AI_PROVIDER=anthropic on the server for full answers.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary hover:border-primary hover:text-text">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[92%] rounded-xl px-3 py-2 text-sm", m.role === "user" ? "bg-primary text-white" : "bg-surface-2 text-text")}>
                <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                {m.role === "assistant" && m.sources?.length ? <p className="mt-2 text-[11px] text-text-muted">Based on: {m.sources.slice(0, 5).join(", ")}</p> : null}
                {m.proposedActions?.length ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Proposed actions — confirm to apply</p>
                    {m.proposedActions.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface p-2">
                        <span className="truncate text-xs">
                          Create task: <span className="font-medium">{a.payload.title}</span>
                        </span>
                        {a.status === "proposed" ? (
                          <div className="flex shrink-0 gap-1">
                            <Button size="icon-xs" variant="subtle" aria-label="Approve" onClick={() => confirm.mutate({ messageId: m.id, actionId: a.id, approve: true })}>
                              <Check />
                            </Button>
                            <Button size="icon-xs" variant="ghost" aria-label="Reject" onClick={() => confirm.mutate({ messageId: m.id, actionId: a.id, approve: false })}>
                              <XCircle />
                            </Button>
                          </div>
                        ) : (
                          <Badge variant={a.status === "done" ? "success" : "secondary"}>{a.status}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {chat.isPending ? (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>
      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder={ai.data?.enabled === false ? "AI is disabled on this server" : "Ask about your workspace…"}
            disabled={ai.data?.enabled === false}
            className="min-h-[44px] resize-none"
            aria-label="Message the assistant"
          />
          <Button type="submit" size="icon" disabled={!input.trim() || chat.isPending || ai.data?.enabled === false} aria-label="Send">
            <Send />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-text-muted">The assistant only sees content you can access and never changes records without your confirmation.</p>
      </form>
    </aside>
  );
}
