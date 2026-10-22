import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { WebSocket } from "ws";
import { loadDoc, appendUpdate, compact, maybeAutoVersion, type CollabType } from "@collabspace/db/collab";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { getRedis } from "./redis.js";
import type { AuthedUser } from "./auth.js";
import type { EffectiveAccess } from "@collabspace/shared";
import { accessAtLeast } from "@collabspace/shared";

/**
 * Yjs rooms. One room per collaborative resource (canvas:<id> / document:<id>).
 * Wire protocol: standard y-protocols binary frames (messageSync=0, messageAwareness=1), compatible
 * with y-websocket's WebsocketProvider on the client.
 *
 * Authorization is enforced per connection:
 *  - VIEWER/COMMENTER connections receive sync + awareness but their document updates are dropped
 *    (and the server re-sends the authoritative state so the client converges back).
 *  - EDITOR/OWNER connections may write.
 *
 * Persistence: every accepted update is appended to the DB (batched per room); rooms compact on unload.
 * Cross-instance: with Redis, updates and awareness are relayed via pub/sub so multiple sync
 * instances share rooms.
 */

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface RoomConn {
  ws: WebSocket;
  user: AuthedUser | null;
  access: EffectiveAccess;
  canWrite: boolean;
  controlledIds: Set<number>;
  alive: boolean;
}

export class Room {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly conns = new Set<RoomConn>();
  private pending: Uint8Array[] = [];
  private pendingAuthor: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastAutoVersionCheck = 0;
  private readonly redisChannel: string;
  loaded: Promise<void>;
  destroyed = false;

  constructor(
    readonly type: CollabType,
    readonly id: string,
    private readonly onEmpty: (room: Room) => void,
  ) {
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.redisChannel = `collabspace:yjs:${type}:${id}`;
    this.loaded = this.load();
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
    rooms.set(this.key, this);
  }

  get key(): string {
    return `${this.type}:${this.id}`;
  }

