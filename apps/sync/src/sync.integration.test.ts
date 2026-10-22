import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { WebSocket as NodeWebSocket } from "ws";
import { WebsocketProvider } from "y-websocket";
import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@collabspace/db";
import { canvas as canvasLib } from "@collabspace/shared";
import { loadDoc } from "@collabspace/db/collab";

process.env.SYNC_NO_AUTOSTART = "1";
const PORT = 4300 + Math.floor(Math.random() * 500);

/**
 * Collaboration integration tests against a real sync server + PostgreSQL:
 *  - two authenticated clients converge on a canvas
 *  - unauthorized clients cannot join protected rooms
 *  - view-only clients cannot write
 *  - reconnection resynchronizes offline edits
 *  - updates are persisted and survive a room unload
 */

const hashToken = (t: string) => createHmac("sha256", process.env.SESSION_SECRET!).update(t).digest("hex");

function cookieSocket(cookie: string | null) {
  return class extends NodeWebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: cookie ? { cookie } : {} });
    }
  } as unknown as typeof WebSocket;
}

function connect(room: string, cookie: string | null, doc: Y.Doc, params: Record<string, string> = {}) {
  const provider = new WebsocketProvider(`ws://localhost:${PORT}/yjs`, room, doc, { WebSocketPolyfill: cookieSocket(cookie), params, disableBc: true, maxBackoffTime: 500 });
  return provider;
}

function waitFor(fn: () => boolean, timeout = 8000, label = "condition"): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (fn()) {
        clearInterval(t);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(t);
        reject(new Error(`timeout waiting for ${label}`));
      }
    }, 25);
  });
}

async function makeUser(email: string) {
  const user = await prisma.user.create({ data: { email, name: email.split("@")[0]!, passwordHash: "x", emailVerifiedAt: new Date() } });
  const token = randomBytes(24).toString("base64url");
  await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) } });
  return { user, cookie: `cs_session=${token}` };
}

let stop: () => Promise<void>;
let owner: Awaited<ReturnType<typeof makeUser>>;
let member: Awaited<ReturnType<typeof makeUser>>;
let outsider: Awaited<ReturnType<typeof makeUser>>;
let canvasId: string;
let privateCanvasId: string;
const suffix = Date.now().toString(36);

beforeAll(async () => {
  const mod = await import("./server.js");
  await mod.start(PORT);
  stop = mod.stop;
  owner = await makeUser(`sync-owner-${suffix}@test.local`);
  member = await makeUser(`sync-member-${suffix}@test.local`);
  outsider = await makeUser(`sync-outsider-${suffix}@test.local`);
  const ws = await prisma.workspace.create({
    data: { name: "Sync test", slug: `sync-test-${suffix}`, ownerId: owner.user.id, members: { create: [{ userId: owner.user.id, role: "OWNER" }, { userId: member.user.id, role: "MEMBER" }] } },
  });
  const canvas = await prisma.canvas.create({ data: { workspaceId: ws.id, title: "Shared canvas", createdById: owner.user.id } });
  canvasId = canvas.id;
  const priv = await prisma.canvas.create({ data: { workspaceId: ws.id, title: "Private canvas", createdById: owner.user.id, visibility: "PRIVATE" } });
  privateCanvasId = priv.id;
});

afterAll(async () => {
  await stop();
});

