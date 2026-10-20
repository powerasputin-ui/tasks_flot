import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { AUTH_DIR, DATA_FILE, type UiData } from "./fixtures";

/** Уборка всего, что создали global-setup и сами сценарии (чаты, задачи, уведомления, учётки, дирекция). */
export default async function globalTeardown() {
  if (!fs.existsSync(DATA_FILE)) return;
  const data: UiData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  const prisma = new PrismaClient();
  try {
    const people = Object.values(data.users).map((u) => u.id);
    const items = (await prisma.operationalItem.findMany({ where: { directorateId: data.directorateId }, select: { id: true } })).map((i) => i.id);
    await prisma.chatThread.deleteMany({ where: { OR: [{ members: { some: { userId: { in: people } } } }, { userAId: { in: people } }, { userBId: { in: people } }] } });
    await prisma.rateLimit.deleteMany({ where: { OR: people.map((p) => ({ key: { contains: p } })) } });
    await prisma.appSetting.deleteMany({ where: { key: { in: people.map((p) => `table.filters:${p}`) } } });
    await prisma.notification.deleteMany({ where: { userId: { in: people } } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ entityId: { in: items } }, { actorId: { in: people } }] } });
    await prisma.itemNote.deleteMany({ where: { itemId: { in: items } } });
    await prisma.operationalItem.deleteMany({ where: { directorateId: data.directorateId } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
    await prisma.directorate.deleteMany({ where: { id: data.directorateId } });
  } finally {
    await prisma.$disconnect();
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
}
