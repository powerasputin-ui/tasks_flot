import { as, expect, menu, noSideScroll, test, uiData } from "./fixtures";

// Дымовые сценарии по ролям: открывается, нажимается, не ломает вёрстку. Каждый — на компьютере и телефоне (projects).

test.describe("руководитель", () => {
  test.use(as("head"));

  test("меню и таблица: «Мой день» первым, в шапке таблицы нет «Удалённых»", async ({ page }) => {
    await page.goto("/table");
    await expect(page.getByText("Рабочая таблица", { exact: false }).first()).toBeVisible();
    await expect.poll(async () => (await menu(page))[0]).toBe("Мой день");
    await expect(page.locator("p.label-caps a", { hasText: "Удалённые" })).toHaveCount(0);
    await noSideScroll(page);
  });

  test("«Мой день»: просроченная и срочная задачи на месте", async ({ page }) => {
    const d = uiData();
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Мой день" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Просрочено" })).toBeVisible();
    await expect(page.getByText(d.items.overdue.title)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Срок скоро" })).toBeVisible();
    await expect(page.getByText(d.items.soon.title)).toBeVisible();
    await noSideScroll(page);
  });

  test("доска: меню «⋯» у карточки открывается", async ({ page }) => {
    const d = uiData();
    await page.goto("/tracker?view=board");
    const card = page.locator("article", { hasText: d.items.overdue.title });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: /^Действия/ }).click();
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Открыть" })).toBeVisible();
    await noSideScroll(page);
  });
});

test.describe("директор", () => {
  test.use(as("director"));

  test("трекер: три вида, нет кнопки «Сегодня», плашка колонки фильтрует доску", async ({ page }) => {
    await page.goto("/tracker?view=list");
    await expect(page.getByRole("heading", { name: "Трекер" })).toBeVisible();
    await page.goto("/tracker?view=timeline");
    await expect(page.getByRole("button", { name: "Сегодня", exact: true })).toHaveCount(0);
    await page.goto("/tracker?view=board");
    await page.getByRole("button", { name: /^На проверке:/ }).click();
    await expect(page).toHaveURL(/col=REVIEW/);
    await expect(page.locator("section[aria-label]")).toHaveCount(1);
    await noSideScroll(page);
  });

  test("карточка задачи → «Обсудить» открывает чат по задаче", async ({ page }) => {
    const d = uiData();
    await page.goto("/tracker?view=board");
    await page.locator("article", { hasText: d.items.review.title }).click();
    await page.getByRole("button", { name: "Обсудить" }).click();
    const chat = page.getByRole("dialog", { name: "Чат" });
    await expect(chat).toBeVisible();
    await expect(chat.getByText("Обсуждение задачи", { exact: false }).first()).toBeVisible();
    await expect(chat.getByText(d.items.review.title).first()).toBeVisible();
  });

  test("чат: создать группу и написать сообщение", async ({ page }) => {
    const d = uiData();
    await page.goto("/today");
    await page.getByRole("button", { name: "Чат", exact: true }).click();
    const chat = page.getByRole("dialog", { name: "Чат" });
    await chat.getByRole("button", { name: "Новый" }).click();
    await chat.getByRole("button", { name: "Группа", exact: true }).click();
    await chat.getByPlaceholder("Название группы").fill(`Группа ${d.tag}`);
    await chat.getByRole("button", { name: new RegExp(d.users.head.name) }).click();
    await chat.getByRole("button", { name: /Создать группу/ }).click();
    await expect(chat.getByText(`Группа ${d.tag}`).first()).toBeVisible();
    await chat.locator("textarea").fill("Проверка связи");
    await chat.getByRole("button", { name: "Отправить" }).click();
    await expect(chat.getByText("Проверка связи")).toBeVisible();
  });
});

test.describe("ЗГД", () => {
  test.use(as("zgd"));

  test("меню без рабочей таблицы, «Мой день» и трекер открываются", async ({ page }) => {
    await page.goto("/today");
    await expect(page.getByRole("heading", { name: "Мой день" })).toBeVisible();
    await expect.poll(() => menu(page)).toContain("Мой день");
    const items = await menu(page);
    expect(items).not.toContain("Общая таблица");
    await page.goto("/tracker");
    await expect(page.getByRole("heading", { name: "Трекер" })).toBeVisible();
    await noSideScroll(page);
  });
});

test.describe("админ", () => {
  test.use(as("admin"));

  test("Настройки → «Ошибки»: журнал открывается по ссылке из сводки", async ({ page }) => {
    await page.goto("/settings?section=errors");
    await expect(page.getByRole("heading", { name: "Ошибки сайта" })).toBeVisible();
    await noSideScroll(page);
  });
});

test.describe("ЗГД: вкладки «Моего дня»", () => {
  test.use(as("zgd"));

  test("Дирекции → карточка ведёт в трекер с фильтром; Динамика — таблицей; Поручения", async ({ page }) => {
    const d = uiData();
    await page.goto("/today?tab=dirs");
    await expect(page.getByRole("tab", { name: "Дирекции", selected: true })).toBeVisible();
    const card = page.locator(`a[href="/tracker?org=${d.directorateId}"]`).first();
    await expect(card).toContainText("Нет актуальных данных");
    await page.getByRole("tab", { name: "Динамика" }).click();
    await expect(page).toHaveURL(/tab=trend/);
    await page.getByRole("button", { name: "Показать таблицей" }).click();
    await expect(page.locator("table").first()).toContainText("справки не было");
    await page.getByRole("tab", { name: "Поручения" }).click();
    await expect(page).toHaveURL(/tab=orders/);
    await noSideScroll(page);
    await page.getByRole("tab", { name: "Дирекции" }).click();
    await page.locator(`a[href="/tracker?org=${d.directorateId}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`org=${d.directorateId}`));
    await expect(page.getByRole("heading", { name: "Трекер" })).toBeVisible();
  });
});
