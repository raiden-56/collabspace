"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ServerEvent, ClientEvent } from "@collabspace/shared";
import { GUEST_MODE_ENABLED, isGuestSession } from "./guest/session";

/**
 * Application-level realtime client (JSON events over one WebSocket), separate from Yjs rooms.
 * Features: auto reconnect with backoff, re-subscribe after reconnect, ref-counted channel
 * subscriptions, heartbeat, connection status store, typed event bus.
 */

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "offline";

type Listener = (event: ServerEvent) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private statusListeners = new Set<() => void>();
  private listeners = new Map<string, Set<Listener>>(); // channel → listeners
  private globalListeners = new Set<Listener>();
  private refCounts = new Map<string, number>();
  private backoff = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private enabled = false;
  private presence = new Map<string, Record<string, unknown>>();

  get url(): string {
    const base = process.env.NEXT_PUBLIC_WS_URL ?? (typeof location !== "undefined" ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:4101` : "ws://localhost:4101");
    return `${base.replace(/\/$/, "")}/events`;
  }

  enable() {
    if (this.enabled) return;
    // Guest mode has no realtime server to connect to.
    if (GUEST_MODE_ENABLED && isGuestSession()) return;
    this.enabled = true;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
    this.connect();
  }

  disable() {
    this.enabled = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus("disconnected");
  }

  private onOnline = () => {
    this.backoff = 500;
    this.connect();
  };
  private onOffline = () => {
    this.setStatus("offline");
    this.ws?.close();
  };

  private connect() {
    if (!this.enabled || typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (!navigator.onLine) {
      this.setStatus("offline");
      return;
    }
    this.setStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 500;
      this.setStatus("connected");
      for (const channel of this.refCounts.keys()) this.send({ t: "subscribe", p: { channel } });
      for (const [channel, state] of this.presence) this.send({ t: "presence:update", p: { channel, state } });
      this.heartbeat = setInterval(() => this.send({ t: "ping", p: { ts: Date.now() } }), 25_000);
    };
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as ServerEvent;
        this.dispatch(event);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.ws = null;
      this.setStatus(navigator.onLine ? "disconnected" : "offline");
      if (this.enabled) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoff = Math.min(this.backoff * 1.8, 15_000);
      this.connect();
    }, this.backoff + Math.random() * 300);
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const l of this.statusListeners) l();
  }

  getStatus = () => this.status;
  subscribeStatus = (fn: () => void) => {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  };

  send(ev: ClientEvent) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(ev));
  }

  private dispatch(event: ServerEvent) {
    for (const l of this.globalListeners) l(event);
    const channel = channelOf(event);
    if (channel) for (const l of this.listeners.get(channel) ?? []) l(event);
    else for (const set of this.listeners.values()) for (const l of set) l(event);
  }

  /** Subscribe to a channel; returns an unsubscribe function. */
  subscribe(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel);
    if (!set) this.listeners.set(channel, (set = new Set()));
    set.add(listener);
    const count = (this.refCounts.get(channel) ?? 0) + 1;
    this.refCounts.set(channel, count);
    if (count === 1) this.send({ t: "subscribe", p: { channel } });
    return () => {
      set!.delete(listener);
      const c = (this.refCounts.get(channel) ?? 1) - 1;
      if (c <= 0) {
        this.refCounts.delete(channel);
        this.listeners.delete(channel);
        this.presence.delete(channel);
        this.send({ t: "unsubscribe", p: { channel } });
      } else this.refCounts.set(channel, c);
    };
  }

  onAny(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  updatePresence(channel: string, state: Record<string, unknown>) {
    this.presence.set(channel, state);
    this.send({ t: "presence:update", p: { channel, state } });
  }

  typing(channelId: string, threadId?: string) {
    this.send({ t: "typing", p: { channelId, threadId } });
  }
}

function channelOf(event: ServerEvent): string | null {
  switch (event.t) {
    case "presence:update":
    case "presence:leave":
    case "room:joined":
    case "room:left":
      return event.p.channel;
    case "chat:message":
    case "chat:typing":
    case "chat:reaction":
      return `chat:${event.p.channelId}`;
    case "error":
      return event.p.channel ?? null;
    default:
      return null;
  }
}

export const realtime = new RealtimeClient();

export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(realtime.subscribeStatus, realtime.getStatus, () => "connecting");
}

/** Subscribe to a channel for the lifetime of the component. */
export function useRealtime(channel: string | null | undefined, handler: (event: ServerEvent) => void, deps: unknown[] = []) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!channel) return;
    return realtime.subscribe(channel, (e) => ref.current(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, ...deps]);
}

export interface PresenceEntry {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  color: string;
  state?: Record<string, unknown>;
  connections: number;
}

/** Who is viewing a resource (lightweight presence, independent from Yjs awareness). */
export function usePresence(channel: string | null | undefined, state: Record<string, unknown> | null = { status: "viewing" }): PresenceEntry[] {
  const [users, setUsers] = useState<PresenceEntry[]>([]);
  const stateKey = JSON.stringify(state);
  useEffect(() => {
    if (!channel) return;
    const unsub = realtime.subscribe(channel, (e) => {
      if (e.t === "presence:update" && e.p.channel === channel) setUsers(e.p.users as PresenceEntry[]);
      if (e.t === "room:joined" && e.p.channel === channel && state) realtime.updatePresence(channel, state);
    });
    if (state && realtime.getStatus() === "connected") realtime.updatePresence(channel, state);
    return () => {
      unsub();
      setUsers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, stateKey]);
  return users;
}
