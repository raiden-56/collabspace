import { prisma } from "@collabspace/db";
import { doc as tiptapDoc } from "@collabspace/shared";
import { createProjectFromTemplate, addDays } from "./projects.js";
import { seedCanvasFromTemplate, seedDocumentContent } from "./collab.js";

/**
 * Demo workspace content. Only created when the user explicitly chooses "demo workspace".
 * Everything is labeled "[Demo]" so sample data is never mistaken for real work.
 */
export async function createDemoContent(workspaceId: string, ownerId: string): Promise<void> {
  const project = await createProjectFromTemplate({ workspaceId, ownerId, templateKey: "project.software", name: "[Demo] Launch CollabSpace", startDate: addDays(new Date(), -7) });

  const canvas = await prisma.canvas.create({ data: { workspaceId, projectId: project.id, title: "[Demo] Brainstorm: onboarding ideas", createdById: ownerId, templateKey: "canvas.brainstorm" } });
  await seedCanvasFromTemplate(canvas.id, "canvas.brainstorm", ownerId);

  const retro = await prisma.canvas.create({ data: { workspaceId, projectId: project.id, title: "[Demo] Sprint retrospective", createdById: ownerId, templateKey: "canvas.retro" } });
  await seedCanvasFromTemplate(retro.id, "canvas.retro", ownerId);

  const notes = await prisma.document.create({ data: { workspaceId, projectId: project.id, title: "[Demo] Kickoff meeting notes", icon: "📝", createdById: ownerId } });
  await seedDocumentContent(
    notes.id,
    tiptapDoc(
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Kickoff meeting notes" }] },
      { type: "paragraph", content: [{ type: "text", text: "This is sample content created with the demo workspace. Edit it freely — it is not connected to any real team." }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Decisions" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Ship the infinite canvas first." }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Use Yjs for real-time collaboration." }] }] }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Action items" }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "Write the engineering design doc" }] }] }, { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Set up the repository" }] }] }] },
    ),
  );

  const meeting = await prisma.meeting.create({
    data: {
      workspaceId,
      projectId: project.id,
      title: "[Demo] Weekly sync",
      description: "Sample meeting with a transcript you can summarize with the AI assistant.",
      startsAt: addDays(new Date(), -1),
      durationMin: 30,
      createdById: ownerId,
      facilitatorId: ownerId,
      status: "COMPLETED",
      endedAt: addDays(new Date(), -1),
      agenda: [
        { id: "a1", title: "Progress since last week", durationMin: 10, done: true },
        { id: "a2", title: "Blockers", durationMin: 10, done: true },
        { id: "a3", title: "Next steps", durationMin: 10, done: false },
      ],
      participants: { create: { userId: ownerId, status: "ACCEPTED", attended: true } },
      linkedCanvasIds: [canvas.id],
      linkedDocumentIds: [notes.id],
    },
  });
  await prisma.meetingTranscript.create({
    data: {
      meetingId: meeting.id,
      source: "PASTE",
      createdById: ownerId,
      content: [
        "Alex: Thanks everyone for joining. Let's start with progress. The canvas prototype is working and syncing between two browsers.",
        "Sam: Great. On my side, the document editor is mostly done but comments are still missing.",
        "Alex: Okay. Let's decide: we ship the canvas and documents first, and comments come in the following sprint.",
        "Jordan: One blocker — we still don't have a decision on the storage provider. I need that by Friday.",
        "Alex: Decision: we go with S3-compatible storage. Jordan, can you set up the bucket and signed URLs by Friday?",
        "Jordan: Yes, I'll take that.",
        "Sam: I'll write the comments design doc and share it by Wednesday.",
        "Alex: Open question: do we need offline support for the first release? Let's revisit next week.",
        "Alex: Action for me: schedule the demo with the design team for next Tuesday.",
      ].join("\n"),
    },
  });

  const general = await prisma.channel.findFirst({ where: { workspaceId, name: "general" } });
  if (general) {
    await prisma.message.create({ data: { channelId: general.id, authorId: ownerId, body: "Welcome to your demo workspace! Everything here is sample content marked [Demo]. Try opening the canvas in two browser windows to see live collaboration." } });
  }
}
