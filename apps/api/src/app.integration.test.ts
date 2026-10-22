import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { prisma } from "@collabspace/db";

/**
 * API integration tests against a real PostgreSQL database.
 * Covers: auth, workspaces, invitations, projects/tasks, documents & versions, canvases, comments,
 * permissions & share links, notifications, meetings + AI summaries (mock provider), search.
 */

let app: Express;
const suffix = Date.now().toString(36);
const alice = { email: `alice-${suffix}@test.local`, password: "correct-horse-1234", name: "Alice" };
const bob = { email: `bob-${suffix}@test.local`, password: "battery-staple-5678", name: "Bob" };
const eve = { email: `eve-${suffix}@test.local`, password: "outsider-pass-9999", name: "Eve" };

type Agent = ReturnType<typeof request.agent>;
let a: Agent;
let b: Agent;
let e: Agent;
let workspaceId: string;
let workspaceSlug: string;
let projectId: string;
let boardId: string;
let documentId: string;
let canvasId: string;
let privateDocId: string;

const ORIGIN = "http://localhost:3000";

beforeAll(async () => {
  const { createApp } = await import("./app.js");
  app = createApp();
  a = request.agent(app);
  b = request.agent(app);
  e = request.agent(app);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("auth", () => {
  it("registers, logs out and logs back in with a cookie session", async () => {
    const reg = await a.post("/api/v1/auth/register").set("origin", ORIGIN).send(alice);
    expect(reg.status).toBe(201);
    expect(reg.headers["set-cookie"]?.[0]).toMatch(/cs_session=.*HttpOnly/);
    expect(reg.body.data.user.email).toBe(alice.email);

    const me = await a.get("/api/v1/auth/me");
    expect(me.status).toBe(200);

    const out = await a.post("/api/v1/auth/logout").set("origin", ORIGIN);
    expect(out.status).toBe(204);
    expect((await a.get("/api/v1/auth/me")).status).toBe(401);

    const bad = await a.post("/api/v1/auth/login").set("origin", ORIGIN).send({ email: alice.email, password: "wrong-password-1" });
    expect(bad.status).toBe(401);
    const login = await a.post("/api/v1/auth/login").set("origin", ORIGIN).send({ email: alice.email, password: alice.password });
    expect(login.status).toBe(200);
    expect((await a.get("/api/v1/auth/me")).status).toBe(200);
  });

  it("rejects weak passwords and duplicate emails", async () => {
    expect((await request(app).post("/api/v1/auth/register").send({ ...bob, password: "short" })).status).toBe(400);
    expect((await request(app).post("/api/v1/auth/register").send(alice)).status).toBe(409);
  });

  it("blocks cross-site state changes without a trusted Origin", async () => {
    const res = await a.post("/api/v1/workspaces").set("origin", "https://evil.example").send({ name: "Evil" });
    expect(res.status).toBe(403);
  });

  it("supports password reset via token", async () => {
    const forgot = await request(app).post("/api/v1/auth/forgot-password").send({ email: alice.email });
    expect(forgot.status).toBe(200);
    const token = forgot.body.data.devResetToken as string;
    expect(token).toBeTruthy();
    const reset = await request(app).post("/api/v1/auth/reset-password").send({ token, password: "new-pass-word-4321" });
    expect(reset.status).toBe(200);
    alice.password = "new-pass-word-4321";
    // old sessions are revoked
    expect((await a.get("/api/v1/auth/me")).status).toBe(401);
    expect((await a.post("/api/v1/auth/login").set("origin", ORIGIN).send({ email: alice.email, password: alice.password })).status).toBe(200);
  });
});

describe("workspaces & invitations", () => {
  it("creates a workspace with defaults and lists it", async () => {
    const res = await a.post("/api/v1/workspaces").set("origin", ORIGIN).send({ name: `Test Co ${suffix}` });
    expect(res.status).toBe(201);
    workspaceId = res.body.data.id;
    workspaceSlug = res.body.data.slug;
    expect(res.body.data.role).toBe("OWNER");
    const list = await a.get("/api/v1/workspaces");
    expect(list.body.data.some((w: { id: string }) => w.id === workspaceId)).toBe(true);
    const bySlug = await a.get(`/api/v1/workspaces/${workspaceSlug}`);
    expect(bySlug.body.data.id).toBe(workspaceId);
    const channels = await a.get(`/api/v1/workspaces/${workspaceId}/channels`);
    expect(channels.body.data.map((c: { name: string }) => c.name)).toContain("general");
  });

  it("invites a second user who accepts and becomes a member; outsiders are rejected", async () => {
    await b.post("/api/v1/auth/register").set("origin", ORIGIN).send(bob);
    await e.post("/api/v1/auth/register").set("origin", ORIGIN).send(eve);
    const inv = await a.post(`/api/v1/workspaces/${workspaceId}/invitations`).set("origin", ORIGIN).send({ emails: [bob.email], role: "MEMBER" });
    expect(inv.status).toBe(201);
    const url = inv.body.data[0].inviteUrl as string;
    const token = url.split("/invite/")[1]!;
    const preview = await request(app).get(`/api/v1/invitations/${token}`);
    expect(preview.body.data.workspace.id).toBe(workspaceId);
    // Wrong user cannot accept
    expect((await e.post(`/api/v1/invitations/${token}/accept`).set("origin", ORIGIN)).status).toBe(409);
    const accept = await b.post(`/api/v1/invitations/${token}/accept`).set("origin", ORIGIN);
    expect(accept.status).toBe(200);
    const members = await a.get(`/api/v1/workspaces/${workspaceId}/members`);
    expect(members.body.data).toHaveLength(2);
    // Outsider cannot read the workspace
    expect((await e.get(`/api/v1/workspaces/${workspaceId}`)).status).toBe(403);
    // Member cannot change roles
    const bobId = members.body.data.find((m: { user: { email: string } }) => m.user.email === bob.email).user.id;
    expect((await b.patch(`/api/v1/workspaces/${workspaceId}/members/${bobId}`).set("origin", ORIGIN).send({ role: "ADMIN" })).status).toBe(403);
  });
});

describe("projects & tasks", () => {
  it("creates a project from a template with real tasks, docs, canvases and dependencies", async () => {
    const res = await a.post(`/api/v1/workspaces/${workspaceId}/projects`).set("origin", ORIGIN).send({ name: "Launch", templateKey: "project.software" });
    expect(res.status).toBe(201);
    projectId = res.body.data.id;
    boardId = res.body.data.boardId;
    const project = await a.get(`/api/v1/projects/${projectId}`);
    expect(project.body.data.dashboard.totals.tasks).toBeGreaterThan(5);
    const board = await a.get(`/api/v1/boards/${boardId}`);
    expect(board.body.data.columns.map((c: { statusKey: string }) => c.statusKey)).toEqual(["backlog", "todo", "in_progress", "in_review", "done"]);
    expect(board.body.data.tasks.some((t: { blocked: boolean }) => t.blocked)).toBe(true);
    const resources = await a.get(`/api/v1/projects/${projectId}/resources`);
    expect(resources.body.data.documents.length).toBeGreaterThan(0);
    expect(resources.body.data.canvases.length).toBeGreaterThan(0);
  });

  it("creates, moves, assigns and comments on a task; detects dependency cycles", async () => {
    const t1 = await b.post(`/api/v1/projects/${projectId}/tasks`).set("origin", ORIGIN).send({ title: "Write tests", priority: "HIGH" });
    expect(t1.status).toBe(201);
    expect(t1.body.data.key).toMatch(/^LAUN-\d+$/);
    const t2 = await b.post(`/api/v1/projects/${projectId}/tasks`).set("origin", ORIGIN).send({ title: "Deploy" });
    const moved = await b.post(`/api/v1/tasks/${t1.body.data.id}/move`).set("origin", ORIGIN).send({ status: "done" });
    expect(moved.body.data.status).toBe("done");
    expect(moved.body.data.completedAt).toBeTruthy();
    expect((await b.post(`/api/v1/tasks/${t1.body.data.id}/move`).set("origin", ORIGIN).send({ status: "nope" })).status).toBe(400);

    // Assign to Alice → notification for Alice
    const me = await a.get("/api/v1/auth/me");
    const aliceId = me.body.data.user.id;
    const assigned = await b.patch(`/api/v1/tasks/${t2.body.data.id}`).set("origin", ORIGIN).send({ assigneeId: aliceId });
    expect(assigned.body.data.assignee.id).toBe(aliceId);
    const notifs = await a.get("/api/v1/notifications");
    expect(notifs.body.data.items.some((n: { type: string }) => n.type === "TASK_ASSIGNED")).toBe(true);

    // Dependencies: t2 depends on t1, then t1 depending on t2 is a cycle
    expect((await b.post(`/api/v1/tasks/${t2.body.data.id}/dependencies`).set("origin", ORIGIN).send({ dependsOnTaskId: t1.body.data.id })).status).toBe(201);
    expect((await b.post(`/api/v1/tasks/${t1.body.data.id}/dependencies`).set("origin", ORIGIN).send({ dependsOnTaskId: t2.body.data.id })).status).toBe(409);

    // Comment with mention
    const c = await b.post("/api/v1/comments").set("origin", ORIGIN).send({ resourceType: "TASK", resourceId: t2.body.data.id, body: `Please review @[Alice](${aliceId})` });
    expect(c.status).toBe(201);
    const mention = await a.get("/api/v1/notifications?type=MENTION");
    expect(mention.body.data.items.length).toBeGreaterThan(0);
    const threads = await a.get(`/api/v1/comments?resourceType=TASK&resourceId=${t2.body.data.id}`);
    expect(threads.body.data[0].comments[0].mentions).toHaveLength(1);

    // Outsider cannot see the task
    expect((await e.get(`/api/v1/tasks/${t2.body.data.id}`)).status).toBe(404);
  });
});

describe("documents, canvases & versions", () => {
  it("creates a document from a template and restores a version", async () => {
    const doc = await a.post("/api/v1/documents").set("origin", ORIGIN).send({ workspaceId, projectId, templateKey: "doc.meeting-notes" });
    expect(doc.status).toBe(201);
    documentId = doc.body.data.id;
    const content = await a.get(`/api/v1/documents/${documentId}/content`);
    expect(content.body.data.text).toContain("Meeting notes");
    expect(content.body.data.checklist.length).toBeGreaterThan(0);

    const v1 = await a.post(`/api/v1/documents/${documentId}/versions`).set("origin", ORIGIN).send({ name: "Checkpoint A" });
    expect(v1.status).toBe(201);
    // Simulate an edit via a fresh seed (replace content), then restore the checkpoint
    const { seedDocumentContent } = await import("./services/collab.js");
    await seedDocumentContent(documentId, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Completely different content" }] }] });
    expect((await a.get(`/api/v1/documents/${documentId}/content`)).body.data.text).toContain("Completely different");
    const restore = await a.post(`/api/v1/documents/${documentId}/restore`).set("origin", ORIGIN).send({ versionId: v1.body.data.id });
    expect(restore.status).toBe(200);
    expect(restore.body.data.kind).toBe("RESTORE");
    expect((await a.get(`/api/v1/documents/${documentId}/content`)).body.data.text).toContain("Meeting notes");
    const versions = await a.get(`/api/v1/documents/${documentId}/versions`);
    const kinds = versions.body.data.map((v: { kind: string }) => v.kind);
    expect(kinds).toContain("PRE_RESTORE");
    expect(kinds).toContain("RESTORE");
    expect(kinds).toContain("NAMED");
  });

  it("creates a canvas from a template, converts a note into a linked task", async () => {
    const canvas = await a.post("/api/v1/canvases").set("origin", ORIGIN).send({ workspaceId, projectId, title: "Ideas", templateKey: "canvas.brainstorm" });
    expect(canvas.status).toBe(201);
    canvasId = canvas.body.data.id;
    const snap = await a.get(`/api/v1/canvases/${canvasId}/snapshot`);
    const sticky = snap.body.data.objects.find((o: { type: string }) => o.type === "sticky");
    expect(sticky).toBeTruthy();
    const task = await a.post(`/api/v1/canvases/${canvasId}/objects/${sticky.id}/convert-to-task`).set("origin", ORIGIN).send({ projectId });
    expect(task.status).toBe(201);
    expect(task.body.data.sourceType).toBe("canvas-note");
    expect(task.body.data.sourceId).toBe(sticky.id);
    const versions = await a.get(`/api/v1/canvases/${canvasId}/versions`);
    expect(versions.status).toBe(200);
  });
});

describe("permissions & sharing", () => {
  it("hides private documents from members until granted; share links grant and can be revoked", async () => {
    const doc = await a.post("/api/v1/documents").set("origin", ORIGIN).send({ workspaceId, title: "Secret plan", visibility: "PRIVATE" });
    privateDocId = doc.body.data.id;
    expect((await b.get(`/api/v1/documents/${privateDocId}`)).status).toBe(404);
    const list = await b.get(`/api/v1/workspaces/${workspaceId}/documents`);
    expect(list.body.data.some((d: { id: string }) => d.id === privateDocId)).toBe(false);
    const search = await b.get(`/api/v1/search?workspaceId=${workspaceId}&q=Secret`);
    expect(search.body.data.hits.some((h: { id: string }) => h.id === privateDocId)).toBe(false);

    // Grant Bob commenter access
    const bobMe = await b.get("/api/v1/auth/me");
    const grant = await a.post("/api/v1/permissions").set("origin", ORIGIN).send({ resourceType: "DOCUMENT", resourceId: privateDocId, userId: bobMe.body.data.user.id, level: "COMMENTER" });
    expect(grant.status).toBe(201);
    const asBob = await b.get(`/api/v1/documents/${privateDocId}`);
    expect(asBob.status).toBe(200);
    expect(asBob.body.data.access).toBe("COMMENTER");
    expect((await b.patch(`/api/v1/documents/${privateDocId}`).set("origin", ORIGIN).send({ title: "Hacked" })).status).toBe(403);
    expect((await b.get(`/api/v1/search?workspaceId=${workspaceId}&q=Secret`)).body.data.hits.some((h: { id: string }) => h.id === privateDocId)).toBe(true);

    // Share link for an outsider (anonymous)
    expect((await a.post("/api/v1/share-links").set("origin", ORIGIN).send({ resourceType: "DOCUMENT", resourceId: privateDocId, level: "EDITOR", requireLogin: false })).status).toBe(400);
    const link = await a.post("/api/v1/share-links").set("origin", ORIGIN).send({ resourceType: "DOCUMENT", resourceId: privateDocId, level: "VIEWER", expiresInHours: 24 });
    expect(link.status).toBe(201);
    const token = (link.body.data.url as string).split("/share/")[1]!;
    const resolved = await request(app).get(`/api/v1/shared/${token}`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.resourceId).toBe(privateDocId);
    expect((await request(app).get(`/api/v1/documents/${privateDocId}?share=${token}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/documents/${privateDocId}/content?share=${token}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/documents/${privateDocId}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/shared/not-a-real-token`)).status).toBe(404);

    // Member (Bob) cannot revoke; owner can; afterwards the token is dead.
    expect((await b.delete(`/api/v1/share-links/${link.body.data.id}`).set("origin", ORIGIN)).status).toBe(403);
    expect((await a.delete(`/api/v1/share-links/${link.body.data.id}`).set("origin", ORIGIN)).status).toBe(204);
    expect((await request(app).get(`/api/v1/shared/${token}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/documents/${privateDocId}?share=${token}`)).status).toBe(401);
  });

  it("guests only see explicitly shared content", async () => {
    const inv = await a.post(`/api/v1/workspaces/${workspaceId}/invitations`).set("origin", ORIGIN).send({ emails: [eve.email], role: "GUEST" });
    const token = (inv.body.data[0].inviteUrl as string).split("/invite/")[1]!;
    expect((await e.post(`/api/v1/invitations/${token}/accept`).set("origin", ORIGIN)).status).toBe(200);
    expect((await e.get(`/api/v1/documents/${documentId}`)).status).toBe(404);
    expect((await e.get(`/api/v1/projects/${projectId}`)).status).toBe(404);
    const docs = await e.get(`/api/v1/workspaces/${workspaceId}/documents`);
    expect(docs.body.data).toHaveLength(0);
    const eveId = (await e.get("/api/v1/auth/me")).body.data.user.id;
    await a.post("/api/v1/permissions").set("origin", ORIGIN).send({ resourceType: "DOCUMENT", resourceId: documentId, userId: eveId, level: "VIEWER" });
    expect((await e.get(`/api/v1/documents/${documentId}`)).status).toBe(200);
    expect((await e.get(`/api/v1/workspaces/${workspaceId}/documents`)).body.data).toHaveLength(1);
  });
});

describe("meetings & AI", () => {
  it("creates a meeting, uploads a transcript, generates a summary and converts reviewed action items", async () => {
    const meeting = await a.post("/api/v1/meetings").set("origin", ORIGIN).send({ workspaceId, projectId, title: "Planning", startsAt: new Date().toISOString(), durationMin: 30 });
    expect(meeting.status).toBe(201);
    const meetingId = meeting.body.data.id;
    expect(meeting.body.data.notesDocument?.id).toBeTruthy();
    const transcript = await a.post(`/api/v1/meetings/${meetingId}/transcripts`).set("origin", ORIGIN).send({
      content: "Alice: Decision: we ship on Friday.\nBob: I'll write the release notes by Thursday.\nAlice: Open question: do we need a blog post?\nBob: Can you book the demo room by Wednesday?",
      source: "PASTE",
    });
    expect(transcript.status).toBe(201);
    expect((await a.post(`/api/v1/meetings/${meetingId}/summarize`).set("origin", ORIGIN).send({})).status).toBe(400); // consent required
    const job = await a.post(`/api/v1/meetings/${meetingId}/summarize`).set("origin", ORIGIN).send({ consent: true });
    expect(job.status).toBe(202);
    // Run the job inline (worker is not started in tests)
    const { processJob } = await import("./services/ai/jobs.js");
    const row = await prisma.aIJob.findUniqueOrThrow({ where: { id: job.body.data.jobId } });
    await processJob(row);
    const full = await a.get(`/api/v1/meetings/${meetingId}`);
    const summary = full.body.data.summaries[0];
    expect(summary.status).toBe("COMPLETED");
    expect(summary.content.decisions.length).toBeGreaterThan(0);
    expect(summary.content.actionItems.length).toBeGreaterThan(0);
    expect(summary.content.actionItems[0].excerpt).toBeTruthy();
    const drafts = full.body.data.actionItems.filter((i: { status: string }) => i.status === "DRAFT");
    expect(drafts.length).toBeGreaterThan(0);
    // Nothing was created as a task automatically
    expect(full.body.data.actionItems.every((i: { taskId: string | null }) => i.taskId === null)).toBe(true);
    // Review & convert one
    const convert = await a.post(`/api/v1/meetings/${meetingId}/action-items/convert`).set("origin", ORIGIN).send({ items: [{ id: drafts[0].id, title: drafts[0].text, projectId }] });
    expect(convert.status).toBe(200);
    expect(convert.body.data[0].task.sourceType).toBe("meeting-action");
    const after = await a.get(`/api/v1/meetings/${meetingId}`);
    expect(after.body.data.actionItems.find((i: { id: string }) => i.id === drafts[0].id).status).toBe("CONVERTED");
  });

  it("assistant answers from accessible context and proposes rather than performs actions", async () => {
    const res = await a.post("/api/v1/ai/chat").set("origin", ORIGIN).send({ workspaceId, message: "What should we work on next?" });
    expect(res.status).toBe(200);
    expect(res.body.data.message.content.length).toBeGreaterThan(10);
    expect(res.body.data.conversationId).toBeTruthy();
    // Outsider cannot use the assistant in this workspace
    const eveRes = await request(app).post("/api/v1/ai/chat").set("origin", ORIGIN).send({ workspaceId, message: "hi" });
    expect(eveRes.status).toBe(401);
  });
});

describe("search & analytics", () => {
  it("finds tasks by key and respects permissions", async () => {
    const res = await a.get(`/api/v1/search?workspaceId=${workspaceId}&q=LAUN-1`);
    expect(res.body.data.hits.some((h: { type: string; title: string }) => h.type === "TASK" && h.title.startsWith("LAUN-1 "))).toBe(true);
    const analytics = await a.get(`/api/v1/workspaces/${workspaceId}/analytics`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.totals.tasks).toBeGreaterThan(0);
    expect(analytics.body.data.completedOverTime).toHaveLength(42);
  });
});
