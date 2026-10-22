import { prisma, type NotificationType, type ResourceType } from "@collabspace/db";
import { ch } from "@collabspace/shared";
import { emit } from "./realtime.js";
import { sendMail, emailLayout, escapeHtml } from "./email.js";
import { config } from "../config.js";
import { logger } from "./logger.js";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  workspaceId?: string | null;
  actorId?: string | null;
  resourceType?: ResourceType | null;
  resourceId?: string | null;
  href?: string | null;
  groupKey?: string | null;
  /** Send an email too (subject to the recipient's preferences) */
  email?: boolean;
}

interface Prefs {
  emailMentions?: boolean;
  emailAssignments?: boolean;
  emailComments?: boolean;
  inAppChat?: boolean;
}

function emailAllowed(type: NotificationType, prefs: Prefs): boolean {
  switch (type) {
    case "MENTION":
      return prefs.emailMentions !== false;
    case "TASK_ASSIGNED":
      return prefs.emailAssignments !== false;
    case "COMMENT":
    case "COMMENT_REPLY":
      return prefs.emailComments === true;
    case "WORKSPACE_INVITE":
    case "MEETING_INVITE":
    case "SHARE_ACCESS":
    case "MEETING_SUMMARY":
      return true;
    default:
      return false;
  }
}

/**
 * Create an in-app notification, push it in realtime and optionally email it.
 * Skips self-notifications. Never throws.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.userId) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true, name: true, preferences: true, disabledAt: true } });
    if (!user || user.disabledAt) return;
    const prefs = ((user.preferences as { notifications?: Prefs } | null)?.notifications ?? {}) as Prefs;
    if (input.type === "CHAT_MESSAGE" && prefs.inAppChat === false) return;

    // Group repeated notifications (e.g. many comments on one thread) within 10 minutes.
    if (input.groupKey) {
      const recent = await prisma.notification.findFirst({
        where: { userId: input.userId, groupKey: input.groupKey, readAt: null, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } },
      });
      if (recent) {
        const updated = await prisma.notification.update({
          where: { id: recent.id },
          data: { title: input.title, body: input.body ?? recent.body, createdAt: new Date(), actorId: input.actorId ?? recent.actorId },
          include: { actor: { select: { id: true, name: true, avatarUrl: true, color: true } } },
        });
        emit([ch.user(input.userId)], { t: "notification:new", p: { notification: updated as unknown as Record<string, unknown> } });
        return;
      }
    }

    const n = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        workspaceId: input.workspaceId ?? null,
        actorId: input.actorId ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        href: input.href ?? null,
        groupKey: input.groupKey ?? null,
      },
      include: { actor: { select: { id: true, name: true, avatarUrl: true, color: true } } },
    });
    emit([ch.user(input.userId)], { t: "notification:new", p: { notification: n as unknown as Record<string, unknown> } });

    if (input.email && emailAllowed(input.type, prefs)) {
      const url = input.href ? `${config.APP_URL}${input.href}` : config.APP_URL;
      const result = await sendMail({
        to: user.email,
        subject: input.title,
        text: `${input.title}\n\n${input.body ?? ""}\n\n${url}`,
        html: emailLayout(input.title, `<p>${escapeHtml(input.body ?? "")}</p>`, { label: "Open in CollabSpace", url }),
      });
      if (result.delivered) await prisma.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
    }
  } catch (err) {
    logger.warn({ err, type: input.type }, "notification failed");
  }
}

export async function notifyMany(userIds: string[], input: Omit<NotifyInput, "userId">): Promise<void> {
  await Promise.all([...new Set(userIds)].map((userId) => notify({ ...input, userId })));
}
