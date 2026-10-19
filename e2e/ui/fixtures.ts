import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

/** Что создал global-setup: учётки по ролям и задачи (id, названия). */
export type UiData = {
  tag: string;
  directorateId: string;
  users: Record<Role, { id: string; email: string; name: string }>;
  items: Record<"overdue" | "review" | "soon" | "returned" | "order", { id: string; title: string }>;
};
export type Role = "director" | "head" | "head2" | "zgd" | "admin";

export const AUTH_DIR = path.join(__dirname, ".auth");
export const DATA_FILE = path.join(AUTH_DIR, "data.json");
export const stateFile = (role: Role) => path.join(AUTH_DIR, `${role}.json`);
export const uiData = (): UiData => JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

/**
 * Каждый сценарий заодно проверяет: нет необработанных ошибок в браузере и ответов сервера 5xx,
 * и на странице нет горизонтальной прокрутки (частая поломка на телефоне).
 */
export const test = base.extend<{ watch: { errors: string[] } }>({
  watch: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("response", (r) => {
        if (r.status() >= 500) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
      });
      await use({ errors });
      expect(errors, "ошибки браузера или ответы 5xx во время сценария").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export const as = (role: Role) => ({ storageState: stateFile(role) });

/** Нет горизонтальной прокрутки всей страницы. */
export async function noSideScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "страница шире экрана — появляется горизонтальная прокрутка").toBeLessThanOrEqual(1);
}

/** Видимые пункты главного меню (на компьютере — в шапке, на телефоне — нижняя панель). */
export async function menu(page: Page): Promise<string[]> {
  return (await page.locator("nav a:visible").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}