  private async load(): Promise<void> {
    const persisted = await loadDoc(this.type, this.id);
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(persisted), "load");
    persisted.destroy();
    const redis = getRedis();
    if (redis) {
      const sub = redis.duplicate({ lazyConnect: false, enableOfflineQueue: true, maxRetriesPerRequest: null });
      await sub.subscribe(this.redisChannel).catch((err) => logger.warn({ err }, "redis subscribe failed"));
      sub.on("messageBuffer", (_ch: Buffer, msg: Buffer) => {
        // Messages from other instances: [kind(1 byte)][payload]
        const kind = msg[0];
        const payload = new Uint8Array(msg.subarray(1));
        if (kind === MESSAGE_SYNC) Y.applyUpdate(this.doc, payload, "remote");
        else if (kind === MESSAGE_AWARENESS) awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, "remote");
      });
      this.redisSub = sub;
    }
  }
  private redisSub: import("ioredis").Redis | null = null;

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Broadcast to local connections
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const frame = encoding.toUint8Array(encoder);
    for (const c of this.conns) if (c.ws !== origin) send(c, frame);
    if (origin === "load") return;
    // Persist (unless it came from another instance which already persisted it)
    if (origin !== "remote") {
      this.pending.push(update);
      if (origin && typeof origin === "object" && "user" in (origin as RoomConn)) this.pendingAuthor = (origin as RoomConn).user?.userId ?? null;
      this.scheduleFlush();
      const redis = getRedis();
      if (redis) redis.publish(this.redisChannel, Buffer.concat([Buffer.from([MESSAGE_SYNC]), Buffer.from(update)])).catch(() => {});
    }
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = [...added, ...updated, ...removed];
    if (origin && typeof origin === "object" && "controlledIds" in (origin as RoomConn)) {
      const conn = origin as RoomConn;
      for (const id of added) conn.controlledIds.add(id);
      for (const id of removed) conn.controlledIds.delete(id);
    }
    const payload = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    const frame = encoding.toUint8Array(encoder);
    for (const c of this.conns) send(c, frame);
    if (origin !== "remote") {
      const redis = getRedis();
      if (redis) redis.publish(this.redisChannel, Buffer.concat([Buffer.from([MESSAGE_AWARENESS]), Buffer.from(payload)])).catch(() => {});
    }
  };

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), config.persistDebounceMs);
  }

  async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.pending.length === 0) return;
    const merged = this.pending.length === 1 ? this.pending[0]! : Y.mergeUpdates(this.pending);
    const author = this.pendingAuthor;
    this.pending = [];
    try {
      await appendUpdate(this.type, this.id, merged, author);
      if (Date.now() - this.lastAutoVersionCheck > 60_000) {
        this.lastAutoVersionCheck = Date.now();
        await maybeAutoVersion(this.type, this.id, this.doc, author);
      }
    } catch (err) {
      logger.error({ err, room: this.key }, "failed to persist yjs update — re-queueing");
      this.pending.unshift(merged);
      setTimeout(() => this.scheduleFlush(), 2000);
    }
  }

  async join(conn: RoomConn): Promise<void> {
    await this.loaded;
    if (this.destroyed) return;
    this.conns.add(conn);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    // Step 1: send our state vector so the client replies with missing updates, then send full state.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    send(conn, encoding.toUint8Array(enc));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      send(conn, encoding.toUint8Array(aw));
    }
  }

  leave(conn: RoomConn): void {
    this.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.controlledIds], null);
    if (this.conns.size === 0) {
      this.idleTimer = setTimeout(() => void this.unload(), config.roomIdleMs);
    }
  }

  handleMessage(conn: RoomConn, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncType = decoding.peekVarUint(decoder);
        const isWrite = syncType === syncProtocol.messageYjsUpdate || syncType === syncProtocol.messageYjsSyncStep2;
        if (isWrite && !conn.canWrite) {
          // Drop the write, then push the authoritative state back so the read-only client converges.
          decoding.readVarUint(decoder);
          const resync = encoding.createEncoder();
          encoding.writeVarUint(resync, MESSAGE_SYNC);
          syncProtocol.writeSyncStep2(resync, this.doc);
          send(conn, encoding.toUint8Array(resync));
          return;
        }
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);
        if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
        break;
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn);
        break;
      }
      default:
        logger.debug({ type }, "unknown yjs message type");
    }
  }

  /** Apply an update produced elsewhere (e.g. version restore through the API). */
  applyExternal(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, "external");
  }

  async unload(): Promise<void> {
    if (this.destroyed) return;
    if (this.conns.size > 0) return;
    this.destroyed = true;
    rooms.delete(this.key);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flush();
    try {
      await compact(this.type, this.id);
    } catch (err) {
      logger.warn({ err, room: this.key }, "compact on unload failed");
    }
    this.redisSub?.disconnect();
    this.awareness.destroy();
    this.doc.destroy();
    this.onEmpty(this);
    logger.debug({ room: this.key }, "room unloaded");
  }
}

export const rooms = new Map<string, Room>();

export function getOrCreateRoom(type: CollabType, id: string): Room {
  const key = `${type}:${id}`;
  const existing = rooms.get(key);
  if (existing && !existing.destroyed) return existing;
  return new Room(type, id, () => {});
}

export function send(conn: RoomConn, data: Uint8Array | string): void {
  if (conn.ws.readyState !== conn.ws.OPEN) return;
  conn.ws.send(data, (err) => {
    if (err) logger.debug({ err: err.message }, "ws send failed");
  });
}

export function makeConn(ws: WebSocket, user: AuthedUser | null, access: EffectiveAccess): RoomConn {
  return { ws, user, access, canWrite: accessAtLeast(access, "EDITOR"), controlledIds: new Set(), alive: true };
}

export async function flushAllRooms(): Promise<void> {
  await Promise.all([...rooms.values()].map((r) => r.flush()));
}
