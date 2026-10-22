/**
 * Local development seed. Creates two users, a workspace with demo-labelled content
 * (project from template, canvases, documents, meeting with transcript, chat messages).
 * Idempotent: re-running updates the same records.
 *
 *   pnpm db:seed
 *   Logins: alice@collabspace.local / password1234 (owner), bob@collabspace.local / password1234 (member)
 */
import argon2 from "argon2";
import * as Y from "yjs";
import { prisma } from "../src/index.js";
import { buildCanvasTemplate, PROJECT_TEMPLATES, DEFAULT_BOARD_COLUMNS, canvas as canvasLib } from "@collabspace/shared";
import { tiptapJsonToYDoc } from "@collabspace/shared/editor";
import { saveFullState } from "../src/collab.js";

const PASSWORD = "password1234";

async function upsertUser(email: string, name: string, color: string, platformRole: "USER" | "ADMIN" = "USER") {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  return prisma.user.upsert({ where: { email }, update: { name, color, platformRole, emailVerifiedAt: new Date(), onboardingDone: true, passwordHash }, create: { email, name, color, platformRole, emailVerifiedAt: new Date(), onboardingDone: true, passwordHash } });
}

async function main() {
  const alice = await upsertUser("alice@collabspace.local", "Alice Rivera", "#5B8CFF", "ADMIN");
  const bob = await upsertUser("bob@collabspace.local", "Bob Chen", "#31B887");
  const carol = await upsertUser("carol@collabspace.local", "Carol Osei", "#F4B740");

  const slug = "demo-team";
  let ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) {
    ws = await prisma.workspace.create({
      data: {
        slug,
        name: "[Demo] Product Team",
        description: "Seeded demo workspace. Everything here is sample data.",
        ownerId: alice.id,
        isDemo: true,
        members: { create: [{ userId: alice.id, role: "OWNER" }, { userId: bob.id, role: "MEMBER" }, { userId: carol.id, role: "MEMBER" }] },
        channels: { create: [{ type: "PUBLIC", name: "general", topic: "Team-wide discussion", createdById: alice.id, members: { create: [{ userId: alice.id }, { userId: bob.id }, { userId: carol.id }] } }] },
        labels: { create: [{ name: "bug", color: "#EF6464" }, { name: "feature", color: "#5B8CFF" }, { name: "design", color: "#9B7BFF" }] },
      },
    });
  }

  // Project from template with real tasks
  const tpl = PROJECT_TEMPLATES.find((t) => t.key === "project.software")!;
  let project = await prisma.project.findFirst({ where: { workspaceId: ws.id, key: "DEMO" } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        workspaceId: ws.id,
        ownerId: alice.id,
        name: "[Demo] Launch CollabSpace",
        key: "DEMO",
        description: tpl.description,
        color: tpl.color,
        icon: tpl.icon,
        startDate: new Date(Date.now() - 7 * 86400_000),
        dueDate: new Date(Date.now() + 21 * 86400_000),
        members: { create: [{ userId: alice.id, role: "LEAD" }, { userId: bob.id, role: "MEMBER" }, { userId: carol.id, role: "MEMBER" }] },
        boards: { create: { workspaceId: ws.id, name: "Board", isDefault: true, columns: { create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ name: c.name, statusKey: c.statusKey, color: c.color, isDone: c.isDone, position: (i + 1) * 1000 })) } } },
      },
    });
    const assignees = [alice.id, bob.id, carol.id];
    const ids = new Map<string, string>();
    let n = 0;
    for (const t of tpl.tasks) {
      n += 1;
      const task = await prisma.task.create({
        data: { workspaceId: ws.id, projectId: project.id, number: n, title: t.title, status: t.status ?? "todo", priority: t.priority ?? "NONE", reporterId: alice.id, assigneeId: assignees[n % 3]!, position: n * 1000, dueDate: t.dueOffsetDays != null ? new Date(Date.now() + (t.dueOffsetDays - 7) * 86400_000) : null, completedAt: t.status === "done" ? new Date() : null },
      });
      ids.set(t.key, task.id);
    }
    await prisma.project.update({ where: { id: project.id }, data: { taskCounter: n } });
    for (const t of tpl.tasks) {
      if (t.parentKey) await prisma.task.update({ where: { id: ids.get(t.key)! }, data: { parentId: ids.get(t.parentKey)! } });
      for (const d of t.dependsOn ?? []) await prisma.taskDependency.create({ data: { taskId: ids.get(t.key)!, dependsOnTaskId: ids.get(d)!, type: "BLOCKS" } });
    }
  }

  // Canvases
  for (const key of ["canvas.brainstorm", "canvas.flowchart", "canvas.retro"]) {
    const title = `[Demo] ${key.split(".")[1]!.replace(/^\w/, (c) => c.toUpperCase())}`;
    const exists = await prisma.canvas.findFirst({ where: { workspaceId: ws.id, title } });
    if (exists) continue;
    const canvas = await prisma.canvas.create({ data: { workspaceId: ws.id, projectId: project.id, title, createdById: alice.id, templateKey: key } });
    const doc = new Y.Doc();
    const snap = buildCanvasTemplate(key, canvas.id.slice(-6))!;
    canvasLib.applySnapshot(doc, snap, "seed");
    await saveFullState("canvas", canvas.id, doc);
  }

  // Document
  const docTitle = "[Demo] Engineering design doc";
  if (!(await prisma.document.findFirst({ where: { workspaceId: ws.id, title: docTitle } }))) {
    const document = await prisma.document.create({ data: { workspaceId: ws.id, projectId: project.id, title: docTitle, icon: "📐", createdById: bob.id } });
    const content = tpl.documents[0]!.content;
    await saveFullState("document", document.id, tiptapJsonToYDoc(content));
  }

  // Meeting with transcript
  const meetingTitle = "[Demo] Weekly sync";
  if (!(await prisma.meeting.findFirst({ where: { workspaceId: ws.id, title: meetingTitle } }))) {
    const notes = await prisma.document.create({ data: { workspaceId: ws.id, projectId: project.id, title: `${meetingTitle} — notes`, icon: "📝", createdById: alice.id } });
    await saveFullState("document", notes.id, tiptapJsonToYDoc({ type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: meetingTitle }] }, { type: "paragraph", content: [{ type: "text", text: "Collaborative notes — edit together in real time." }] }] }));
    const meeting = await prisma.meeting.create({
      data: {
        workspaceId: ws.id,
        projectId: project.id,
        title: meetingTitle,
        startsAt: new Date(Date.now() - 86400_000),
        durationMin: 30,
        status: "COMPLETED",
        createdById: alice.id,
        facilitatorId: alice.id,
        notesDocumentId: notes.id,
        agenda: [{ id: "a1", title: "Progress", done: true }, { id: "a2", title: "Blockers", done: true }, { id: "a3", title: "Next steps", done: false }],
        participants: { create: [{ userId: alice.id, status: "ACCEPTED", attended: true }, { userId: bob.id, status: "ACCEPTED", attended: true }, { userId: carol.id, status: "TENTATIVE" }] },
      },
    });
    await prisma.meetingTranscript.create({
      data: {
        meetingId: meeting.id,
        source: "PASTE",
        createdById: alice.id,
        content: ["Alice: Thanks for joining. The canvas prototype syncs between two browsers now.", "Bob: The document editor is mostly done, comments are still missing.", "Alice: Decision: we ship canvas and documents first; comments follow next sprint.", "Carol: Blocker — we need a decision on storage by Friday.", "Alice: Decision: S3-compatible storage. Carol, can you set up the bucket by Friday?", "Carol: Yes, I'll take that.", "Bob: I'll write the comments design doc by Wednesday.", "Alice: Open question: do we need offline support in the first release?"].join("\n"),
      },
    });
  }

  const general = await prisma.channel.findFirst({ where: { workspaceId: ws.id, name: "general" } });
  if (general && (await prisma.message.count({ where: { channelId: general.id } })) === 0) {
    await prisma.message.createMany({
      data: [
        { channelId: general.id, authorId: alice.id, body: "Welcome to the demo workspace! Open the brainstorm canvas in two windows to see live cursors." },
        { channelId: general.id, authorId: bob.id, body: `Thanks @[Alice Rivera](${alice.id}) — I'll start on the design doc.`, mentions: [alice.id] },
      ],
    });
  }

  console.log(`Seeded workspace /app/${slug}`);
  console.log(`  alice@collabspace.local / ${PASSWORD} (owner, platform admin)`);
  console.log(`  bob@collabspace.local / ${PASSWORD} (member)`);
  console.log(`  carol@collabspace.local / ${PASSWORD} (member)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
