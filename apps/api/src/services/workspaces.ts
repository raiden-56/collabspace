import { prisma, type Prisma, type WorkspaceRole } from "@collabspace/db";
import { slugify } from "@collabspace/shared";
import { recordActivity } from "../lib/activity.js";

export const BUILT_IN_RULES: Array<Omit<Prisma.AutomationRuleUncheckedCreateInput, "workspaceId">> = [
  {
    name: "Notify assignee on assignment",
    description: "When a task is assigned to someone, send them an inbox notification.",
    trigger: "task.assigned",
    actions: [{ type: "notify", target: "assignee" }],
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: "Overdue task reminder",
    description: "When a task becomes overdue, notify the assignee (or reporter).",
    trigger: "task.overdue",
    actions: [{ type: "notify", target: "assignee" }],
    enabled: true,
    isBuiltIn: true,
  },
  {
    name: "Suggest review when subtasks complete",
    description: "When all subtasks are done, suggest moving the parent task to review (requires approval).",
    trigger: "task.subtasks_complete",
    actions: [{ type: "suggest_status", status: "in_review" }],
    enabled: true,
    requiresApproval: true,
    isBuiltIn: true,
  },
  {
    name: "Draft summary when a meeting ends",
    description: "When a meeting is marked completed and has a transcript, prepare a draft AI summary.",
    trigger: "meeting.ended",
    actions: [{ type: "draft_summary" }],
    enabled: false,
    requiresApproval: true,
    isBuiltIn: true,
  },
  {
    name: "Notify collaborators when a resource is shared",
    description: "When a document or canvas is shared with someone, notify them.",
    trigger: "resource.shared",
    actions: [{ type: "notify", target: "actor" }],
    enabled: true,
    isBuiltIn: true,
  },
];

export async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  const reserved = new Set(["app", "admin", "api", "inbox", "search", "favorites", "recent", "templates", "settings", "workspaces", "login", "register"]);
  if (reserved.has(slug)) slug = `${slug}-team`;
  let candidate = slug;
  for (let i = 2; i < 1000; i++) {
    const exists = await prisma.workspace.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
    candidate = `${slug}-${i}`;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

export interface CreateWorkspaceOptions {
  name: string;
  slug?: string;
  purpose?: string;
  description?: string;
  ownerId: string;
  isDemo?: boolean;
}

export async function createWorkspace(opts: CreateWorkspaceOptions) {
  const slug = await uniqueSlug(opts.slug ?? opts.name);
  const ws = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: {
        name: opts.name,
        slug,
        purpose: opts.purpose ?? null,
        description: opts.description ?? null,
        ownerId: opts.ownerId,
        isDemo: opts.isDemo ?? false,
        members: { create: { userId: opts.ownerId, role: "OWNER" } },
        channels: {
          create: [
            { type: "PUBLIC", name: "general", topic: "Team-wide announcements and discussion", createdById: opts.ownerId, members: { create: { userId: opts.ownerId } } },
            { type: "PUBLIC", name: "random", topic: "Everything else", createdById: opts.ownerId, members: { create: { userId: opts.ownerId } } },
          ],
        },
        labels: {
          create: [
            { name: "bug", color: "#EF6464" },
            { name: "feature", color: "#5B8CFF" },
            { name: "improvement", color: "#31B887" },
            { name: "design", color: "#9B7BFF" },
          ],
        },
        automationRules: { create: BUILT_IN_RULES.map((r) => ({ ...r, createdById: opts.ownerId })) },
      },
    });
    return ws;
  });
  await recordActivity({ workspaceId: ws.id, actorId: opts.ownerId, type: "workspace.created", resourceType: "WORKSPACE", resourceId: ws.id, resourceTitle: ws.name });
  return ws;
}

export async function addMember(workspaceId: string, userId: string, role: WorkspaceRole) {
  const member = await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: {},
    create: { workspaceId, userId, role },
  });
  // Auto-join public channels.
  const publicChannels = await prisma.channel.findMany({ where: { workspaceId, type: "PUBLIC", archivedAt: null }, select: { id: true } });
  if (publicChannels.length) {
    await prisma.channelMember.createMany({ data: publicChannels.map((c) => ({ channelId: c.id, userId })), skipDuplicates: true });
  }
  return member;
}

export const memberSelect = {
  id: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true, color: true } },
} as const;

export async function workspaceSummaryForUser(userId: string) {
  const members = await prisma.workspaceMember.findMany({
    where: { userId, workspace: { deletedAt: null } },
    include: { workspace: { include: { _count: { select: { members: true, projects: true } } } } },
    orderBy: { joinedAt: "asc" },
  });
  return members.map((m) => ({ ...m.workspace, role: m.role, memberCount: m.workspace._count.members, projectCount: m.workspace._count.projects }));
}
