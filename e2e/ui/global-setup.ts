import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { chromium, type FullConfig } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { AUTH_DIR, DATA_FILE, stateFile, type Role, type UiData } from "./fixtures";

/**
 * Временная дирекция, директор, два руководителя, ЗГД и три задачи (просроченная, на проверке, срок завтра);
 * вход каждой ролью через страницу входа и сохранение куки. Всё помечено TAG и удаляется в global-teardown.
 */
export default async function globalSetup(config: FullConfig) {
  const prisma = new PrismaClient();
  const tag = `UI${Date.now()}`;
  const password = crypto.randomBytes(12).toString("base64url");
  const hash = await bcrypt.hash(password, 10);
  try {
    const dir = await prisma.directorate.create({ data: { name: `${tag} Дирекция`, shortName: "UI" } });
    const mk = async (key: Role, name: string, role: "DIRECTOR" | "HEAD" | "EXECUTIVE" | "ADMIN") => {
      const u = await prisma.user.create({ data: { name: `${name} ${tag}`, email: `${tag.toLowerCase()}.${key}@ui.local`, passwordHash: hash, role, directorateId: role === "EXECUTIVE" ? null : dir.id } });
      return { id: u.id, email: u.email, name: u.name };
    };
    const users = { director: await mk("director", "Директоров", "DIRECTOR"), head: await mk("head", "Руководителев", "HEAD"), head2: await mk("head2", "Коллегин", "HEAD"), zgd: await mk("zgd", "Згдеев", "EXECUTIVE"), admin: await mk("admin", "Админов", "ADMIN") };
    const status = async (name: string) => (await prisma.status.findFirstOrThrow({ where: { name } })).id;
    const day = (n: number) => {
      const t = new Date(Date.now() + 3 * 3600e3 + n * 864e5);
      return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    };
    const item = async (title: string, statusName: string, deadline: Date | null) => {
      const it = await prisma.operationalItem.create({ data: { title: `${title} ${tag}`, directorateId: dir.id, responsibleId: users.head.id, createdById: users.head.id, updatedById: users.head.id, statusId: await status(statusName), deadline, originalDeadline: deadline } });
      return { id: it.id, title: it.title };
    };
    const items = { overdue: await item("Просроченная задача", "В работе", day(-5)), review: await item("Сданная задача", "На проверке", day(7)), soon: await item("Срочная задача", "В работе", day(1)) };
    const data: UiData = { tag, directorateId: dir.id, users, items };
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    const baseURL = (config.projects[0].use.baseURL as string) ?? "http://localhost:3000";
    const browser = await chromium.launch();
    for (const role of Object.keys(users) as Role[]) {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      // форма входа работает после загрузки скриптов страницы: ждём тишины в сети, иначе щелчок уходит в пустую форму
      for (let attempt = 1; ; attempt++) {
        await page.goto("/login", { waitUntil: "networkidle" });
        await page.locator('input[type="email"]').fill(users[role].email);
        await page.locator('input[type="password"]').fill(password);
        await page.locator('button[type="submit"]').click();
        try {
          await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
        }
      }
      await ctx.storageState({ path: stateFile(role) });
      await ctx.close();
    }
    await browser.close();
  } finally {
    await prisma.$disconnect();
  }
}
