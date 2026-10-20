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

  test("таблица: фильтры по выбору — по умолчанию только «+ Фильтры»; отмеченный появляется в ряду и остаётся после перезагрузки", async ({ page }) => {
    await page.goto("/table");
    const picker = () => page.getByRole("button", { name: /^Фильтры/ });
    const statusChip = () => page.getByRole("button", { name: /^Статус\s*Все/ });
    const toggle = async () => {
      await picker().click();
      // выбор сохраняется в учётной записи — ждём ответа, прежде чем перезагружать
      await Promise.all([page.waitForResponse((r) => r.url().includes("/api/table-filters") && r.request().method() === "PUT"), page.getByRole("checkbox", { name: "Статус", exact: true }).click()]);
    };
    await expect(picker()).toBeVisible();
    await expect(statusChip()).toHaveCount(0);
    await toggle();
    await expect(statusChip()).toBeVisible();
    await page.reload();
    await expect(statusChip()).toBeVisible();
    // снять галочку — фильтр уходит из ряда (заодно ряд возвращается к исходному для следующего прогона)
    await toggle();
    await expect(statusChip()).toHaveCount(0);
    await noSideScroll(page);
  });

  test("стартовая страница — «Мой день»", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole("heading", { name: "Мой день" })).toBeVisible();
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

  test("«Мой день»: возвращённая директором — в «Вернули на доработку» с замечанием, задача — в одном разделе", async ({ page }) => {
    const d = uiData();
    await page.goto("/today");
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Вернули на доработку" }) });
    await expect(sec).toContainText(d.items.returned.title);
    await expect(sec).toContainText("нет акта сверки");
    await expect(page.getByText(d.items.returned.title)).toHaveCount(1);
  });

  test("карточка: «Ход работы» первым разделом, кнопку «Удалить» не закрывает кнопка чата", async ({ page }) => {
    const d = uiData();
    await page.goto("/tracker?view=board");
    await page.locator("article", { hasText: d.items.overdue.title }).click();
    const panel = page.locator("aside[data-side-panel]");
    await expect(panel.locator("h3").first()).toHaveText("Ход работы");
    // кнопка чата отходит левее панели (на телефоне — прячется, пока карточка открыта): щелчок доходит до «Удалить»
    await panel.getByRole("button", { name: "Удалить" }).click({ trial: true });
  });

  test("трекер: на телефоне выпадающие фильтры свёрнуты в «Фильтры», на компьютере видны сразу", async ({ page }) => {
    await page.goto("/tracker?view=board");
    const phone = (page.viewportSize()?.width ?? 1300) < 768;
    const more = page.getByRole("button", { name: /^Фильтры/ });
    const column = page.getByRole("button", { name: /^Колонка/ });
    if (phone) {
      await expect(column).toBeHidden();
      await more.click();
      await expect(column).toBeVisible();
    } else {
      await expect(more).toBeHidden();
      await expect(column).toBeVisible();
    }
    await noSideScroll(page);
  });
});

test.describe("директор", () => {
  test.use(as("director"));

  test("трекер: три вида, нет кнопки «Сегодня», список «Колонка» фильтрует доску", async ({ page }) => {
    await page.goto("/tracker?view=list");
    await expect(page.getByRole("heading", { name: "Трекер" })).toBeVisible();
    await page.goto("/tracker?view=timeline");
    await expect(page.getByRole("button", { name: "Сегодня", exact: true })).toHaveCount(0);
    await page.goto("/tracker?view=board");
    // на телефоне выпадающие фильтры — за кнопкой «Фильтры»
    if ((page.viewportSize()?.width ?? 1300) < 768) await page.getByRole("button", { name: /^Фильтры/ }).click();
    await page.getByRole("button", { name: /^Колонка/ }).click();
    await page.getByRole("checkbox", { name: /^На проверке/ }).click();
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

  test("«Мой день»: поручение ЗГД без исполнителя — «Назначьте ответственного», в карточке выбор исполнителя сверху", async ({ page }) => {
    const d = uiData();
    await page.goto("/today");
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Назначьте ответственного" }) });
    await expect(sec).toContainText(d.items.order.title);
    await sec.getByText(d.items.order.title).click();
    await expect(page).toHaveURL(new RegExp(`item=${d.items.order.id}`));
    await expect(page.locator("aside[data-side-panel]").getByText("Поручение без исполнителя — назначьте ответственного")).toBeVisible();
  });

  test("список: новая задача, которую ЗГД ещё не видел, — «ЗГД не видит» (а не «не подтверждено»)", async ({ page }) => {
    const d = uiData();
    await page.goto("/tracker?view=list");
    const row = page.locator("li", { hasText: d.items.overdue.title });
    await expect(row).toContainText("ЗГД не видит");
    await expect(row).not.toContainText("не подтверждено для ЗГД");
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
