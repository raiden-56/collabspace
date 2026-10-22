import { Router } from "express";
import { prisma, type Prisma, type NotificationType } from "@collabspace/db";
import { NotificationQuery, UpdateNotificationInput, ch } from "@collabspace/shared";
import { h, parseBody, parseQuery, ok, requireParam, toPage } from "../lib/http.js";
import { notFound } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { emit } from "../lib/realtime.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const include = { actor: { select: { id: true, name: true, avatarUrl: true, color: true } }, workspace: { select: { id: true, slug: true, name: true } } } as const;

notificationsRouter.get(
  "/",
  h(async (req, res) => {
    const q = parseQuery(NotificationQuery, req.query);
    const where: Prisma.NotificationWhereInput = { userId: req.user!.id, ...(q.unread ? { readAt: null } : {}), ...(q.type ? { type: { in: q.type.split(",") as Prisma.NotificationWhereInput["type"] extends infer T ? (T extends { in?: infer U } ? U : never) : never } } : {}) };
    const rows = await prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}), include });
    const unread = await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } });
    ok(res, { ...toPage(rows, q.limit), unread });
  }),
);

notificationsRouter.patch(
  "/:notificationId",
  h(async (req, res) => {
    const id = requireParam(req, "notificationId");
    const input = parseBody(UpdateNotificationInput, req.body);
    const n = await prisma.notification.findFirst({ where: { id, userId: req.user!.id } });
    if (!n) throw notFound("Notification");
    const updated = await prisma.notification.update({ where: { id }, data: { readAt: input.read ? new Date() : null }, include });
    emit([ch.user(req.user!.id)], { t: "notification:read", p: { ids: [id] } });
    ok(res, updated);
  }),
);

notificationsRouter.post(
  "/read-all",
  h(async (req, res) => {
    const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
    emit([ch.user(req.user!.id)], { t: "notification:read", p: { ids: [], all: true } });
    ok(res, { updated: r.count });
  }),
);

notificationsRouter.delete(
  "/:notificationId",
  h(async (req, res) => {
    await prisma.notification.deleteMany({ where: { id: requireParam(req, "notificationId"), userId: req.user!.id } });
    res.status(204).end();
  }),
);
