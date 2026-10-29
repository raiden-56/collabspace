"use client";

import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import { GUEST_MODE_ENABLED, isGuestSession } from "./guest/session";

/**
 * Collaborative document connection = Yjs doc + authenticated WebSocket provider + IndexedDB cache.
 *  - The session cookie authenticates the WebSocket upgrade (same cookie as the API).
 *  - IndexedDB keeps a local copy so the resource opens instantly and edits made while offline are
 *    stored as pending Yjs updates and synced when the connection returns.
 *  - Awareness carries presence/cursors (transient, never persisted).
 */

export type SyncStatus = "connecting" | "connected" | "disconnected" | "offline";

export interface CollabConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  persistence: IndexeddbPersistence | null;
  destroy: () => void;
}

export function wsBase(): string {
  const base = process.env.NEXT_PUBLIC_WS_URL ?? (typeof location !== "undefined" ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:4101` : "ws://localhost:4101");
  return base.replace(/\/$/, "");
}

export function createCollabConnection(type: "canvas" | "document", id: string, opts: { shareToken?: string | null; user?: { userId: string; name: string; color: string; avatarUrl?: string | null } | null; offlineCache?: boolean } = {}): CollabConnection {
  const doc = new Y.Doc({ gc: true });
  const room = `${type}:${id}`;
  const params: Record<string, string> = {};
  if (opts.shareToken) params.share = opts.shareToken;
  const provider = new WebsocketProvider(`${wsBase()}/yjs`, room, doc, { params, connect: true, maxBackoffTime: 10_000, disableBc: true });
  if (opts.user) provider.awareness.setLocalStateField("user", { ...opts.user });
  let persistence: IndexeddbPersistence | null = null;
  if (opts.offlineCache !== false && typeof indexedDB !== "undefined") {
    try {
      persistence = new IndexeddbPersistence(`collabspace:${room}`, doc);
    } catch {
      persistence = null; // quota / private mode — continue online-only
    }
  }
  return {
    doc,
    provider,
    awareness: provider.awareness,
    persistence,
    destroy: () => {
      provider.awareness.setLocalState(null);
      provider.destroy();
      persistence?.destroy().catch(() => {});
      doc.destroy();
    },
  };
}

export interface UseCollabResult {
  conn: CollabConnection | null;
  status: SyncStatus;
  synced: boolean;
  /** true once the local IndexedDB copy was loaded (content available even offline) */
  localReady: boolean;
}

export function useCollab(type: "canvas" | "document", id: string | null | undefined, opts: { shareToken?: string | null; user?: { userId: string; name: string; color: string; avatarUrl?: string | null } | null; enabled?: boolean } = {}): UseCollabResult {
  const [conn, setConn] = useState<CollabConnection | null>(null);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const userKey = opts.user ? `${opts.user.userId}:${opts.user.name}:${opts.user.color}` : "anon";
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!id || !enabled) return;
    if (GUEST_MODE_ENABLED && isGuestSession()) {
      // Guest mode: local document seeded from sample data, no sync server.
      let c: CollabConnection | null = null;
      let cancelled = false;
      void import("./guest/collab").then((m) => {
        if (cancelled) return;
        c = m.createGuestCollabConnection(type, id, opts.user);
        setConn(c);
        setStatus("connected");
        setSynced(true);
        setLocalReady(true);
      });
      return () => {
        cancelled = true;
        c?.destroy();
        setConn(null);
      };
    }
    const c = createCollabConnection(type, id, { shareToken: opts.shareToken, user: opts.user });
    setConn(c);
    setSynced(false);
    setLocalReady(false);
    const onStatus = ({ status }: { status: string }) => {
      setStatus(status === "connected" ? "connected" : status === "connecting" ? "connecting" : navigator.onLine ? "disconnected" : "offline");
    };
    const onSync = (isSynced: boolean) => setSynced(isSynced);
    c.provider.on("status", onStatus);
    c.provider.on("sync", onSync);
    c.persistence?.whenSynced.then(() => setLocalReady(true)).catch(() => setLocalReady(true));
    if (!c.persistence) setLocalReady(true);
    // React to browser connectivity changes immediately instead of waiting for the dead-socket timeout.
    // Edits made while disconnected stay in the Y.Doc (and IndexedDB) and are sent during the resync.
    const onOffline = () => {
      setStatus("offline");
      c.provider.disconnect();
    };
    const onOnline = () => {
      setStatus("connecting");
      c.provider.connect();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      c.provider.off("status", onStatus);
      c.provider.off("sync", onSync);
      c.destroy();
      setConn(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id, opts.shareToken, userKey, enabled]);

  return useMemo(() => ({ conn, status, synced, localReady }), [conn, status, synced, localReady]);
}

export interface AwarenessUser {
  clientId: number;
  user: { userId: string; name: string; color: string; avatarUrl?: string | null };
  cursor?: { x: number; y: number } | null;
  selection?: string[];
  [key: string]: unknown;
}

/** Live awareness states (other clients only). */
export function useAwareness(awareness: Awareness | null | undefined): AwarenessUser[] {
  const [states, setStates] = useState<AwarenessUser[]>([]);
  useEffect(() => {
    if (!awareness) return;
    const update = () => {
      const out: AwarenessUser[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        if (!state?.user) return;
        out.push({ clientId, ...(state as Omit<AwarenessUser, "clientId">) } as AwarenessUser);
      });
      setStates(out);
    };
    update();
    awareness.on("change", update);
    return () => {
      awareness.off("change", update);
    };
  }, [awareness]);
  return states;
}

/** Subscribe to a Y type and re-render on change with a derived value. */
export function useYObserver<T>(target: Y.AbstractType<unknown> | null | undefined, select: () => T, deps: unknown[] = []): T {
  const [value, setValue] = useState<T>(select);
  useEffect(() => {
    if (!target) return;
    setValue(select());
    const handler = () => setValue(select());
    target.observeDeep(handler);
    return () => target.unobserveDeep(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ...deps]);
  return value;
}
