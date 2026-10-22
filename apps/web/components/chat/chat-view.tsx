"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Lock, MessageSquare, Paperclip, Plus, Search, Users, X, SmilePlus, Pencil, Trash2, CornerDownRight, Bell, BellOff, ExternalLink } from "lucide-react";
import { get, post, patch, del, uploadFile, errorMessage, type ChannelDto, type MessageDto } from "@/lib/api";
import { useChannels, useMembers, useProjects } from "@/lib/queries";
import { realtime, useRealtime } from "@/lib/realtime";
import { useApp } from "@/components/app-shell/workspace-context";
import { MentionComposer, MentionText } from "@/components/comments/comment-thread";
import { resourceHref } from "@/components/shared/resource-link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/controls";
import { UserAvatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Spinner, EmptyState } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Popover, PopoverContent, PopoverTrigger, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip } from "@/components/ui/overlays";
import { formatDate, timeAgo, cn, formatBytes } from "@/lib/utils";

const EMOJIS = ["👍", "❤️", "🎉", "😂", "👀", "✅", "🙏", "🚀"];

interface Page {
  items: MessageDto[];
  hasMore: boolean;
}

export function ChatView({ channelId, threadId, messageId, onSelectChannel, onSelectThread }: { channelId: string | null; threadId: string | null; messageId: string | null; onSelectChannel: (id: string | null) => void; onSelectThread: (id: string | null) => void }) {
  const { workspace, workspaceSlug, user, isGuest } = useApp();
  const channels = useChannels(workspace?.id);
  const [newOpen, setNewOpen] = useState<"channel" | "dm" | null>(null);
  const [q, setQ] = useState("");
  const list = (channels.data ?? []).filter((c) => !q || (c.name ?? c.members.map((m) => m.user.name).join(" ")).toLowerCase().includes(q.toLowerCase()));
  const groups = { channels: list.filter((c) => c.type === "PUBLIC" || c.type === "PRIVATE"), projects: list.filter((c) => c.type === "PROJECT"), resources: list.filter((c) => c.type === "RESOURCE"), direct: list.filter((c) => c.type === "DIRECT" || c.type === "GROUP") };
  const current = channels.data?.find((c) => c.id === channelId) ?? null;

  useEffect(() => {
    if (!channelId && channels.data?.length) onSelectChannel(channels.data.find((c) => c.name === "general")?.id ?? channels.data[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.data, channelId]);

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a conversation" className="h-8 pl-7 text-xs" aria-label="Find a conversation" />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="New conversation"><Plus /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!isGuest ? <DropdownMenuItem onSelect={() => setNewOpen("channel")}><Hash /> New channel</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={() => setNewOpen("dm")}><MessageSquare /> New direct message</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 scrollbar-thin" aria-label="Conversations">
          <ChannelGroup title="Channels" items={groups.channels} current={channelId} onSelect={onSelectChannel} userId={user?.id} />
          <ChannelGroup title="Projects" items={groups.projects} current={channelId} onSelect={onSelectChannel} userId={user?.id} />
          <ChannelGroup title="Discussions" items={groups.resources} current={channelId} onSelect={onSelectChannel} userId={user?.id} />
          <ChannelGroup title="Direct messages" items={groups.direct} current={channelId} onSelect={onSelectChannel} userId={user?.id} />
          {channels.data?.length === 0 ? <p className="p-3 text-xs text-text-secondary">No conversations yet.</p> : null}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1">
        {current ? <ChannelPane key={current.id} channel={current} threadId={threadId} highlightMessageId={messageId} onSelectThread={onSelectThread} /> : channels.isLoading ? <div className="flex flex-1 items-center justify-center"><Spinner /></div> : <div className="flex flex-1 items-center justify-center p-8"><EmptyState icon={<MessageSquare />} title="Pick a conversation" description="Channels, project discussions and direct messages appear on the left." /></div>}
      </div>
      {newOpen ? <NewConversationDialog kind={newOpen} onClose={() => setNewOpen(null)} onCreated={(id) => { onSelectChannel(id); setNewOpen(null); }} /> : null}
      <span className="sr-only">{workspaceSlug}</span>
    </div>
  );
}

function ChannelGroup({ title, items, current, onSelect, userId }: { title: string; items: ChannelDto[]; current: string | null; onSelect: (id: string) => void; userId?: string }) {
  if (!items.length) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">{title}</p>
      <ul className="space-y-0.5">
        {items.map((c) => {
          const others = c.members.filter((m) => m.userId !== userId);
          const name = c.type === "DIRECT" ? others[0]?.user.name ?? "You" : c.type === "GROUP" ? others.map((m) => m.user.name.split(" ")[0]).join(", ") : c.name ?? c.resource?.title ?? "Conversation";
          return (
            <li key={c.id}>
              <button onClick={() => onSelect(c.id)} aria-current={current === c.id ? "page" : undefined} className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm", current === c.id ? "bg-primary-soft text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text")}>
                {c.type === "DIRECT" ? <UserAvatar user={others[0]?.user ?? null} size="xs" /> : c.type === "PRIVATE" ? <Lock className="size-3.5" /> : c.type === "GROUP" ? <Users className="size-3.5" /> : c.type === "RESOURCE" ? <MessageSquare className="size-3.5" /> : <Hash className="size-3.5" />}
                <span className={cn("min-w-0 flex-1 truncate", c.unread ? "font-semibold text-text" : "")}>{name}</span>
                {c.unread ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white">{c.unread}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChannelPane({ channel, threadId, highlightMessageId, onSelectThread }: { channel: ChannelDto; threadId: string | null; highlightMessageId: string | null; onSelectThread: (id: string | null) => void }) {
  const { user, workspaceSlug, workspace, canManage } = useApp();
  const qc = useQueryClient();
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const others = channel.members.filter((m) => m.userId !== user?.id);
  const title = channel.type === "DIRECT" ? others[0]?.user.name ?? "You" : channel.type === "GROUP" ? others.map((m) => m.user.name).join(", ") : channel.name ?? channel.resource?.title ?? "Conversation";
  const muted = channel.members.find((m) => m.userId === user?.id)?.muted;
  const join = useMutation({ mutationFn: () => post(`/channels/${channel.id}/join`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["channels"] }) });
  const mute = useMutation({ mutationFn: (m: boolean) => patch(`/channels/${channel.id}`, { muted: m }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["channels"] }) });

  useEffect(() => {
    void post(`/channels/${channel.id}/read`).then(() => qc.invalidateQueries({ queryKey: ["channels"] })).catch(() => {});
  }, [channel.id, qc]);

  useRealtime(`chat:${channel.id}`, (ev) => {
    if (ev.t === "chat:message") {
      void qc.invalidateQueries({ queryKey: ["messages", channel.id] });
      void qc.invalidateQueries({ queryKey: ["channels"] });
      void post(`/channels/${channel.id}/read`).catch(() => {});
    } else if (ev.t === "chat:reaction") void qc.invalidateQueries({ queryKey: ["messages", channel.id] });
    else if (ev.t === "chat:typing" && ev.p.user.userId !== user?.id) {
      setTyping((t) => ({ ...t, [ev.p.user.userId]: { name: ev.p.user.name, at: Date.now() } }));
    }
  });
  useEffect(() => {
    const t = setInterval(() => setTyping((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => Date.now() - v.at < 3000))), 1000);
    return () => clearInterval(t);
  }, []);
  const typingNames = Object.values(typing).map((t) => t.name);

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          {channel.type === "DIRECT" ? <UserAvatar user={others[0]?.user ?? null} size="sm" /> : channel.type === "PRIVATE" ? <Lock className="size-4 text-text-muted" /> : <Hash className="size-4 text-text-muted" />}
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {channel.topic ? <span className="hidden truncate text-xs text-text-muted md:inline">· {channel.topic}</span> : null}
          {channel.resourceType && channel.resourceId && workspaceSlug ? (
            <Button asChild variant="ghost" size="xs">
              <Link href={resourceHref(workspaceSlug, channel.resourceType, channel.resourceId)}><ExternalLink /> Open {channel.resourceType.toLowerCase()}</Link>
            </Button>
          ) : null}
          {channel.project && workspaceSlug ? (
            <Button asChild variant="ghost" size="xs">
              <Link href={`/app/${workspaceSlug}/projects/${channel.project.id}`}><ExternalLink /> Project</Link>
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Tooltip content={`${channel.members.length} members`}>
              <div><AvatarStack users={channel.members.map((m) => m.user)} size="xs" max={4} /></div>
            </Tooltip>
            {channel.isMember ? (
              <Tooltip content={muted ? "Unmute notifications" : "Mute notifications"}>
                <Button variant="ghost" size="icon-xs" aria-label="Toggle mute" onClick={() => mute.mutate(!muted)}>{muted ? <BellOff /> : <Bell />}</Button>
              </Tooltip>
            ) : null}
            {(channel.type === "PUBLIC" || channel.type === "PRIVATE" || channel.type === "GROUP") && (channel.isMember || canManage) ? <AddMembersButton channel={channel} /> : null}
          </div>
        </div>
        <MessageList channelId={channel.id} threadId={null} highlightMessageId={highlightMessageId} onOpenThread={onSelectThread} canPost={channel.isMember} />
        <div className="shrink-0 border-t border-border p-3">
          {typingNames.length ? <p className="mb-1 text-[11px] text-text-muted">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…</p> : null}
          {channel.isMember ? (
            <Composer channelId={channel.id} parentId={null} workspaceId={workspace!.id} placeholder={`Message ${channel.type === "DIRECT" ? title : `#${title}`}`} />
          ) : (
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="text-text-secondary">You are viewing this channel.</span>
              <Button size="sm" onClick={() => join.mutate()} loading={join.isPending}>Join channel</Button>
            </div>
          )}
        </div>
      </div>
      {threadId ? <ThreadPane channelId={channel.id} parentId={threadId} canPost={channel.isMember} onClose={() => onSelectThread(null)} /> : null}
    </>
  );
}

function MessageList({ channelId, threadId, highlightMessageId, onOpenThread, canPost }: { channelId: string; threadId: string | null; highlightMessageId: string | null; onOpenThread: (id: string) => void; canPost: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const q = useInfiniteQuery<Page>({
    queryKey: ["messages", channelId, threadId],
    queryFn: ({ pageParam }) => get(`/channels/${channelId}/messages`, { before: pageParam as string | undefined, threadId: threadId ?? undefined, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
  });
  const messages = useMemo(() => [...(q.data?.pages ?? [])].reverse().flatMap((p) => p.items), [q.data]);
  const [stick, setStick] = useState(true);
  useEffect(() => {
    if (stick) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, stick]);
  useEffect(() => {
    if (highlightMessageId) document.getElementById(`msg-${highlightMessageId}`)?.scrollIntoView({ block: "center" });
  }, [highlightMessageId, messages.length]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-4 py-3 scrollbar-thin"
      onScroll={(e) => {
        const el = e.currentTarget;
        setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
        if (el.scrollTop < 80 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
      }}
    >
      {q.hasNextPage ? <div className="mb-2 flex justify-center"><Button variant="ghost" size="xs" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load earlier messages</Button></div> : null}
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
      {!q.isLoading && messages.length === 0 ? <p className="py-10 text-center text-sm text-text-secondary">{threadId ? "No replies yet." : "No messages yet. Say hello!"}</p> : null}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const grouped = prev && prev.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
        return (
          <div key={m.id}>
            {newDay ? <div className="my-3 flex items-center gap-3 text-[11px] text-text-muted"><span className="h-px flex-1 bg-border" />{formatDate(m.createdAt)}<span className="h-px flex-1 bg-border" /></div> : null}
            <MessageRow message={m} grouped={Boolean(grouped) && !newDay} highlighted={m.id === highlightMessageId} onOpenThread={threadId ? undefined : () => onOpenThread(m.id)} canReact={canPost} channelId={channelId} />
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageRow({ message: m, grouped, highlighted, onOpenThread, canReact, channelId }: { message: MessageDto; grouped: boolean; highlighted: boolean; onOpenThread?: () => void; canReact: boolean; channelId: string }) {
  const { user } = useApp();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(m.body);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["messages", channelId] });
  const react = useMutation({ mutationFn: (emoji: string) => post(`/messages/${m.id}/reactions`, { emoji }), onSuccess: refresh });
  const edit = useMutation({ mutationFn: () => patch(`/messages/${m.id}`, { body }), onSuccess: () => { setEditing(false); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => del(`/messages/${m.id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const isOwn = m.authorId === user?.id;
  const attachments = (m.attachments ?? []) as Array<{ fileId: string; name: string; mimeType: string; sizeBytes: number }>;
  return (
    <div id={`msg-${m.id}`} className={cn("group relative flex gap-3 rounded-md px-2 py-1 hover:bg-surface-2/60", grouped ? "mt-0.5" : "mt-3", highlighted && "bg-warning-soft", m.pending && "opacity-60")}>
      <div className="w-8 shrink-0">{!grouped ? <UserAvatar user={m.author} size="md" /> : <span className="hidden text-[10px] text-text-muted group-hover:block">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div>
      <div className="min-w-0 flex-1">
        {!grouped ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{m.author.name}</span>
            <span className="text-[11px] text-text-muted">{formatDate(m.createdAt, true)}</span>
            {m.editedAt ? <span className="text-[11px] text-text-muted">(edited)</span> : null}
          </div>
        ) : null}
        {m.deletedAt ? (
          <p className="text-sm italic text-text-muted">This message was deleted.</p>
        ) : editing ? (
          <div className="mt-1">
            <MentionComposer compact value={body} onChange={setBody} onSubmit={() => edit.mutate()} submitLabel="Save" />
            <button className="mt-1 text-xs text-text-muted hover:text-text" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <MentionText body={m.body} className="text-sm leading-relaxed" />
        )}
        {attachments.length ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {attachments.map((a) => (
              a.mimeType.startsWith("image/") ? (
                <a key={a.fileId} href={`/api/v1/files/${a.fileId}/download`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border">
                  <img src={`/api/v1/files/${a.fileId}/download`} alt={a.name} className="max-h-60 max-w-xs object-contain" loading="lazy" />
                </a>
              ) : (
                <a key={a.fileId} href={`/api/v1/files/${a.fileId}/download?download=1`} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs hover:bg-surface-2">
                  <Paperclip className="size-3.5 text-text-muted" /> <span className="max-w-[200px] truncate">{a.name}</span> <span className="text-text-muted">{formatBytes(a.sizeBytes)}</span>
                </a>
              )
            ))}
          </div>
        ) : null}
        {m.reactions.length || (m.replyCount && onOpenThread) ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {m.reactions.map((r) => (
              <button key={r.emoji} disabled={!canReact} onClick={() => react.mutate(r.emoji)} aria-pressed={r.userIds.includes(user?.id ?? "")} className={cn("flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs", r.userIds.includes(user?.id ?? "") ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2")}>
                {r.emoji} {r.count}
              </button>
            ))}
            {m.replyCount && onOpenThread ? (
              <button onClick={onOpenThread} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary-soft">
                <CornerDownRight className="size-3" /> {m.replyCount} {m.replyCount === 1 ? "reply" : "replies"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {!m.deletedAt && !m.pending ? (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-md border border-border bg-surface p-0.5 shadow-sm group-hover:flex">
          {canReact ? (
            <Popover>
              <PopoverTrigger asChild>
                <button className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text" aria-label="Add reaction"><SmilePlus className="size-3.5" /></button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-1.5" align="end">
                <div className="flex gap-1">{EMOJIS.map((e) => <button key={e} onClick={() => react.mutate(e)} className="rounded p-1 text-base hover:bg-surface-2" aria-label={`React ${e}`}>{e}</button>)}</div>
              </PopoverContent>
            </Popover>
          ) : null}
          {onOpenThread && canReact ? <button onClick={onOpenThread} className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text" aria-label="Reply in thread"><CornerDownRight className="size-3.5" /></button> : null}
          <button onClick={() => { void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?channel=${channelId}&message=${m.id}`); toast.success("Message link copied"); }} className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text" aria-label="Copy link"><ExternalLink className="size-3.5" /></button>
          {isOwn ? (
            <>
              <button onClick={() => setEditing(true)} className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text" aria-label="Edit"><Pencil className="size-3.5" /></button>
              <button onClick={() => remove.mutate()} className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-error" aria-label="Delete"><Trash2 className="size-3.5" /></button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Composer({ channelId, parentId, workspaceId, placeholder }: { channelId: string; parentId: string | null; workspaceId: string; placeholder: string }) {
  const qc = useQueryClient();
  const { user } = useApp();
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<Array<{ fileId: string; name: string; mimeType: string; sizeBytes: number }>>([]);
  const [uploading, setUploading] = useState(false);
  const lastTyping = useRef(0);
  const send = useMutation({
    mutationFn: (body: string) => post<MessageDto>(`/channels/${channelId}/messages`, { body, parentId, attachments: files.length ? files : undefined, clientId: `${Date.now()}` }),
    onMutate: (body) => {
      const key = ["messages", channelId, parentId];
      const optimistic: MessageDto = { id: `tmp-${Date.now()}`, channelId, authorId: user!.id, author: { id: user!.id, name: user!.name, avatarUrl: user!.avatarUrl, color: user!.color }, parentId, body, attachments: files, mentions: [], editedAt: null, deletedAt: null, replyCount: 0, createdAt: new Date().toISOString(), reactions: [], pending: true };
      qc.setQueryData<{ pages: Page[]; pageParams: unknown[] }>(key, (old) => (old ? { ...old, pages: old.pages.map((p, i) => (i === 0 ? { ...p, items: [...p.items, optimistic] } : p)) } : old));
      setValue("");
      setFiles([]);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["messages", channelId] });
      void qc.invalidateQueries({ queryKey: ["channels"] });
    },
    onError: (e, body) => {
      toast.error(errorMessage(e));
      setValue(body);
      void qc.invalidateQueries({ queryKey: ["messages", channelId] });
    },
  });
  const onUpload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        const asset = await uploadFile(f, { workspaceId, resourceType: "CHANNEL", resourceId: channelId });
        setFiles((x) => [...x, { fileId: asset.id, name: asset.name, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes }]);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };
  return (
    <div>
      {files.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span key={f.fileId} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
              <Paperclip className="size-3" /> {f.name}
              <button onClick={() => setFiles((x) => x.filter((y) => y.fileId !== f.fileId))} aria-label="Remove attachment"><X className="size-3" /></button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <label className={cn("flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-text-secondary hover:bg-surface-2", uploading && "opacity-50")} aria-label="Attach file">
          {uploading ? <Spinner className="size-4" /> : <Paperclip className="size-4" />}
          <input type="file" multiple className="sr-only" disabled={uploading} onChange={(e) => { void onUpload(e.target.files); e.target.value = ""; }} />
        </label>
        <div className="flex-1">
          <MentionComposer
            compact
            value={value}
            onChange={setValue}
            placeholder={placeholder}
            submitLabel="Send"
            onSubmit={() => (value.trim() || files.length) && !uploading && send.mutate(value.trim() || "(attachment)")}
            onTyping={() => {
              const now = Date.now();
              if (now - lastTyping.current > 2000) {
                lastTyping.current = now;
                realtime.typing(channelId, parentId ?? undefined);
              }
            }}
          />
        </div>
      </div>
      <p className="mt-1 text-[10px] text-text-muted">Enter to send · Shift+Enter for a new line · @ to mention</p>
    </div>
  );
}

function ThreadPane({ channelId, parentId, canPost, onClose }: { channelId: string; parentId: string; canPost: boolean; onClose: () => void }) {
  const { workspace } = useApp();
  const parent = useQuery<Page>({ queryKey: ["messages", channelId, "parent", parentId], queryFn: () => get(`/channels/${channelId}/messages`, { after: undefined, limit: 1, threadId: undefined }), enabled: false });
  const root = useQuery<MessageDto | null>({
    queryKey: ["message", parentId],
    queryFn: async () => {
      const page = await get<Page>(`/channels/${channelId}/messages`, { limit: 100 });
      return page.items.find((m) => m.id === parentId) ?? null;
    },
  });
  void parent;
  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex h-12 items-center justify-between border-b border-border px-3">
        <h3 className="text-sm font-semibold">Thread</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close thread"><X /></Button>
      </div>
      {root.data ? (
        <div className="border-b border-border px-2 py-2">
          <MessageRow message={root.data} grouped={false} highlighted={false} canReact={canPost} channelId={channelId} />
        </div>
      ) : null}
      <MessageList channelId={channelId} threadId={parentId} highlightMessageId={null} onOpenThread={() => {}} canPost={canPost} />
      {canPost ? <div className="border-t border-border p-3"><Composer channelId={channelId} parentId={parentId} workspaceId={workspace!.id} placeholder="Reply…" /></div> : null}
    </aside>
  );
}

function AddMembersButton({ channel }: { channel: ChannelDto }) {
  const { workspace } = useApp();
  const qc = useQueryClient();
  const members = useMembers(workspace?.id);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const candidates = (members.data ?? []).filter((m) => !channel.members.some((x) => x.userId === m.user.id));
  const add = useMutation({ mutationFn: () => post(`/channels/${channel.id}/members`, { userIds: picked }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["channels"] }); setOpen(false); setPicked([]); toast.success("Members added"); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <>
      <Tooltip content="Add members"><Button variant="ghost" size="icon-xs" aria-label="Add members" onClick={() => setOpen(true)}><Users /></Button></Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Add members</DialogTitle></DialogHeader>
          <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
            {candidates.map((m) => (
              <button key={m.user.id} onClick={() => setPicked((p) => (p.includes(m.user.id) ? p.filter((x) => x !== m.user.id) : [...p, m.user.id]))} aria-pressed={picked.includes(m.user.id)} className={cn("rounded-full border px-2.5 py-1 text-xs", picked.includes(m.user.id) ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>{m.user.name}</button>
            ))}
            {candidates.length === 0 ? <p className="text-sm text-text-secondary">Everyone is already here.</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!picked.length} loading={add.isPending} onClick={() => add.mutate()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewConversationDialog({ kind, onClose, onCreated }: { kind: "channel" | "dm"; onClose: () => void; onCreated: (id: string) => void }) {
  const { workspace, user } = useApp();
  const qc = useQueryClient();
  const members = useMembers(workspace?.id);
  const projects = useProjects(workspace?.id);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => post<ChannelDto>("/channels", kind === "dm" ? { workspaceId: workspace!.id, type: picked.length > 1 ? "GROUP" : "DIRECT", memberIds: picked } : { workspaceId: workspace!.id, type: projectId ? "PROJECT" : isPrivate ? "PRIVATE" : "PUBLIC", name: name.trim(), topic: topic || undefined, memberIds: picked, projectId: projectId || undefined }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["channels"] });
      onCreated(c.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const candidates = (members.data ?? []).filter((m) => m.user.id !== user?.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "dm" ? "New direct message" : "New channel"}</DialogTitle>
          <DialogDescription>{kind === "dm" ? "Pick one person for a direct message or several for a group." : "Channels keep team-wide or topic discussions organized."}</DialogDescription>
        </DialogHeader>
        {kind === "channel" ? (
          <div className="space-y-3">
            <Field label="Name" htmlFor="ch-name"><Input id="ch-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="design-reviews" /></Field>
            <Field label="Topic" htmlFor="ch-topic"><Input id="ch-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What is this channel about?" /></Field>
            <Field label="Attach to project (optional)"><SimpleSelect value={projectId || "none"} onChange={(v) => setProjectId(v === "none" ? "" : v)} options={[{ value: "none", label: "No project" }, ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> Private — only invited members can see it</label>
          </div>
        ) : null}
        <Field label={kind === "dm" ? "People" : "Invite members"}>
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {candidates.map((m) => (
              <button key={m.user.id} type="button" onClick={() => setPicked((p) => (p.includes(m.user.id) ? p.filter((x) => x !== m.user.id) : [...p, m.user.id]))} aria-pressed={picked.includes(m.user.id)} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", picked.includes(m.user.id) ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-surface-2")}>
                <UserAvatar user={m.user} size="xs" /> {m.user.name}
              </button>
            ))}
            {candidates.length === 0 ? <p className="text-sm text-text-secondary">Invite teammates to the workspace first.</p> : null}
          </div>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={kind === "dm" ? picked.length === 0 : !name.trim()} loading={create.isPending} onClick={() => create.mutate()}>{kind === "dm" ? "Start conversation" : "Create channel"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { Badge };