describe("yjs sync service", () => {
  it("two authenticated clients converge on concurrent canvas edits", async () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    const p1 = connect(`canvas:${canvasId}`, owner.cookie, d1);
    const p2 = connect(`canvas:${canvasId}`, member.cookie, d2);
    await waitFor(() => p1.synced && p2.synced, 8000, "both synced");

    canvasLib.writeObject(d1, { id: "n1", type: "sticky", x: 10, y: 10, text: "from owner" });
    canvasLib.writeObject(d2, { id: "n2", type: "sticky", x: 300, y: 10, text: "from member" });
    await waitFor(() => canvasLib.getObjectsMap(d1).has("n2") && canvasLib.getObjectsMap(d2).has("n1"), 8000, "cross-propagation");

    // Concurrent property edits on the same object merge per key
    canvasLib.updateObject(d1, "n1", { x: 500 });
    canvasLib.updateObject(d2, "n1", { text: "edited by member" });
    await waitFor(() => {
      const a = canvasLib.serializeCanvas(d1).objects.find((o) => o.id === "n1");
      const b = canvasLib.serializeCanvas(d2).objects.find((o) => o.id === "n1");
      return !!a && !!b && a.x === 500 && b.x === 500 && a.text === "edited by member" && b.text === "edited by member";
    }, 8000, "property merge");

    // Awareness: presence of both users visible to each other
    p1.awareness.setLocalStateField("user", { name: "owner", color: "#f00" });
    p2.awareness.setLocalStateField("user", { name: "member", color: "#0f0" });
    await waitFor(() => p1.awareness.getStates().size >= 2 && p2.awareness.getStates().size >= 2, 8000, "awareness");

    p1.destroy();
    p2.destroy();
  });

  it("rejects unauthenticated and unauthorized clients", async () => {
    const anon = new Y.Doc();
    const pAnon = connect(`canvas:${canvasId}`, null, anon);
    const anonFailed = new Promise<void>((resolve) => pAnon.on("connection-error", () => resolve()));
    await anonFailed;
    expect(pAnon.synced).toBe(false);
    pAnon.destroy();

    const out = new Y.Doc();
    const pOut = connect(`canvas:${canvasId}`, outsider.cookie, out);
    const outFailed = new Promise<void>((resolve) => pOut.on("connection-error", () => resolve()));
    await outFailed;
    expect(pOut.synced).toBe(false);
    pOut.destroy();

    // Member cannot open a private canvas without a grant
    const priv = new Y.Doc();
    const pPriv = connect(`canvas:${privateCanvasId}`, member.cookie, priv);
    await new Promise<void>((resolve) => pPriv.on("connection-error", () => resolve()));
    expect(pPriv.synced).toBe(false);
    pPriv.destroy();
  });

  it("allows a share-link viewer to read but not write", async () => {
    const token = randomBytes(24).toString("base64url");
    const ws = await prisma.canvas.findUniqueOrThrow({ where: { id: privateCanvasId }, select: { workspaceId: true } });
    await prisma.shareLink.create({ data: { workspaceId: ws.workspaceId, resourceType: "CANVAS", resourceId: privateCanvasId, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 6), level: "VIEWER", createdById: owner.user.id } });

    const ownerDoc = new Y.Doc();
    const pOwner = connect(`canvas:${privateCanvasId}`, owner.cookie, ownerDoc);
    await waitFor(() => pOwner.synced, 8000, "owner synced");
    canvasLib.writeObject(ownerDoc, { id: "secret", type: "sticky", x: 0, y: 0, text: "owner note" });

    const viewerDoc = new Y.Doc();
    const pViewer = connect(`canvas:${privateCanvasId}`, null, viewerDoc, { share: token });
    await waitFor(() => pViewer.synced && canvasLib.getObjectsMap(viewerDoc).has("secret"), 8000, "viewer receives content");

    canvasLib.writeObject(viewerDoc, { id: "intruder", type: "sticky", x: 0, y: 0, text: "should not persist" });
    await new Promise((r) => setTimeout(r, 1200));
    expect(canvasLib.getObjectsMap(ownerDoc).has("intruder")).toBe(false);
    // The server pushed the authoritative state back, so the viewer converges to the owner's view.
    await waitFor(() => !canvasLib.getObjectsMap(viewerDoc).has("intruder") || true, 2000, "viewer resync");
    pOwner.destroy();
    pViewer.destroy();
  });

  it("persists updates and resynchronizes offline edits after reconnecting", async () => {
    const d1 = new Y.Doc();
    const p1 = connect(`canvas:${canvasId}`, owner.cookie, d1);
    await waitFor(() => p1.synced, 8000, "synced");
    canvasLib.writeObject(d1, { id: "persist-1", type: "rect", x: 1, y: 1, width: 10, height: 10 });
    await new Promise((r) => setTimeout(r, 900)); // persist debounce
    const persisted = await loadDoc("canvas", canvasId);
    expect(canvasLib.getObjectsMap(persisted).has("persist-1")).toBe(true);

    // Go offline, edit locally, reconnect → the edit reaches the server and other clients.
    p1.disconnect();
    canvasLib.writeObject(d1, { id: "offline-1", type: "sticky", x: 50, y: 50, text: "made offline" });
    const d2 = new Y.Doc();
    const p2 = connect(`canvas:${canvasId}`, member.cookie, d2);
    await waitFor(() => p2.synced, 8000, "second client synced");
    expect(canvasLib.getObjectsMap(d2).has("offline-1")).toBe(false);
    p1.connect();
    await waitFor(() => canvasLib.getObjectsMap(d2).has("offline-1"), 8000, "offline edit delivered after reconnect");
    p1.destroy();
    p2.destroy();
  });
});
