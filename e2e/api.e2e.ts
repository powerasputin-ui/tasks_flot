import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

// Сессия подменяется: тест вызывает настоящие маршруты от имени выбранного пользователя.
const state = vi.hoisted(() => ({ actor: null as null | { id: string; role: string; name: string; directorateId: string | null; memoEditor?: boolean; submits?: boolean } }));
vi.mock("@/lib/session", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    getSession: async () => (state.actor ? { userId: state.actor.id, role: state.actor.role } : null),
    requireSession: async () => {
      if (!state.actor) throw new AuthError("UNAUTHENTICATED");
      return { userId: state.actor.id, role: state.actor.role };
    },
    requireActor: async () => {
      if (!state.actor) throw new AuthError("UNAUTHENTICATED");
      return state.actor;
    },
    requireRealActor: async () => {
      if (!state.actor) throw new AuthError("UNAUTHENTICATED");
      return state.actor;
    },
    requireFreshSession: async () => {
      if (!state.actor) throw new AuthError("UNAUTHENTICATED");
      return { userId: state.actor.id, role: state.actor.role, directorateId: state.actor.directorateId };
    },
    invalidateActor: () => {},
  };
});

import * as items from "@/app/api/items/route";
import * as item from "@/app/api/items/[id]/route";
import * as restore from "@/app/api/items/[id]/restore/route";
import * as purgeRoute from "@/app/api/items/[id]/purge/route";
import * as ret from "@/app/api/items/[id]/return/route";
import * as history from "@/app/api/items/[id]/history/route";
import * as fileShortcut from "@/app/api/items/[id]/files/[fileId]/shortcut/route";
import { sendDeadlineReminders } from "@/lib/deadline-reminders";
import { sendWeeklyDigests } from "@/lib/weekly-digest";
import { publishAll } from "@/lib/workflow-server";
import { loadAuditWindow } from "@/lib/audit-window";
import { pruneNotifications } from "@/lib/notifications";
import * as recent from "@/app/api/items/recent-changes/route";
import * as columns from "@/app/api/columns/route";
import * as column from "@/app/api/columns/[id]/route";
import * as tracks from "@/app/api/tracks/route";
import * as track from "@/app/api/tracks/[id]/route";
import * as tableColumns from "@/app/api/table-columns/route";
import * as exportTable from "@/app/api/export/table/route";
import * as users from "@/app/api/users/route";
import * as user from "@/app/api/users/[id]/route";
import * as cycles from "@/app/api/cycles/route";
import * as cyclesCurrent from "@/app/api/cycles/current/route";
import * as cycleReview from "@/app/api/cycles/[id]/review/route";
import * as cycleExport from "@/app/api/cycles/[id]/export/route";
import * as bootstrap from "@/app/api/bootstrap/route";
import * as tracker from "@/app/api/tracker/route";
import * as transition from "@/app/api/items/[id]/transition/route";
import * as workflow from "@/app/api/items/[id]/workflow/route";
import * as zgd from "@/app/api/zgd/route";
import * as publish from "@/app/api/tracker/publish/route";
import * as report from "@/app/api/report/route";
import * as templates from "@/app/api/report-templates/route";
import * as template from "@/app/api/report-templates/[id]/route";
import * as exportReport from "@/app/api/export/report/route";
import * as cycleFinalize from "@/app/api/cycles/[id]/finalize/route";
import * as cycleReport from "@/app/api/cycles/[id]/report/route";
import * as directorates from "@/app/api/directorates/route";
import * as directorateOne from "@/app/api/directorates/[id]/route";
import * as login from "@/app/api/auth/login/route";
import { hashPassword } from "@/lib/auth";
import { notifyDirectors } from "@/lib/memo-log";
import * as segments from "@/app/api/segments/route";
import * as segmentOne from "@/app/api/segments/[id]/route";
import * as statusesRoute from "@/app/api/statuses/route";
import * as statusOne from "@/app/api/statuses/[id]/route";
import * as attrRoute from "@/app/api/attractiveness/route";
import * as attrOne from "@/app/api/attractiveness/[id]/route";
import * as memo from "@/app/api/cycles/[id]/memo/route";
import * as memoRefresh from "@/app/api/cycles/[id]/memo/refresh/route";
import * as memoAssist from "@/app/api/ai/memo-assist/route";
import * as memoHistory from "@/app/api/cycles/[id]/memo/history/route";
import * as memoExport from "@/app/api/cycles/[id]/memo/export/route";
import * as memoSections from "@/app/api/memo-sections/route";
import * as memoInclude from "@/app/api/cycles/[id]/memo/include/route";
import * as inclusion from "@/app/api/memo/inclusion/route";
import * as archive from "@/app/api/memo-archive/route";
import * as archiveOne from "@/app/api/memo-archive/[id]/route";
import * as archiveExport from "@/app/api/memo-archive/[id]/export/route";
import * as archiveReturn from "@/app/api/memo-archive/[id]/return/route";
import * as archiveTable from "@/app/api/memo-archive/[id]/table/route";
import * as viewAs from "@/app/api/view-as/route";
import * as weeksList from "@/app/api/weeks/route";
import * as weekOne from "@/app/api/weeks/[cycleId]/route";
import * as cronReminders from "@/app/api/cron/reminders/route";
import { hitRateLimit } from "@/lib/rate-limit";
import { invalidateDicts } from "@/lib/dictionaries";
import * as notif from "@/app/api/notifications/[id]/route";
import * as cycleRemind from "@/app/api/cycles/[id]/remind/route";
import * as aiSettings from "@/app/api/ai/settings/route";
import * as aiSettingsTest from "@/app/api/ai/settings/test/route";
import * as aiChat from "@/app/api/ai/chat/route";
import * as aiConsolidate from "@/app/api/ai/consolidate/route";
import * as aiConsolidateExport from "@/app/api/ai/consolidate/export/route";

const prisma = new PrismaClient();
const TAG = `E2E${Date.now()}`;

type Actor = { id: string; role: string; name: string; directorateId: string | null; memoEditor?: boolean; submits?: boolean };
let curator: Actor;
let head: Actor;
// тестовая «вторая дирекция» и её люди; в базе живут только на время прогона
let dirB = "";
let director: Actor; // директор основной дирекции
let directorB: Actor;
let headB: Actor;
const testUserIds: string[] = [];
const admin: Actor = { id: "e2e-admin", role: "SYSTEM_ADMIN", name: "E2E admin", directorateId: null };
const management: Actor = { id: "e2e-mgmt", role: "EXECUTIVE", name: "E2E management", directorateId: null };

const created = { items: [] as string[], columns: [] as string[], tracks: [] as string[], cycles: [] as string[], templates: [] as string[] };
let originalLayout: unknown = undefined;
let layoutKey = "";

async function call(
  actor: Actor | null,
  handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  url: string,
  opts: { method?: string; body?: unknown; id?: string } = {}
) {
  state.actor = actor;
  const req = new NextRequest(`http://localhost${url}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve({ id: opts.id ?? "" }) });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : null;
  return { status: res.status, data, res };
}

const q = (s: string) => encodeURIComponent(s);
const rowIds = (d: { rows: Array<{ id: string }> }) => d.rows.map((r) => r.id);

let headItem = "";
let curatorItem = "";
let colId = "";
let trackId = "";

beforeAll(async () => {
  const sel = { id: true, name: true, role: true, directorateId: true } as const;
  curator = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", isActive: true, directorateId: { not: null } }, select: sel });
  head = await prisma.user.findFirstOrThrow({ where: { role: "HEAD", isActive: true, directorateId: curator.directorateId }, select: sel });
  admin.directorateId = curator.directorateId;
  const mk = async (name: string, role: "HEAD" | "DIRECTOR", directorateId: string): Promise<Actor> => {
    const u = await prisma.user.create({ data: { name: `${TAG} ${name}`, email: `${TAG}.${name}@e2e.local`, passwordHash: "x", role, directorateId } });
    testUserIds.push(u.id);
    return { id: u.id, name: u.name, role, directorateId };
  };
  dirB = (await prisma.directorate.create({ data: { name: `${TAG} Тестовая дирекция` } })).id;
  director = await mk("director", "DIRECTOR", curator.directorateId!);
  directorB = await mk("directorB", "DIRECTOR", dirB);
  headB = await mk("headB", "HEAD", dirB);
  layoutKey = `table.columns:${curator.directorateId}`;
  originalLayout = (await prisma.appSetting.findUnique({ where: { key: layoutKey } }))?.value ?? null;
});

afterAll(async () => {
  // Общий вид колонок принадлежит настоящей дирекции — возвращаем его ПЕРВЫМ делом и отдельно от остальной уборки:
  // если дальше что-то упадёт, рабочая раскладка пользователя всё равно уже восстановлена.
  await step("восстановление вида колонок", async () => {
    if (originalLayout === undefined) return; // beforeAll не отработал — не трогали
    if (originalLayout === null) await prisma.appSetting.deleteMany({ where: { key: layoutKey } });
    else await prisma.appSetting.update({ where: { key: layoutKey }, data: { value: originalLayout as object } });
  });
  await step("счётчики ограничения частоты", async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: TAG } } });
    await prisma.rateLimit.deleteMany({ where: { key: { contains: management.id } } });
  });
  await step("подключение ИИ тестового ЗГД", async () => {
    await prisma.aiSetting.deleteMany({ where: { userId: management.id } });
  });
  // удаляем всё, что создали (журнал, замечания, уведомления, позиции, колонки, треки, циклы)
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: created.items } } });
  await prisma.itemNote.deleteMany({ where: { itemId: { in: created.items } } });
  await prisma.notification.deleteMany({ where: { message: { contains: TAG } } });
  await prisma.operationalItem.deleteMany({ where: { id: { in: created.items } } });
  await prisma.customColumn.deleteMany({ where: { id: { in: created.columns } } });
  await prisma.track.deleteMany({ where: { id: { in: created.tracks } } });
  await prisma.cycle.deleteMany({ where: { id: { in: created.cycles } } });
  await prisma.reportTemplate.deleteMany({ where: { id: { in: created.templates } } });
  // вторая тестовая дирекция и всё, что в ней создано
  if (dirB) {
    const itemsB = (await prisma.operationalItem.findMany({ where: { directorateId: dirB }, select: { id: true } })).map((i) => i.id);
    await prisma.auditEvent.deleteMany({ where: { entityId: { in: itemsB } } });
    await prisma.itemNote.deleteMany({ where: { itemId: { in: itemsB } } });
    await prisma.operationalItem.deleteMany({ where: { directorateId: dirB } });
    await prisma.cycle.deleteMany({ where: { directorateId: dirB } });
    await prisma.track.deleteMany({ where: { directorateId: dirB } });
    await prisma.segment.deleteMany({ where: { directorateId: dirB } });
    await prisma.customColumn.deleteMany({ where: { directorateId: dirB } });
    await prisma.reportTemplate.deleteMany({ where: { directorateId: dirB } });
    await prisma.appSetting.deleteMany({ where: { key: `table.columns:${dirB}` } });
  }
  const testUsers = (await prisma.user.findMany({ where: { email: { contains: TAG } }, select: { id: true } })).map((u) => u.id);
  await prisma.notification.deleteMany({ where: { userId: { in: testUsers } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: testUsers } } });
  await prisma.reportTemplate.deleteMany({ where: { ownerId: { in: testUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: testUsers } } });
  if (dirB) await prisma.directorate.deleteMany({ where: { id: dirB } });
  await prisma.$disconnect();
});

/** Шаг уборки, который не должен ронять остальную уборку: тесты бегут по настоящей базе разработки. */
async function step(what: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`e2e: не удалось выполнить шаг уборки «${what}»:`, e);
  }
}

describe("позиции: права и версии", () => {
  it("руководитель создаёт позицию, ответственный подставляется автоматически", async () => {
    const r = await call(head, items.POST, "/api/items", {
      method: "POST",
      body: { title: `${TAG} Переговоры с Берёзовым`, comment: "длинный комментарий для поиска", cost: "2 млн.$" },
    });
    expect(r.status).toBe(201);
    expect(r.data.row.ownerId).toBe(head.id);
    headItem = r.data.row.id;
    created.items.push(headItem);
  });

  it("руководитель не может назначить позицию на другого", async () => {
    const r = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} чужая`, responsibleId: curator.id } });
    expect(r.status).toBe(403);
  });

  it("куратор создаёт свою позицию", async () => {
    const r = await call(curator, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} задача куратора`, responsibleId: curator.id } });
    expect(r.status).toBe(201);
    curatorItem = r.data.row.id;
    created.items.push(curatorItem);
  });

  it("руководитель не правит чужую позицию", async () => {
    const r = await call(head, item.PATCH, `/api/items/${curatorItem}`, { method: "PATCH", id: curatorItem, body: { version: 1, comment: "взлом" } });
    expect(r.status).toBe(403);
  });

  it("куратор правит позицию руководителя, версия растёт; устаревшая версия → 409", async () => {
    const ok = await call(curator, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: 1, comment: "поправлено куратором" } });
    expect(ok.status).toBe(200);
    expect(ok.data.row.version).toBe(2);
    const stale = await call(curator, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: 1, comment: "ещё раз" } });
    expect(stale.status).toBe(409);
  });

  it("слишком длинные значения отклоняются (комментарий > 2000, задача > 300)", async () => {
    const c = await call(curator, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: 2, comment: "я".repeat(2001) } });
    expect(c.status).toBe(400);
    const t = await call(curator, items.POST, "/api/items", { method: "POST", body: { title: "я".repeat(301) } });
    expect(t.status).toBe(400);
  });

  it("руководство не видит рабочие позиции, администратор читает, но не создаёт", async () => {
    const m = await call(management, items.GET, `/api/items?q=${q(TAG)}`);
    expect(m.data.rows).toEqual([]);
    const a = await call(admin, items.GET, `/api/items?q=${q(TAG)}`);
    expect(a.data.rows.length).toBe(2);
    const c = await call(admin, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} админ` } });
    expect(c.status).toBe(403);
  });
});

describe("поиск", () => {
  const search = async (query: string, extra = "") => rowIds((await call(head, items.GET, `/api/items?q=${q(query)}${extra}`)).data);

  it("находит по метке, без учёта регистра", async () => {
    expect((await search(TAG)).length).toBe(2);
    expect((await search(TAG.toLowerCase())).length).toBe(2);
  });

  it("несколько слов ищутся вместе, ё = е", async () => {
    expect(await search(`${TAG} березовым`)).toEqual([headItem]);
    expect(await search(`БЕРЁЗОВЫМ ${TAG}`)).toEqual([headItem]);
    expect(await search(`${TAG} березовым несуществующее`)).toEqual([]);
  });

  it("ищет по комментарию, сумме и фамилии ответственного", async () => {
    expect(await search(`${TAG} поправлено`)).toEqual([headItem]);
    expect(await search(`${TAG} млн`)).toEqual([headItem]);
    const surname = head.name.split(" ")[0];
    expect(await search(`${TAG} ${surname}`)).toContain(headItem);
    expect(await search(`${TAG} ${surname}`)).not.toContain(curatorItem);
  });

  it("ищет по пояснению привлекательности и по дедлайну", async () => {
    const p70 = await prisma.attractiveness.findFirst({ where: { name: "P70" } });
    if (p70) {
      const cur = (await call(curator, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
      const ok = await call(curator, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: cur.version, attractivenessId: p70.id, deadline: "2031-03-14" } });
      expect(ok.status).toBe(200);
      expect(await search(`${TAG} выше среднего`)).toEqual([headItem]);
      expect(await search(`${TAG} p70`)).toEqual([headItem]);
      expect(await search(`${TAG} 14.03.2031`)).toEqual([headItem]);
      expect(await search(`${TAG} 2031-03-14`)).toEqual([headItem]);
    }
  });

  it("запрос из спецсимволов и пробелов не ломает поиск", async () => {
    expect((await call(head, items.GET, `/api/items?q=${q("(*[\\")}`)).status).toBe(200);
    expect((await call(head, items.GET, `/api/items?q=${q("   ")}`)).status).toBe(200);
  });

  it("фильтры по нескольким трекам сразу (ИЛИ внутри фильтра)", async () => {
    const t1 = await call(curator, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-трек-1` } });
    expect(t1.status).toBe(201);
    trackId = t1.data.track.id;
    created.tracks.push(trackId);
    const other = await call(curator, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-трек-2` } });
    created.tracks.push(other.data.track.id);
    const cur = (await call(curator, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string; version: number }) => r.id === headItem);
    const upd = await call(curator, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: cur.version, trackId } });
    expect(upd.status).toBe(200);
    expect(await search(TAG, `&trackIds=${trackId}`)).toEqual([headItem]);
    expect(await search(TAG, `&trackIds=${trackId},${other.data.track.id}`)).toEqual([headItem]);
    expect(await search(TAG, `&trackIds=${other.data.track.id}`)).toEqual([]);
  });
});

describe("свои колонки", () => {
  it("создаёт только куратор", async () => {
    const denied = await call(head, columns.POST, "/api/columns", { method: "POST", body: { name: `${TAG}-кол`, type: "TEXT" } });
    expect(denied.status).toBe(403);
    const ok = await call(curator, columns.POST, "/api/columns", { method: "POST", body: { name: `${TAG}-приоритет`, type: "SELECT", options: ["Срочно", "Обычно"] } });
    expect(ok.status).toBe(201);
    colId = ok.data.column.id;
    created.columns.push(colId);
  });

  it("список без вариантов для SELECT отклоняется", async () => {
    const bad = await call(curator, columns.POST, "/api/columns", { method: "POST", body: { name: `${TAG}-x`, type: "SELECT" } });
    expect(bad.status).toBe(400);
  });

  it("значение проверяется по типу, попадает в журнал и в поиск", async () => {
    const cur = (await call(head, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
    const bad = await call(head, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: cur.version, customValues: { [colId]: "Средний" } } });
    expect(bad.status).toBe(400);
    const ok = await call(head, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: cur.version, customValues: { [colId]: "Срочно" } } });
    expect(ok.status).toBe(200);
    expect((await call(head, items.GET, `/api/items?q=${q(`${TAG} срочно`)}`)).data.rows.map((r: { id: string }) => r.id)).toEqual([headItem]);

    const h = await call(head, history.GET, `/api/items/${headItem}/history`, { id: headItem });
    expect(h.data.events.some((e: { fieldName: string }) => e.fieldName === `custom:${colId}`)).toBe(true);
    expect(h.data.events.some((e: { fieldName: string }) => e.fieldName === "comment")).toBe(true);
  });

  it("лента изменений подписывает поле и учитывает свои колонки", async () => {
    const r = await call(head, recent.GET, "/api/items/recent-changes?limit=100");
    const labels = r.data.events.filter((e: { itemId: string }) => e.itemId === headItem).map((e: { label: string | null }) => e.label);
    expect(labels).toContain("Комментарии"); // как колонка в «Настройках → Колонки таблицы»
    expect(labels).toContain(`${TAG}-приоритет`);
  });

  it("удаление колонки скрывает её, значения остаются", async () => {
    const denied = await call(head, column.DELETE, `/api/columns/${colId}`, { method: "DELETE", id: colId });
    expect(denied.status).toBe(403);
    const ok = await call(curator, column.DELETE, `/api/columns/${colId}`, { method: "DELETE", id: colId });
    expect(ok.status).toBe(200);
    const list = await call(head, columns.GET, "/api/columns");
    expect(list.data.columns.some((c: { id: string }) => c.id === colId)).toBe(false);
    const stored = await prisma.operationalItem.findUniqueOrThrow({ where: { id: headItem } });
    expect((stored.customValues as Record<string, string>)[colId]).toBe("Срочно");
  });
});

describe("удаление, возврат, замечания", () => {
  it("куратор не удаляет чужую позицию, автор — удаляет; удалённая видна в архиве", async () => {
    const denied = await call(curator, item.DELETE, `/api/items/${headItem}`, { method: "DELETE", id: headItem });
    expect(denied.status).toBe(403);
    const own = await call(head, item.DELETE, `/api/items/${headItem}`, { method: "DELETE", id: headItem });
    expect(own.status).toBe(200);
    const archived = await call(head, items.GET, `/api/items?archive=archived&q=${q(TAG)}`);
    expect(rowIds(archived.data)).toEqual([headItem]);
    const active = await call(head, items.GET, `/api/items?q=${q(TAG)}`);
    expect(rowIds(active.data)).not.toContain(headItem);
  });

  it("возврат из архива", async () => {
    const r = await call(curator, restore.POST, `/api/items/${headItem}/restore`, { method: "POST", id: headItem });
    expect(r.status).toBe(200);
    expect(r.data.row.archived).toBe(false);
  });

  it("возврат отправленной позиции: только куратор, замечание по желанию; галка снимается, уведомление уходит", async () => {
    const cur = (await call(curator, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
    const send = await call(head, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: cur.version, operFlag: true } });
    expect(send.status).toBe(200);

    expect((await call(head, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: "x" } })).status).toBe(403);

    const ok = await call(curator, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: `${TAG} уточните сумму` } });
    expect(ok.status).toBe(200);
    expect(ok.data.row.operFlag).toBe(false);
    expect((await call(curator, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: "ещё" } })).status).toBe(409);

    const note = await prisma.itemNote.findFirst({ where: { itemId: headItem } });
    expect(note?.text).toContain("уточните сумму");
    const notif = await prisma.notification.findFirst({ where: { userId: head.id, type: "ITEM_RETURNED", message: { contains: TAG } } });
    expect(notif?.type).toBe("ITEM_RETURNED");
    expect(notif?.link).toContain(headItem); // ведёт сразу к позиции, а не на всю таблицу

    // без замечания — тоже можно: позиция просто возвращается руководителю
    const again = (await call(head, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
    expect((await call(head, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: again.version, operFlag: true } })).status).toBe(200);
    const notes = await prisma.itemNote.count({ where: { itemId: headItem } });
    const bare = await call(curator, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: "  " } });
    expect(bare.status).toBe(200);
    expect(bare.data.row.operFlag).toBe(false);
    expect(await prisma.itemNote.count({ where: { itemId: headItem } })).toBe(notes); // пустое замечание не пишется
    expect(await prisma.notification.count({ where: { userId: head.id, type: "ITEM_RETURNED", message: { contains: "можно поправить и подать снова" }, link: { contains: headItem } } })).toBe(1);
  });

  it("«изменено после отправки»: правка отправленной позиции ставит пометку", async () => {
    const cur = (await call(head, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
    expect((await call(head, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: cur.version, operFlag: true } })).status).toBe(200);
    let row = (await call(head, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
    expect(row.changedAfterSubmission).toBe(false);
    expect((await call(head, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: row.version, cost: "3 млн.$" } })).status).toBe(200);
    row = (await call(head, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
    expect(row.changedAfterSubmission).toBe(true);
  });
});

describe("экспорт", () => {
  it("CSV содержит найденные позиции и учитывает поиск", async () => {
    const r = await call(head, exportTable.GET, `/api/export/table?format=csv&q=${q(TAG)}`);
    expect(r.status).toBe(200);
    const text = await r.res.text();
    expect(text).toContain(TAG);
    expect(text).toContain("Задача");
    const none = await call(head, exportTable.GET, `/api/export/table?format=csv&q=${q(`${TAG} несуществует`)}`);
    expect(await none.res.text()).not.toContain(`${TAG} Переговоры`);
  });

  it("Excel и PDF отдаются, неверный формат → 400, руководству нельзя", async () => {
    for (const f of ["xlsx", "pdf"]) {
      const r = await call(curator, exportTable.GET, `/api/export/table?format=${f}&q=${q(TAG)}`);
      expect(r.status).toBe(200);
      expect((await r.res.arrayBuffer()).byteLength).toBeGreaterThan(500);
    }
    expect((await call(head, exportTable.GET, "/api/export/table?format=doc")).status).toBe(400);
    expect((await call(management, exportTable.GET, "/api/export/table?format=csv")).status).toBe(403);
  });

  it("несуществующая финальная оперативка → 404", async () => {
    const r = await call(management, cycleExport.GET, "/api/cycles/none/export?format=csv", { id: "none" });
    expect(r.status).toBe(404);
  });
});

describe("файлы позиции (ссылки на общий диск)", () => {
  const UNC = "\\\\10.10.51.51\\флот\\Отчёты\\итог март.pptx";

  it("сохраняются со статусом позиции, проверяются, попадают в историю; ярлык .url отдаётся только своей дирекции", async () => {
    const made = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG}-с файлом`, files: [{ path: `"${UNC}"` }] } });
    expect(made.status).toBe(201);
    const id = made.data.row.id as string;
    created.items.push(id);
    expect(made.data.row.files).toHaveLength(1);
    expect(made.data.row.files[0]).toMatchObject({ name: "итог март.pptx", path: UNC });
    const fileId = made.data.row.files[0].id as string;

    // исполняемые и «не пути» — отказ, ничего не меняется
    for (const bad of ["\\\\srv\\share\\run.exe", "просто текст"]) {
      const r = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: 1, files: [{ path: bad }] } });
      expect(r.status, bad).toBe(400);
    }
    // дубль и лимит
    expect((await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: 1, files: [{ path: UNC }, { path: UNC.toUpperCase() }] } })).status).toBe(400);
    expect((await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: 1, files: Array.from({ length: 11 }, (_, i) => ({ path: `D:\\f${i}.txt` })) } })).status).toBe(400);

    // добавить второй файл, первый сохраняет свой id
    const upd = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: 1, files: [{ id: fileId, path: UNC }, { path: "D:\\Отчёты\\схема.pdf" }] } });
    expect(upd.status).toBe(200);
    expect(upd.data.row.files.map((f: { name: string }) => f.name)).toEqual(["итог март.pptx", "схема.pdf"]);
    expect(upd.data.row.files[0].id).toBe(fileId);

    // куратор и директор видят те же файлы
    for (const who of [curator, director]) {
      const seen = await call(who, item.GET, `/api/items/${id}`, { id });
      expect(seen.status).toBe(200);
      expect(seen.data.row.files.map((f: { name: string }) => f.name)).toEqual(["итог март.pptx", "схема.pdf"]);
    }

    const hist = await call(head, history.GET, `/api/items/${id}/history`, { id });
    expect(hist.data.events.some((e: { fieldName: string; after: string }) => e.fieldName === "files" && e.after.includes("схема.pdf"))).toBe(true);

    // ярлык: тело — ASCII, имя вложения в UTF-8
    state.actor = head;
    const ok = await fileShortcut.GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id, fileId }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-disposition")).toContain("attachment");
    const raw = Buffer.from(await ok.arrayBuffer());
    expect([raw[0], raw[1]]).toEqual([0xff, 0xfe]);
    const body = raw.subarray(2).toString("utf16le");
    expect(body.startsWith("[InternetShortcut]")).toBe(true);
    expect(body).toContain("URL=file://10.10.51.51/флот/Отчёты/итог март.pptx");
    // чужая дирекция и несуществующий файл — 404
    state.actor = directorB;
    expect((await fileShortcut.GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id, fileId }) })).status).toBe(404);
    state.actor = head;
    expect((await fileShortcut.GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id, fileId: "нет" }) })).status).toBe(404);
  });
});

describe("справочники: переименование и удаление (только админ)", () => {
  it("статусы, привлекательность и сегменты: админ правит и удаляет неиспользуемое; системные и используемые защищены; остальным — 403", async () => {
    // статус
    const st = await call(curator, statusesRoute.POST, "/api/statuses", { method: "POST", body: { name: `${TAG}-статус` } });
    expect(st.status).toBe(201);
    const sid = st.data.status.id as string;
    expect((await call(director, statusOne.PATCH, `/api/statuses/${sid}`, { method: "PATCH", id: sid, body: { name: `${TAG}-x` } })).status).toBe(403);
    // «На проверке» и «На стопе» — системные статусы трекера: не переименовываются, колонка закреплена
    for (const name of ["На проверке", "На стопе"]) {
      const sys = await prisma.status.findFirstOrThrow({ where: { name } });
      expect((await call(curator, statusOne.PATCH, `/api/statuses/${sys.id}`, { method: "PATCH", id: sys.id, body: { name: `${TAG}-sys` } })).status).toBe(409);
      expect((await call(curator, statusOne.PATCH, `/api/statuses/${sys.id}`, { method: "PATCH", id: sys.id, body: { trackerColumn: "TODO" } })).status).toBe(409);
      expect((await call(curator, statusOne.DELETE, `/api/statuses/${sys.id}`, { method: "DELETE", id: sys.id })).status).toBe(409);
    }
    expect((await call(head, statusOne.DELETE, `/api/statuses/${sid}`, { method: "DELETE", id: sid })).status).toBe(403);
    expect((await call(curator, statusOne.PATCH, `/api/statuses/${sid}`, { method: "PATCH", id: sid, body: { name: "завершено" } })).status).toBe(409); // дубль без учёта регистра
    expect((await call(curator, statusOne.PATCH, `/api/statuses/${sid}`, { method: "PATCH", id: sid, body: { name: "  " } })).status).toBe(400);
    const ren = await call(curator, statusOne.PATCH, `/api/statuses/${sid}`, { method: "PATCH", id: sid, body: { name: `${TAG}-статус-2` } });
    expect(ren.status).toBe(200);
    expect(ren.data.status.name).toBe(`${TAG}-статус-2`);
    // используемый — не удаляется
    const it1 = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG}-со статусом`, statusId: sid } });
    expect(it1.status).toBe(201);
    created.items.push(it1.data.row.id);
    const busy = await call(curator, statusOne.DELETE, `/api/statuses/${sid}`, { method: "DELETE", id: sid });
    expect(busy.status).toBe(409);
    expect(busy.data.error).toBe("IN_USE");
    await prisma.operationalItem.update({ where: { id: it1.data.row.id }, data: { statusId: null } });
    expect((await call(curator, statusOne.DELETE, `/api/statuses/${sid}`, { method: "DELETE", id: sid })).status).toBe(200);
    // системный статус
    const done = await prisma.status.findFirst({ where: { name: "Завершено" } });
    if (done) {
      expect((await call(curator, statusOne.PATCH, `/api/statuses/${done.id}`, { method: "PATCH", id: done.id, body: { name: "Готово" } })).status).toBe(409);
      expect((await call(curator, statusOne.DELETE, `/api/statuses/${done.id}`, { method: "DELETE", id: done.id })).status).toBe(409);
    }

    // привлекательность
    const at = await call(curator, attrRoute.POST, "/api/attractiveness", { method: "POST", body: { name: `${TAG}-оценка` } });
    expect(at.status).toBe(201);
    const aid = at.data.attractiveness.id as string;
    expect((await call(director, attrOne.PATCH, `/api/attractiveness/${aid}`, { method: "PATCH", id: aid, body: { name: `${TAG}-y` } })).status).toBe(403);
    expect((await call(curator, attrOne.PATCH, `/api/attractiveness/${aid}`, { method: "PATCH", id: aid, body: { name: "Среднее" } })).status).toBe(409); // совпадает со словом P50
    expect((await call(curator, attrOne.PATCH, `/api/attractiveness/${aid}`, { method: "PATCH", id: aid, body: { name: `${TAG}-оценка-2` } })).status).toBe(200);
    expect((await call(curator, attrOne.DELETE, `/api/attractiveness/${aid}`, { method: "DELETE", id: aid })).status).toBe(200);

    // сегмент своей дирекции
    const sg = await call(curator, segments.POST, "/api/segments", { method: "POST", body: { name: `${TAG}-сегмент` } });
    expect(sg.status).toBe(201);
    const gid = sg.data.segment.id as string;
    expect((await call(director, segmentOne.PATCH, `/api/segments/${gid}`, { method: "PATCH", id: gid, body: { name: `${TAG}-z` } })).status).toBe(403);
    expect((await call(curator, segmentOne.PATCH, `/api/segments/${gid}`, { method: "PATCH", id: gid, body: { name: `${TAG}-сегмент-2` } })).status).toBe(200);
    // чужая дирекция не видит
    expect((await call(directorB, segmentOne.DELETE, `/api/segments/${gid}`, { method: "DELETE", id: gid })).status).toBe(403);
    expect((await call(curator, segmentOne.DELETE, `/api/segments/${gid}`, { method: "DELETE", id: gid })).status).toBe(200);
  });
});

describe("напоминания по срокам позиций", () => {
  it("ответственному — «через 2 дня» и «просрочено», директору — сводка; повторный запуск не дублирует", async () => {
    // «сегодня» — 08.10.2030 09:00 МСК, чтобы не пересекаться с живыми данными
    const now = new Date("2030-10-08T06:00:00Z");
    const mk = async (title: string, deadline: string) => {
      const r = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG}-${title}`, deadline } });
      expect(r.status).toBe(201);
      created.items.push(r.data.row.id);
      return r.data.row.id as string;
    };
    const soonId = await mk("срок скоро", "2030-10-10");
    const overId = await mk("срок прошёл", "2030-10-07");
    await mk("срок далеко", "2030-10-20");

    const first = await sendDeadlineReminders(now);
    expect(first.soon).toBeGreaterThanOrEqual(1);
    expect(first.overdue).toBeGreaterThanOrEqual(1);
    const mine = await prisma.notification.findMany({ where: { userId: head.id, type: { in: ["DEADLINE_SOON", "DEADLINE_OVERDUE"] } } });
    expect(mine.some((n) => n.type === "DEADLINE_SOON" && n.link?.includes(soonId))).toBe(true);
    expect(mine.some((n) => n.type === "DEADLINE_OVERDUE" && n.link?.includes(overId))).toBe(true);
    expect(mine.some((n) => n.message.includes("срок далеко"))).toBe(false);
    const summary = await prisma.notification.findFirst({ where: { userId: director.id, type: "DEADLINE_OVERDUE", message: { contains: "Просрочено со вчерашнего дня" } } });
    expect(summary).toBeTruthy();

    // второй запуск в тот же день — ничего нового
    const before = await prisma.notification.count({ where: { type: { in: ["DEADLINE_SOON", "DEADLINE_OVERDUE"] } } });
    const again = await sendDeadlineReminders(now);
    expect(again).toEqual({ soon: 0, overdue: 0, summaries: 0 });
    expect(await prisma.notification.count({ where: { type: { in: ["DEADLINE_SOON", "DEADLINE_OVERDUE"] } } })).toBe(before);
    await prisma.notification.deleteMany({ where: { type: { in: ["DEADLINE_SOON", "DEADLINE_OVERDUE"] }, createdAt: { gte: new Date(Date.now() - 600000) } } });
  });

  it("сданная на проверку: исполнителя не торопим, директору — в сводке «ждёт вашей приёмки», повтор не дублирует", async () => {
    const now = new Date("2031-10-08T06:00:00Z");
    const r = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG}-сдана с опозданием`, deadline: "2031-10-07" } });
    created.items.push(r.data.row.id);
    const sid = r.data.row.id as string;
    const sub = await call(head, transition.POST, `/api/items/${sid}/transition`, { method: "POST", id: sid, body: { version: r.data.row.version, action: "submit", result: "Отчёт готов" } });
    expect(sub.status).toBe(200);
    const first = await sendDeadlineReminders(now);
    expect(first.overdue).toBe(0);
    expect(await prisma.notification.count({ where: { userId: head.id, type: "DEADLINE_OVERDUE", link: { contains: sid } } })).toBe(0);
    const summary = () => prisma.notification.count({ where: { userId: director.id, type: "DEADLINE_OVERDUE", message: { contains: "ждёт вашей приёмки" } } });
    expect(await summary()).toBe(1);
    await sendDeadlineReminders(now);
    expect(await summary()).toBe(1);
    await prisma.notification.deleteMany({ where: { type: { in: ["DEADLINE_SOON", "DEADLINE_OVERDUE"] }, createdAt: { gte: new Date(Date.now() - 600000) } } });
  });
});

describe("треки", () => {
  it("руководитель добавляет трек из карточки (с проверкой названия и повторов), но не правит чужие; ЗГД не добавляет", async () => {
    expect((await call(management, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-згд` } })).status).toBe(403);
    const fast = await call(head, tracks.POST, "/api/tracks", { method: "POST", body: { name: `  ${TAG}-быстрый  трек ` } });
    expect(fast.status).toBe(201);
    expect(fast.data.track.name).toBe(`${TAG}-быстрый трек`);
    // тот же трек другим написанием (регистр, пробелы/дефис) — повтор
    expect((await call(head, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-БЫСТРЫЙ-ТРЕК` } })).status).toBe(409);
    // мусор и пустое — отказ
    for (const bad of ["", " ", "я", "12345", "!!!!", "ааааааа"]) expect((await call(head, tracks.POST, "/api/tracks", { method: "POST", body: { name: bad } })).status, bad).toBe(400);
    // править и удалять справочник руководитель по-прежнему не может
    expect((await call(head, track.PATCH, `/api/tracks/${fast.data.track.id}`, { method: "PATCH", id: fast.data.track.id, body: { name: `${TAG}-иначе` } })).status).toBe(403);
    expect((await call(curator, track.DELETE, `/api/tracks/${fast.data.track.id}`, { method: "DELETE", id: fast.data.track.id })).status).toBe(200);
  });

  it("неиспользуемый трек удаляется, используемый скрывается", async () => {

    const renamed = await call(curator, track.PATCH, `/api/tracks/${trackId}`, { method: "PATCH", id: trackId, body: { name: `${TAG}-трек-1-новый` } });
    expect(renamed.status).toBe(200);
    expect(renamed.data.track.name).toBe(`${TAG}-трек-1-новый`);

    const used = await call(curator, track.DELETE, `/api/tracks/${trackId}`, { method: "DELETE", id: trackId });
    expect(used.data.mode).toBe("hidden");
    expect((await prisma.track.findUnique({ where: { id: trackId } }))?.isActive).toBe(false);

    const fresh = await call(curator, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-временный` } });
    created.tracks.push(fresh.data.track.id);
    const gone = await call(curator, track.DELETE, `/api/tracks/${fresh.data.track.id}`, { method: "DELETE", id: fresh.data.track.id });
    expect(gone.data.mode).toBe("deleted");
    expect(await prisma.track.findUnique({ where: { id: fresh.data.track.id } })).toBeNull();
  });
});

describe("общий вид колонок таблицы", () => {
  const layout = [
    { key: "name", label: "Задача", visible: true, width: 280 },
    { key: "track", label: `${TAG} Трек`, visible: true, width: 170 },
    { key: "cost", label: "Оценка $", visible: false, width: 110, removed: true },
  ];

  it("меняет куратор, видят все; руководитель менять не может", async () => {
    expect((await call(head, tableColumns.PUT, "/api/table-columns", { method: "PUT", body: { columns: layout } })).status).toBe(403);
    expect((await call(curator, tableColumns.PUT, "/api/table-columns", { method: "PUT", body: { columns: layout } })).status).toBe(200);
    const seen = await call(head, tableColumns.GET, "/api/table-columns");
    expect(seen.data.columns).toEqual(layout);
  });

  it("некорректная настройка отклоняется", async () => {
    const r = await call(curator, tableColumns.PUT, "/api/table-columns", { method: "PUT", body: { columns: [{ key: "x", label: "y", visible: "да", width: 5 }] } });
    expect(r.status).toBe(400);
  });
});

describe("пользователи", () => {
  // Все изменения — только над тестовыми пользователями с меткой: настоящих людей тест не трогает.
  it("руководитель не управляет пользователями; директор создаёт только руководителей своей дирекции", async () => {
    const body = (role: string, n: string) => ({ name: "x", email: `${TAG}.${n}@e2e.local`, password: "longpassword1", role });
    expect((await call(head, users.POST, "/api/users", { method: "POST", body: body("HEAD", "h1") })).status).toBe(403);
    expect((await call(director, users.POST, "/api/users", { method: "POST", body: body("ADMIN", "a1") })).status).toBe(403);
    expect((await call(director, users.POST, "/api/users", { method: "POST", body: body("DIRECTOR", "d1") })).status).toBe(403);
    expect((await call(director, users.POST, "/api/users", { method: "POST", body: body("EXECUTIVE", "z1") })).status).toBe(403);
    const ok = await call(director, users.POST, "/api/users", { method: "POST", body: body("HEAD", "h2") });
    expect(ok.status).toBe(201);
    // дирекцию новому человеку ставит сервер (директору — его собственную), а не тело запроса
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: ok.data.user.id } });
    expect(stored.directorateId).toBe(director.directorateId);
    for (const e of ["a1", "d1", "z1"]) expect(await prisma.user.findUnique({ where: { email: `${TAG}.${e}@e2e.local` } })).toBeNull();
  });

  it("директор не меняет роли и не правит директоров, руководителей чужой дирекции для него не существует", async () => {
    expect((await call(director, user.PATCH, `/api/users/${headB.id}`, { method: "PATCH", id: headB.id, body: { name: "взлом" } })).status).toBe(404);
    expect((await call(director, user.PATCH, `/api/users/${director.id}`, { method: "PATCH", id: director.id, body: { role: "ADMIN" } })).status).toBe(403);
    expect((await call(head, user.PATCH, `/api/users/${head.id}`, { method: "PATCH", id: head.id, body: { role: "DIRECTOR" } })).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: headB.id } })).name).not.toBe("взлом");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: head.id } })).role).toBe("HEAD");
  });

  it("админ назначает и снимает директора; себя не разжалует; технического администратора не назначает", async () => {
    const set = (id: string, role: string) => call(curator, user.PATCH, `/api/users/${id}`, { method: "PATCH", id, body: { role } });
    expect((await set(headB.id, "DIRECTOR")).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: headB.id } })).role).toBe("DIRECTOR");
    expect((await set(headB.id, "HEAD")).status).toBe(200);
    expect((await set(headB.id, "SYSTEM_ADMIN")).status).toBe(403);
    const self = await set(curator.id, "HEAD");
    expect(self.status).toBe(400);
    expect(self.data.error).toBe("CANNOT_DEMOTE_SELF");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: curator.id } })).role).toBe("ADMIN");
    // человека нельзя перевести в другую дирекцию, пока за ним числятся позиции
    const busy = await prisma.operationalItem.create({ data: { title: `${TAG} занят`, responsibleId: headB.id, createdById: headB.id, directorateId: dirB } });
    created.items.push(busy.id);
    const move = await call(curator, user.PATCH, `/api/users/${headB.id}`, { method: "PATCH", id: headB.id, body: { directorateId: curator.directorateId } });
    expect(move.status).toBe(409);
    expect(move.data.error).toBe("HAS_ITEMS");
  });

  it("список людей: директор видит только свою дирекцию, e-mail виден управляющим, руководителю — нет", async () => {
    const d = await call(director, users.GET, "/api/users?all=1");
    expect(d.data.users.every((u: { directorateId: string | null }) => u.directorateId === director.directorateId)).toBe(true);
    expect(d.data.users.some((u: { id: string }) => u.id === headB.id)).toBe(false);
    expect(d.data.users[0].email).toBeTruthy();
    const h = await call(head, users.GET, "/api/users?all=1");
    expect(h.data.users[0].email).toBeUndefined();
    expect(h.data.users.some((u: { id: string }) => u.id === headB.id)).toBe(false);
  });
});

describe("цикл оперативки", () => {
  it("создаёт и ведёт цикл куратор (если активного цикла в базе нет)", async () => {
    if (await prisma.cycle.findFirst({ where: { status: { not: "FINAL" } } })) return; // не трогаем реальный цикл
    const deadline = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    expect((await call(head, cycles.POST, "/api/cycles", { method: "POST", body: { deadline } })).status).toBe(403);
    const ok = await call(curator, cycles.POST, "/api/cycles", { method: "POST", body: { deadline } });
    expect(ok.status).toBe(201);
    created.cycles.push(ok.data.id);
    expect((await call(curator, cycles.POST, "/api/cycles", { method: "POST", body: { deadline } })).status).toBe(409);

    const cur = await call(head, cyclesCurrent.GET, "/api/cycles/current");
    expect(cur.data.cycle.status).toBe("OPEN");
    expect(cur.data.summary.length).toBeGreaterThan(0);
    const mgmt = await call(management, cyclesCurrent.GET, "/api/cycles/current");
    expect(mgmt.data.cycle).toBeNull();

    expect((await call(head, cycleReview.POST, `/api/cycles/${ok.data.id}/review`, { method: "POST", id: ok.data.id })).status).toBe(403);
    expect((await call(curator, cycleReview.POST, `/api/cycles/${ok.data.id}/review`, { method: "POST", id: ok.data.id })).status).toBe(200);
    expect((await call(curator, cycleReview.POST, `/api/cycles/${ok.data.id}/review`, { method: "POST", id: ok.data.id })).status).toBe(409);
  });
});

describe("лента изменений: фильтры «Кто» и «Поле»", () => {
  const feed = async (qs: string) => (await call(head, recent.GET, `/api/items/recent-changes?limit=100&${qs}`)).data.events as Array<{ itemId: string; actorId: string | null; field: string | null; label: string | null }>;

  it("в ответе есть actorId, фильтр «Кто» оставляет только выбранного человека", async () => {
    const mine = (await feed(`actorIds=${head.id}`)).filter((e) => e.itemId === headItem);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.actorId === head.id)).toBe(true);
    const curators = (await feed(`actorIds=${curator.id}`)).filter((e) => e.itemId === headItem);
    expect(curators.every((e) => e.actorId === curator.id)).toBe(true);
    expect(curators.some((e) => e.actorId === head.id)).toBe(false);
  });

  it("фильтр «Поле» оставляет только выбранные поля; «Создание и архив» — события без поля", async () => {
    const comments = (await feed("fields=comment")).filter((e) => e.itemId === headItem);
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.every((e) => e.field === "comment")).toBe(true);
    const none = (await feed("fields=__none")).filter((e) => e.itemId === headItem);
    expect(none.length).toBeGreaterThan(0);
    expect(none.every((e) => e.field === null)).toBe(true);
    const both = (await feed("fields=comment,__none")).filter((e) => e.itemId === headItem);
    expect(both.every((e) => e.field === "comment" || e.field === null)).toBe(true);
  });

  it("фильтры сочетаются (пересечение)", async () => {
    const r = (await feed(`actorIds=${curator.id}&fields=comment`)).filter((e) => e.itemId === headItem);
    expect(r.every((e) => e.actorId === curator.id && e.field === "comment")).toBe(true);
    expect(r.length).toBeGreaterThan(0);
    const empty = await feed(`actorIds=${head.id}&fields=__none&segmentIds=none-such-segment`);
    expect(empty.filter((e) => e.itemId === headItem)).toEqual([]);
  });
});

describe("отчёт «Оперативки» и шаблоны", () => {
  const cfgAll = { columns: ["name", "owner", "status", "deadline", "comment"], groupBy: ["segment", "track"] };
  let personalId = "";
  let sharedId = "";

  it("отчёт по живым данным: сводка, дерево групп; руководство не строит рабочий отчёт", async () => {
    const r1 = await call(director, report.POST, "/api/report", { method: "POST", body: {} });
    expect(r1.status).toBe(200);
    expect(r1.data.model.summary.total).toBeGreaterThan(0);
    expect(Array.isArray(r1.data.model.groups)).toBe(true);
    expect(r1.data.model.directorate).toContain("Дирекция");
    expect((await call(management, report.POST, "/api/report", { method: "POST", body: {} })).status).toBe(403);
  });

  it("свои колонки/группировка/фильтры меняют отчёт; задача из теста попадает в него", async () => {
    if (!headItem) {
      // блок запускают и отдельно от остальных: тогда создаём свою тестовую позицию (она удалится в afterAll)
      const c = await call(director, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} для отчёта`, comment: "тест" } });
      expect(c.status).toBe(201);
      headItem = c.data.row.id;
      created.items.push(headItem);
    }
    const flat = await call(director, report.POST, "/api/report", { method: "POST", body: { config: { columns: ["name", "status"], groupBy: [], filters: { ownerIds: [head.id] } } } });
    expect(flat.status).toBe(200);
    expect(flat.data.model.groups).toBeNull();
    expect(JSON.stringify(flat.data.model.rows)).toContain(TAG);
    expect(flat.data.model.columns.map((c: { key: string }) => c.key)).toEqual(["name", "status"]);
    const bad = await call(director, report.POST, "/api/report", { method: "POST", body: { config: { columns: [], groupBy: [] } } });
    expect(bad.status).toBe(400);
  });

  it("шаблоны: строят директор и админ (личные и общие); руководитель, который заполняет таблицу, и ЗГД — нет", async () => {
    const mine = await call(director, templates.POST, "/api/report-templates", { method: "POST", body: { name: `${TAG} мой`, scope: "PERSONAL", config: cfgAll } });
    expect(mine.status).toBe(201);
    personalId = mine.data.template.id;
    created.templates.push(personalId);
    const shared = await call(director, templates.POST, "/api/report-templates", { method: "POST", body: { name: `${TAG} общий`, scope: "SHARED", config: cfgAll } });
    expect(shared.status).toBe(201);
    sharedId = shared.data.template.id;
    created.templates.push(sharedId);
    expect((await call(director, templates.POST, "/api/report-templates", { method: "POST", body: { name: "x", scope: "PERSONAL", config: { columns: [], groupBy: [] } } })).status).toBe(400);
    for (const who of [head, management]) {
      expect((await call(who, templates.POST, "/api/report-templates", { method: "POST", body: { name: "x", scope: "PERSONAL", config: cfgAll } })).status).toBe(403);
    }
  });

  it("видимость: общий видят директор и админ своей дирекции, личный — только владелец (даже админ чужой личный не видит)", async () => {
    const forDirector = (await call(director, templates.GET, "/api/report-templates")).data.templates as Array<{ id: string }>;
    expect(forDirector.some((t) => t.id === personalId)).toBe(true);
    expect(forDirector.some((t) => t.id === sharedId)).toBe(true);
    const forAdmin = (await call(curator, templates.GET, "/api/report-templates")).data.templates as Array<{ id: string }>;
    expect(forAdmin.some((t) => t.id === sharedId)).toBe(true);
    expect(forAdmin.some((t) => t.id === personalId)).toBe(false);
    expect((await call(head, templates.GET, "/api/report-templates")).data.templates).toEqual([]);
    // чужой личный шаблон нельзя ни открыть, ни построить по нему отчёт
    expect((await call(curator, report.POST, "/api/report", { method: "POST", body: { templateId: personalId } })).status).toBe(404);
    expect((await call(director, report.POST, "/api/report", { method: "POST", body: { templateId: personalId } })).status).toBe(200);
    expect((await call(curator, template.DELETE, `/api/report-templates/${personalId}`, { method: "DELETE", id: personalId })).status).toBe(404);
  });

  it("правка: общий меняют директор и админ, руководитель — нет; свой личный можно править, в том числе сделать общим", async () => {
    expect((await call(head, template.PATCH, `/api/report-templates/${sharedId}`, { method: "PATCH", id: sharedId, body: { name: "взлом" } })).status).toBe(403);
    expect((await call(curator, template.PATCH, `/api/report-templates/${sharedId}`, { method: "PATCH", id: sharedId, body: { name: `${TAG} общий 2` } })).status).toBe(200);
    expect((await call(director, template.PATCH, `/api/report-templates/${personalId}`, { method: "PATCH", id: personalId, body: { name: `${TAG} мой 2` } })).status).toBe(200);
  });

  it("выгрузка отчёта: Excel, PDF, CSV, PowerPoint по шаблону и по своей конфигурации", async () => {
    for (const f of ["xlsx", "pdf", "csv", "pptx"]) {
      const r = await call(director, exportReport.GET, `/api/export/report?format=${f}&templateId=${sharedId}`);
      expect(r.status).toBe(200);
      expect((await r.res.arrayBuffer()).byteLength).toBeGreaterThan(500);
    }
    const csv = await call(director, exportReport.GET, `/api/export/report?format=csv&config=${q(JSON.stringify({ columns: ["name"], groupBy: [], filters: { ownerIds: [head.id] } }))}`);
    expect(await csv.res.text()).toContain(TAG);
    expect((await call(director, exportReport.GET, "/api/export/report?format=doc")).status).toBe(400);
    expect((await call(director, exportReport.GET, "/api/export/report?format=csv&config=не-json")).status).toBe(400);
    expect((await call(director, exportReport.GET, "/api/export/report?format=csv&templateId=nope")).status).toBe(404);
    for (const who of [head, management]) expect((await call(who, exportReport.GET, "/api/export/report?format=csv")).status).toBe(403);
  });

  it("удаление шаблонов: чужой и общий шаблон руководитель не удалит, владелец и директор — удалят", async () => {
    expect((await call(head, template.DELETE, `/api/report-templates/${sharedId}`, { method: "DELETE", id: sharedId })).status).toBe(403);
    expect((await call(director, template.DELETE, `/api/report-templates/${personalId}`, { method: "DELETE", id: personalId })).status).toBe(200);
    expect((await call(curator, template.DELETE, `/api/report-templates/${sharedId}`, { method: "DELETE", id: sharedId })).status).toBe(200);
  });
});

describe("быстрая загрузка", () => {
  it("bootstrap отдаёт пользователя, справочники, свои колонки и общий вид одним запросом", async () => {
    const r = await call(head, bootstrap.GET, "/api/bootstrap");
    expect(r.status).toBe(200);
    expect(r.data.user.id).toBe(head.id);
    for (const k of ["segments", "tracks", "statuses", "attractiveness", "users", "columns"]) expect(Array.isArray(r.data[k])).toBe(true);
    expect(r.data.segments.length).toBeGreaterThan(0);
    expect("tableColumns" in r.data).toBe(true);
  });

  it("строки таблицы содержат имена справочников (кэш справочников подставляет их без join)", async () => {
    const rows = (await call(head, items.GET, "/api/items")).data.rows as Array<{ trackId: string | null; trackName: string | null; segmentId: string | null; segmentName: string | null; ownerId: string | null; ownerName: string | null }>;
    const withTrack = rows.filter((r) => r.trackId);
    expect(withTrack.length).toBeGreaterThan(0);
    expect(withTrack.every((r) => !!r.trackName)).toBe(true);
    expect(rows.filter((r) => r.ownerId).every((r) => !!r.ownerName)).toBe(true);
    expect(rows.filter((r) => r.segmentId).every((r) => !!r.segmentName)).toBe(true);
  });
});

describe("изоляция дирекций", () => {
  let itemA = "";
  let itemB = "";

  it("подготовка: по позиции в каждой дирекции", async () => {
    const a = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} изоляция A`, comment: "секрет A" } });
    expect(a.status).toBe(201);
    itemA = a.data.row.id;
    created.items.push(itemA);
    const b = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} изоляция B`, comment: "секрет B" } });
    expect(b.status).toBe(201);
    itemB = b.data.row.id;
    created.items.push(itemB);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: itemB } })).directorateId).toBe(dirB);
  });

  it("таблица, поиск, экспорт и отчёт показывают только свою дирекцию", async () => {
    const seenByB = await call(headB, items.GET, `/api/items?q=${q(TAG)}`);
    expect(rowIds(seenByB.data)).toContain(itemB);
    expect(rowIds(seenByB.data)).not.toContain(itemA);
    const seenByA = await call(head, items.GET, `/api/items?q=${q(TAG)}`);
    expect(rowIds(seenByA.data)).not.toContain(itemB);
    const csvB = await call(headB, exportTable.GET, "/api/export/table?format=csv");
    const text = await csvB.res.text();
    expect(text).toContain("изоляция B");
    expect(text).not.toContain("изоляция A");
    const repB = await call(directorB, report.POST, "/api/report", { method: "POST", body: {} });
    expect(repB.data.model.summary.total).toBe((await prisma.operationalItem.count({ where: { directorateId: dirB, archivedAt: null } })));
    expect(JSON.stringify(repB.data.model)).not.toContain("секрет A");
  });

  it("чужая позиция по идентификатору: чтение, правка, журнал, архив — 404", async () => {
    expect((await call(headB, item.GET, `/api/items/${itemA}`, { id: itemA })).status).toBe(404);
    expect((await call(directorB, item.PATCH, `/api/items/${itemA}`, { method: "PATCH", id: itemA, body: { version: 1, comment: "взлом" } })).status).toBe(404);
    expect((await call(headB, history.GET, `/api/items/${itemA}/history`, { id: itemA })).status).toBe(404);
    expect((await call(directorB, item.DELETE, `/api/items/${itemA}`, { method: "DELETE", id: itemA })).status).toBe(404);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: itemA } })).comment).toBe("секрет A");
  });

  it("нельзя привязать позицию к чужому сегменту, треку или человеку", async () => {
    const segA = await prisma.segment.findFirstOrThrow({ where: { directorateId: curator.directorateId }, select: { id: true } });
    const r1 = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} чужой сегмент`, segmentId: segA.id } });
    expect(r1.status).toBe(400);
    const r2 = await call(directorB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} чужой человек`, responsibleId: head.id } });
    expect(r2.status).toBe(400);
  });

  it("справочники и колонки у каждой дирекции свои", async () => {
    const segB = await call(directorB, segments.POST, "/api/segments", { method: "POST", body: { name: `${TAG} Сегмент B` } });
    expect(segB.status).toBe(201);
    const listA = await call(head, segments.GET, "/api/segments");
    expect(listA.data.segments.some((x: { name: string }) => x.name.includes(TAG))).toBe(false);
    const listB = await call(headB, segments.GET, "/api/segments");
    expect(listB.data.segments.map((x: { name: string }) => x.name)).toEqual([`${TAG} Сегмент B`]);
    // директор создаёт колонку только у себя
    const col = await call(directorB, columns.POST, "/api/columns", { method: "POST", body: { name: `${TAG} Колонка B`, type: "TEXT" } });
    expect(col.status).toBe(201);
    const colsA = await call(head, columns.GET, "/api/columns");
    expect(colsA.data.columns.some((c: { name: string }) => c.name.includes(TAG))).toBe(false);
    const colB = await prisma.customColumn.findFirstOrThrow({ where: { name: `${TAG} Колонка B` } });
    expect(colB.directorateId).toBe(dirB);
    expect((await call(director, column.DELETE, `/api/columns/${colB.id}`, { method: "DELETE", id: colB.id })).status).toBe(404);
    // bootstrap: своя дирекция и только её люди
    const boot = await call(headB, bootstrap.GET, "/api/bootstrap");
    expect(boot.data.directorate.id).toBe(dirB);
    expect(boot.data.users.every((u: { id: string }) => [directorB.id, headB.id].includes(u.id))).toBe(true);
  });

  it("лента изменений не показывает события чужой дирекции", async () => {
    const feedB = await call(directorB, recent.GET, "/api/items/recent-changes?limit=100");
    expect(feedB.data.events.every((e: { itemId: string }) => e.itemId !== itemA)).toBe(true);
    const feedA = await call(director, recent.GET, "/api/items/recent-changes?limit=100");
    expect(feedA.data.events.every((e: { itemId: string }) => e.itemId !== itemB)).toBe(true);
  });

  it("общий шаблон отчёта виден только своей дирекции", async () => {
    const c = await call(directorB, templates.POST, "/api/report-templates", { method: "POST", body: { name: `${TAG} общий B`, scope: "SHARED", config: { columns: ["name"], groupBy: [] } } });
    expect(c.status).toBe(201);
    created.templates.push(c.data.template.id);
    const listA = await call(director, templates.GET, "/api/report-templates");
    expect(listA.data.templates.some((t: { id: string }) => t.id === c.data.template.id)).toBe(false);
    const listB = await call(directorB, templates.GET, "/api/report-templates");
    expect(listB.data.templates.some((t: { id: string }) => t.id === c.data.template.id)).toBe(true);
    const viaA = await call(director, report.POST, "/api/report", { method: "POST", body: { templateId: c.data.template.id } });
    expect(viaA.status).toBe(404);
  });

  it("цикл у каждой дирекции свой; итог видит ЗГД (всех дирекций) и директор своей дирекции", async () => {
    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 5 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    const cycleB = start.data.id ?? start.data.cycle?.id;
    created.cycles.push(cycleB);
    // цикл дирекции B не мешает и не виден в дирекции A
    const curA = await call(director, cyclesCurrent.GET, "/api/cycles/current");
    expect(curA.data.cycle?.id).not.toBe(cycleB);
    // чужой директор не может вести цикл
    expect((await call(director, cycleReview.POST, `/api/cycles/${cycleB}/review`, { method: "POST", id: cycleB })).status).toBe(404);
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleB}/review`, { method: "POST", id: cycleB })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleB}/finalize`, { method: "POST", id: cycleB })).status).toBe(200);
    // ЗГД видит итог с названием дирекции; директор другой дирекции — нет
    const exec = await call(management, cyclesCurrent.GET, "/api/cycles/current");
    const found = exec.data.finals.find((f: { id: string }) => f.id === cycleB);
    expect(found.directorate).toContain(TAG);
    const other = await call(director, cyclesCurrent.GET, "/api/cycles/current");
    expect(other.data.finals.some((f: { id: string }) => f.id === cycleB)).toBe(false);
    expect((await call(management, cycleReport.POST, `/api/cycles/${cycleB}/report`, { method: "POST", id: cycleB, body: {} })).status).toBe(200);
    expect((await call(director, cycleReport.POST, `/api/cycles/${cycleB}/report`, { method: "POST", id: cycleB, body: {} })).status).toBe(404);
    expect((await call(headB, cycleReport.POST, `/api/cycles/${cycleB}/report`, { method: "POST", id: cycleB, body: {} })).status).toBe(404);
  });

  it("дирекции заводит только админ; ЗГД живых данных не видит", async () => {
    expect((await call(director, directorates.POST, "/api/directorates", { method: "POST", body: { name: `${TAG} нельзя` } })).status).toBe(403);
    expect((await call(management, items.GET, "/api/items")).data.rows).toEqual([]);
    const boot = await call(management, bootstrap.GET, "/api/bootstrap");
    expect(boot.data.segments).toEqual([]);
    expect(boot.data.users).toEqual([]);
  });
});

describe("руководитель, который заполняет таблицу: без «Оперативки», полоса цикла, заморозка при сборке", () => {
  let cycleId = "";
  let itemId = "";

  it("подготовка: цикл дирекции B, у руководителя подана позиция", async () => {
    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    cycleId = start.data.id;
    created.cycles.push(cycleId);
    const it1 = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} для заморозки`, operFlag: true } });
    expect(it1.status).toBe(201);
    itemId = it1.data.row.id;
    created.items.push(itemId);
  });

  it("сервер отдаёт руководителю только полосу цикла и его цифры (без чужих подач и итогов)", async () => {
    const r = await call(headB, cyclesCurrent.GET, "/api/cycles/current");
    expect(r.status).toBe(200);
    expect(r.data.cycle.id).toBe(cycleId);
    const total = await prisma.operationalItem.count({ where: { responsibleId: headB.id, archivedAt: null } });
    expect(r.data.mine).toEqual({ total, sent: 1 });
    expect(r.data.summary).toEqual([]);
    expect(r.data.finals).toEqual([]);
    // директору те же данные приходят полностью
    const d = await call(directorB, cyclesCurrent.GET, "/api/cycles/current");
    expect(d.data.summary.length).toBeGreaterThan(0);
  });

  it("отчёты, шаблоны и итоги руководителю закрыты", async () => {
    expect((await call(headB, report.POST, "/api/report", { method: "POST", body: {} })).status).toBe(403);
    expect((await call(headB, templates.GET, "/api/report-templates")).data.templates).toEqual([]);
    expect((await call(headB, templates.POST, "/api/report-templates", { method: "POST", body: { name: `${TAG} нельзя`, scope: "PERSONAL", config: { columns: ["name"], groupBy: [] } } })).status).toBe(403);
    expect((await call(headB, exportReport.GET, "/api/export/report?format=csv")).status).toBe(403);
  });

  it("во время сборки руководитель не меняет поданную позицию; после возврата с замечанием — снова может", async () => {
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    const cur = (await prisma.operationalItem.findUniqueOrThrow({ where: { id: itemId } })).version;
    const blocked = await call(headB, item.PATCH, `/api/items/${itemId}`, { method: "PATCH", id: itemId, body: { version: cur, comment: "правка во время сборки" } });
    expect(blocked.status).toBe(409);
    expect(blocked.data.error).toBe("LOCKED");
    const delLocked = await call(headB, item.DELETE, `/api/items/${itemId}`, { method: "DELETE", id: itemId });
    expect(delLocked.status).toBe(409);
    expect(delLocked.data.message).toMatch(/сборка/); // таблица показывает причину, а не «удалять может только автор»
    // и действием трекера (заблокировать, сдать) — тоже нет: иначе запрет обходится через доску
    const viaTracker = await call(headB, transition.POST, `/api/items/${itemId}/transition`, { method: "POST", id: itemId, body: { version: cur, action: "block", blockedBy: "жду ответа" } });
    expect(viaTracker.status).toBe(409);
    expect(viaTracker.data.error).toBe("LOCKED");
    // директор правит свободно
    const byDirector = await call(directorB, item.PATCH, `/api/items/${itemId}`, { method: "PATCH", id: itemId, body: { version: cur, comment: "поправил директор" } });
    expect(byDirector.status).toBe(200);
    // возврат с замечанием снимает «Опер» — позицию снова можно править
    expect((await call(directorB, ret.POST, `/api/items/${itemId}/return`, { method: "POST", id: itemId, body: { comment: "уточните срок" } })).status).toBe(200);
    const v = (await prisma.operationalItem.findUniqueOrThrow({ where: { id: itemId } })).version;
    const ok = await call(headB, item.PATCH, `/api/items/${itemId}`, { method: "PATCH", id: itemId, body: { version: v, comment: "исправил" } });
    expect(ok.status).toBe(200);
    // новую позицию руководитель создаёт и во время сборки
    const fresh = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} новая во время сборки` } });
    expect(fresh.status).toBe(201);
    created.items.push(fresh.data.row.id);
  });

  it("итог, отправленный директором, руководитель открыть не может, ЗГД — может", async () => {
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId })).status).toBe(200);
    // справка подтверждает для ЗГД каждую задачу дирекции полным снимком (блокер, отмена, сдача — не только поля таблицы)
    const pub = await prisma.itemPublication.findFirst({ where: { itemId, reason: "отправлена справка" } });
    expect(pub).not.toBeNull();
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: itemId } })).publishedAt?.getTime()).toBe(pub!.publishedAt.getTime());
    expect(await prisma.notification.count({ where: { type: "ZGD_UPDATE", message: { contains: "отправлена справка" } } })).toBe(0);
    expect((await call(headB, cycleReport.POST, `/api/cycles/${cycleId}/report`, { method: "POST", id: cycleId, body: {} })).status).toBe(404);
    expect((await call(management, cycleReport.POST, `/api/cycles/${cycleId}/report`, { method: "POST", id: cycleId, body: {} })).status).toBe(200);
    expect((await call(directorB, cycleReport.POST, `/api/cycles/${cycleId}/report`, { method: "POST", id: cycleId, body: {} })).status).toBe(200);
  });
});

describe("справка директора", () => {
  let cycleId = "";
  let trackA = "";
  let version = 0;
  const ids: string[] = [];

  it("вид справки: директор задаёт короткое название и отмеченные столбцы; чужие и руководитель не могут", async () => {
    const t = await call(directorB, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-трек справки` } });
    expect(t.status).toBe(201);
    trackA = t.data.track.id;
    created.tracks.push(trackA);
    const put = await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { shortName: "ТД", config: { fields: ["track", "comment"] } } });
    expect(put.status).toBe(200);
    const got = await call(directorB, memoSections.GET, "/api/memo-sections");
    expect(got.data.shortName).toBe("ТД");
    expect(got.data.config).toEqual({ fields: ["track", "comment"] });
    expect((await call(headB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { fields: ["comment"] } } })).status).toBe(403);
    expect((await call(headB, memoSections.GET, "/api/memo-sections")).status).toBe(403);
  });

  it("подготовка: цикл и подача руководителя (две позиции в разделе, одна без трека, одна не подана)", async () => {
    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    cycleId = start.data.id;
    created.cycles.push(cycleId);
    const mk = async (title: string, extra: object) => {
      const r = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} ${title}`, ...extra } });
      expect(r.status).toBe(201);
      created.items.push(r.data.row.id);
      ids.push(r.data.row.id);
    };
    await mk("п1", { trackId: trackA, operFlag: true, comment: "Первый комментарий." });
    await mk("п2", { trackId: trackA, operFlag: true, comment: "Второй комментарий." });
    await mk("п3", { operFlag: true, comment: "Без трека." });
    await mk("п4", { trackId: trackA, comment: "Не подана." });
  });

  it("черновик собирается из поданных позиций по структуре; не поданные — в «не вошло»", async () => {
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(r.status).toBe(200);
    version = r.data.version;
    const titles = r.data.doc.sections.map((x: { title: string }) => x.title);
    expect(titles[0]).toBe(`${TAG}-трек справки`); // раздел — сам трек, без ручной настройки
    expect(titles[titles.length - 1]).toBe("Прочие направления");
    expect(r.data.doc.sections[0].bullets.map((b: { text: string }) => b.text)).toEqual(["Первый комментарий.", "Второй комментарий."]);
    expect(r.data.notIncluded.map((i: { id: string }) => i.id)).toContain(ids[3]);
    expect(r.data.title).toBe("Статус текущих задач по дирекции ТД");
    expect(r.data.editable).toBe(true);
  });

  it("правка сохраняется по версии; устаревшая версия — 409; дата совещания попадает в заголовок", async () => {
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    const doc = r.data.doc;
    doc.sections[0].bullets[0] = { ...doc.sections[0].bullets[0], text: "Моя редакция первого пункта.", edited: true };
    const ok = await call(directorB, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc, version: r.data.version, meetingDate: "2026-09-21" } });
    expect(ok.status).toBe(200);
    version = ok.data.version;
    const stale = await call(directorB, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc, version: r.data.version } });
    expect(stale.status).toBe(409);
    expect(stale.data.error).toBe("CONFLICT");
    const again = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(again.data.title).toBe("Статус текущих задач по дирекции ТД к ОС 21.09.2026");
    expect(again.data.doc.sections[0].bullets[0].text).toBe("Моя редакция первого пункта.");
  });

  it("свежий комментарий: неправленный пункт обновляется сам, правленый только помечается", async () => {
    for (const [id, comment] of [[ids[0], "Новый первый."], [ids[1], "Новый второй."]] as const) {
      const v = (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).version;
      expect((await call(headB, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, comment } })).status).toBe(200);
    }
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    const [b1, b2] = r.data.doc.sections[0].bullets;
    expect(b1.text).toBe("Моя редакция первого пункта."); // правки директора не затёрты
    expect(r.data.flags[b1.id].sourceChanged).toBe(true);
    expect(b2.text).toBe("Новый второй."); // неправленный подтянулся сам
  });

  it("Оперативщик: только составители своей дирекции; пустой пункт и пустой вопрос — 400", async () => {
    const ask = (who: Actor, body: unknown) => call(who, memoAssist.POST, "/api/ai/memo-assist", { method: "POST", body });
    // руководитель (не составитель), ЗГД и директор чужой дирекции — справки не видят
    expect((await ask(headB, { cycleId, mode: "rewrite", text: "Текст" })).status).toBe(404);
    expect((await ask(management, { cycleId, mode: "rewrite", text: "Текст" })).status).toBe(404);
    expect((await ask(director, { cycleId, mode: "rewrite", text: "Текст" })).status).toBe(404);
    expect((await ask(directorB, { cycleId: "нет-такого", mode: "rewrite", text: "Текст" })).status).toBe(404);
    // директор своей дирекции: проверка запроса идёт до обращения к ИИ
    expect((await ask(directorB, { cycleId, mode: "rewrite", text: "   " })).status).toBe(400);
    expect((await ask(directorB, { cycleId, mode: "chat", messages: [] })).status).toBe(400);
    expect((await ask(directorB, { cycleId, mode: "что-то" })).status).toBe(400);
    // локальная модель: те же права, сервер отдаёт готовый запрос вместо ответа облака
    expect((await ask(director, { cycleId, mode: "rewrite", text: "Текст", engine: "local" })).status).toBe(404);
    const rw = await ask(directorB, { cycleId, mode: "rewrite", text: "Сделано 3 рейса.", style: "shorter", engine: "local" });
    expect(rw.status).toBe(200);
    expect(rw.data.local).toMatchObject({ kind: "rewrite", original: "Сделано 3 рейса." });
    expect(rw.data.local.messages.at(-1).content).toContain("Пункт: Сделано 3 рейса.");
    expect(rw.data.local.system).toContain("только на русском");
    // процессор: типовой вопрос — мгновенный разбор кодом, без модели
    const qc = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Проверь справку: где формулировки слабые" }], engine: "local", localDevice: "cpu" });
    expect(qc.status).toBe(200);
    expect(qc.data.local.kind).toBe("text");
    expect(qc.data.local.text.length).toBeGreaterThan(10);
    const lc = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Что главное?" }], engine: "local" });
    expect(lc.status).toBe(200);
    expect(lc.data.local.kind).toBe("stream");
    expect(lc.data.local.system.length).toBeGreaterThan(100);
    // поиск: удалённая позиция таблицы находится по слову из названия (в любой форме)
    const gone = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} Буксировка баржи Якорница` } });
    created.items.push(gone.data.row.id);
    expect((await call(headB, item.DELETE, `/api/items/${gone.data.row.id}`, { method: "DELETE", id: gone.data.row.id })).status).toBe(200);
    const sr = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Найди, что было по якорнице" }], engine: "local", localDevice: "cpu" });
    expect(sr.data.local.kind).toBe("text");
    expect(sr.data.local.text).toMatch(/\[Т1\] УДАЛЕНА — позиция «.*Якорница»/);
    const sg = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Найди, что было по якорнице" }], engine: "local" });
    expect(sg.data.local.task).toBe("search");
    expect(sg.data.local.system).toContain("НАЙДЕНО ПОИСКОМ");
    expect(sg.data.local.system).toContain("Якорница");
    // документы пунктов: поданная позиция с файлом попадает в справку — Оперативщик знает название, путь и даёт ссылку [Д1]
    const withDoc = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} Презентация Tidebon`, operFlag: true, comment: "Презентация вынесена на руководство.", files: [{ path: "\\\\10.10.51.51\\флот\\MPSV Tidebon v1.3.pptx" }] } });
    expect(withDoc.status).toBe(201);
    created.items.push(withDoc.data.row.id);
    const dq = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Где лежит презентация по Tidebon?" }], engine: "local", localDevice: "cpu" });
    expect(dq.data.local.kind).toBe("text");
    expect(dq.data.local.text).toMatch(/\[Д\d+\] «MPSV Tidebon v1\.3\.pptx»/);
    expect(dq.data.local.text).toContain("\\\\10.10.51.51\\флот\\MPSV Tidebon v1.3.pptx");
    expect(dq.data.local.docs.some((d: { i: string }) => d.i === withDoc.data.row.id)).toBe(true);
    const dg = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Где лежит презентация по Tidebon?" }], engine: "local" });
    expect(dg.data.local.system).toContain("ДОКУМЕНТЫ, прикреплённые");
    expect(dg.data.local.system).toContain("MPSV Tidebon v1.3.pptx");
    // движок фактов: таблица целиком, итоги и точная выборка (процессор — сразу списком, видеокарта — в запросе модели)
    const nq = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Какие позиции ещё не поданы в справку?" }], engine: "local", localDevice: "cpu" });
    expect(nq.data.local.kind).toBe("text");
    expect(nq.data.local.text).toMatch(/^Точная выборка по таблице \(не поданы в справку\)/);
    // вопрос-список — точный ответ программы и на видеокарте; вопрос «на подумать» — модели, с таблицей и итогами
    const ng = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Какие позиции ещё не поданы в справку?" }], engine: "local" });
    expect(ng.data.local.kind).toBe("text");
    const think = await ask(directorB, { cycleId, mode: "chat", messages: [{ role: "user", content: "Что горит и где нужно вмешательство руководства?" }], engine: "local" });
    expect(think.data.local.kind).toBe("stream");
    expect(think.data.local.system).toContain("ИТОГИ ПО ТАБЛИЦЕ");
    // ЗГД таблицу не видит — его поиск только по справкам
    const zs = await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { messages: [{ role: "user", content: "Найди якорницу" }], engine: "local", localDevice: "cpu" } });
    expect(JSON.stringify(zs.data)).not.toContain("Якорница");
    expect(lc.data.local.messages.at(-1).content).toMatch(/^Что главное\?\n\nЗадача: [\s\S]*Отвечай по-русски\.$/);
  });

  it("новая подача сама встаёт в собранную справку (с меткой «новая подача»), правки директора не трогаются", async () => {
    const r = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} п5`, trackId: trackA, operFlag: true, comment: "Пятый." } });
    created.items.push(r.data.row.id);
    const got = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    const fifth = got.data.doc.sections[0].bullets.find((b: { text: string }) => b.text === "Пятый.");
    expect(fifth).toBeTruthy();
    expect(fifth.fresh).toBe(true);
    expect(got.data.doc.sections[0].bullets[0].text).toBe("Моя редакция первого пункта.");
    // «Обновить» больше нечего добавлять
    expect((await call(directorB, memoRefresh.POST, `/api/cycles/${cycleId}/memo/refresh`, { method: "POST", id: cycleId })).data.added).toBe(0);
  });

  it("журнал правок: правки не директора — один сеанс, одно уведомление директору, метка «кто менял» на пункте", async () => {
    const editor = { ...headB, memoEditor: true };
    const unread = () => prisma.notification.count({ where: { userId: directorB.id, type: "CHANGE_ATTENTION", message: { contains: "правит черновик справки" } } });
    const n0 = await unread();
    for (const text of ["Правка составителя 1.", "Правка составителя 2."]) {
      const r = await call(editor, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
      const doc = r.data.doc;
      doc.sections[0].bullets[1] = { ...doc.sections[0].bullets[1], text, changedBy: "Подделка" };
      expect((await call(editor, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc, version: r.data.version } })).status).toBe(200);
    }
    expect(await unread()).toBe(n0 + 1); // два сохранения подряд — одно уведомление
    const got = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(got.data.doc.sections[0].bullets[1].changedBy).toBe(headB.name); // метку ставит сервер, подделка не прошла
    expect(got.data.doc.sections[0].bullets[0].changedBy).toBe(directorB.name);
    const h = await call(directorB, memoHistory.GET, `/api/cycles/${cycleId}/memo/history`, { id: cycleId });
    expect(h.status).toBe(200);
    const mine = h.data.entries.filter((e: { who: string; kind: string }) => e.who === headB.name && e.kind === "draft");
    expect(mine).toHaveLength(1);
    expect(mine[0].summary).toContain("изменено пунктов: 2");
    // правит сам директор — себе не уведомляем
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    r.data.doc.sections[0].bullets[1].text = "Правка директора.";
    expect((await call(directorB, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc: r.data.doc, version: r.data.version } })).status).toBe(200);
    expect(await unread()).toBe(n0 + 1);
    expect((await call(headB, memoHistory.GET, `/api/cycles/${cycleId}/memo/history`, { id: cycleId })).status).toBe(404);
  });

  it("правка чужой позиции — уведомление ответственному с перечнем полей; свою правку себе не шлём", async () => {
    const id = ids[2];
    const owner = (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).responsibleId;
    expect(owner).toBe(headB.id);
    const count = () => prisma.notification.count({ where: { userId: headB.id, link: { startsWith: `/table?item=${id}` } } });
    const n0 = await count();
    let v = (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).version;
    expect((await call(headB, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, comment: "Сам поправил." } })).status).toBe(200);
    expect(await count()).toBe(n0);
    v = (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).version;
    expect((await call(directorB, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, comment: "Директор поправил." } })).status).toBe(200);
    v = (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).version;
    expect((await call(directorB, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, comment: "Директор ещё раз." } })).status).toBe(200);
    expect(await count()).toBe(n0 + 1); // правки подряд — одно уведомление
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: headB.id, link: { startsWith: `/table?item=${id}` } }, orderBy: { createdAt: "desc" } });
    expect(n.link).toBe(`/table?item=${id}&dir=${dirB}`); // админ из другой дирекции переключится на нужную
    expect(n.message).toContain(directorB.name);
    expect(n.message).toContain("комментарий");
  });

  it("файлы: PDF и Word по справке", async () => {
    const pdf = await call(directorB, memoExport.GET, `/api/cycles/${cycleId}/memo/export?format=pdf`, { id: cycleId });
    expect(pdf.status).toBe(200);
    const pdfBytes = new Uint8Array(await pdf.res.arrayBuffer());
    expect(String.fromCharCode(...pdfBytes.slice(0, 4))).toBe("%PDF");
    expect(pdfBytes.length).toBeGreaterThan(1500);
    const docx = await call(directorB, memoExport.GET, `/api/cycles/${cycleId}/memo/export?format=docx`, { id: cycleId });
    expect(docx.status).toBe(200);
    const docxBytes = new Uint8Array(await docx.res.arrayBuffer());
    expect(String.fromCharCode(...docxBytes.slice(0, 2))).toBe("PK");
    expect((await call(directorB, memoExport.GET, `/api/cycles/${cycleId}/memo/export?format=doc`, { id: cycleId })).status).toBe(400);
  });

  it("доступ: руководитель, ЗГД и чужая дирекция справку не видят и не правят", async () => {
    for (const who of [headB, management, director, head]) {
      expect((await call(who, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId })).status).toBe(404);
      expect((await call(who, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc: { sections: [] }, version: version } })).status).toBe(404);
      expect((await call(who, memoExport.GET, `/api/cycles/${cycleId}/memo/export?format=pdf`, { id: cycleId })).status).toBe(404);
    }
  });

  it("после отправки (финал) черновик не меняется", async () => {
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId })).status).toBe(200);
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(r.data.editable).toBe(false);
    const put = await call(directorB, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc: r.data.doc, version: r.data.version } });
    expect(put.status).toBe(409);
    expect(put.data.error).toBe("BAD_STATE");
  });
});

describe("составитель справки и решение «в справку» из таблицы", () => {
  let cycleId = "";
  let itemSubmitted = "";
  let itemPlain = "";
  let compiler: Actor;

  it("составителя назначает только админ; директор и сам руководитель — нет", async () => {
    const setFlag = (who: Actor, on: boolean) => call(who, user.PATCH, `/api/users/${headB.id}`, { method: "PATCH", id: headB.id, body: { memoEditor: on } });
    expect((await setFlag(directorB, true)).status).toBe(403);
    expect((await setFlag(headB, true)).status).toBe(403);
    expect((await setFlag(curator, true)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: headB.id } })).memoEditor).toBe(true);
    compiler = { ...headB, memoEditor: true };
  });

  it("подготовка: цикл дирекции B, две позиции руководителя: одна подана, другая нет", async () => {
    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    cycleId = start.data.id;
    created.cycles.push(cycleId);
    const a = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} подана`, operFlag: true, comment: "Подана директору." } });
    const b = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} не подана`, comment: "Не подана." } });
    itemSubmitted = a.data.row.id;
    itemPlain = b.data.row.id;
    created.items.push(itemSubmitted, itemPlain);
  });

  it("составитель видит и правит справку, обычный руководитель — нет", async () => {
    expect((await call(compiler, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId })).status).toBe(200);
    expect((await call(headB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId })).status).toBe(404);
    const inc = await call(compiler, inclusion.GET, "/api/memo/inclusion");
    expect(inc.data.cycleId).toBe(cycleId);
    expect(inc.data.included).toContain(itemSubmitted);
    expect(inc.data.included).not.toContain(itemPlain);
    // обычному руководителю решения по справке не показываются
    expect((await call(headB, inclusion.GET, "/api/memo/inclusion")).data.cycleId).toBeNull();
  });

  it("решение из таблицы: неподанную включить нельзя, поданную исключить можно; повторная сборка её не возвращает", async () => {
    const on = await call(compiler, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemPlain, include: true } });
    expect(on.status).toBe(409);
    expect(on.data.error).toBe("NOT_SUBMITTED");
    // и в обход интерфейса — сохранением черновика с пунктом на неподанную строку
    const cur = await call(compiler, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    const forged = { ...cur.data.doc, sections: [...cur.data.doc.sections, { id: "s_forged", title: "X", kind: "section", bullets: [{ id: "b_forged", text: "x", itemIds: [itemPlain], origin: "auto", edited: false, hidden: false, sourceHash: "" }] }] };
    expect((await call(compiler, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc: forged, version: cur.data.version } })).status).toBe(400);
    const off = await call(compiler, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemSubmitted, include: false } });
    expect(off.status).toBe(200);
    const inc = await call(compiler, inclusion.GET, "/api/memo/inclusion");
    expect(inc.data.included).not.toContain(itemPlain);
    expect(inc.data.included).not.toContain(itemSubmitted);
    expect(inc.data.known).toContain(itemSubmitted); // решение принято: исключена, не «новая»
    const refresh = await call(compiler, memoRefresh.POST, `/api/cycles/${cycleId}/memo/refresh`, { method: "POST", id: cycleId });
    expect(refresh.data.added).toBe(0);
    // чужие и неподходящие запросы
    expect((await call(headB, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemPlain, include: false } })).status).toBe(404);
    expect((await call(director, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemPlain, include: false } })).status).toBe(404);
    expect((await call(compiler, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: "нет-такой", include: true } })).status).toBe(404);
    expect((await call(compiler, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemPlain } })).status).toBe(400);
  });

  it("своя строка директора (он ответственный): «в справку» сразу подаёт её; чужую неподанную — нельзя", async () => {
    const own = await call(directorB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} своя директора`, responsibleId: directorB.id, comment: "Своя." } });
    expect(own.status).toBe(201);
    created.items.push(own.data.row.id);
    expect(own.data.row.operFlag).toBe(false);
    const on = await call(directorB, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: own.data.row.id, include: true } });
    expect(on.status).toBe(200);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: own.data.row.id } })).operFlag).toBe(true);
    expect((await call(directorB, inclusion.GET, "/api/memo/inclusion")).data.included).toContain(own.data.row.id);
    // строка руководителя, которую он не подал, — по-прежнему нет
    const foreign = await call(directorB, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemPlain, include: true } });
    expect(foreign.status).toBe(409);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: itemPlain } })).operFlag).toBe(false);
    // не мешать подсчётам «кто подал» в следующих проверках
    await prisma.operationalItem.update({ where: { id: own.data.row.id }, data: { archivedAt: new Date() } });
  });

  it("снять флаг: руководитель снова обычный (доступ к справке пропадает)", async () => {
    expect((await call(curator, user.PATCH, `/api/users/${headB.id}`, { method: "PATCH", id: headB.id, body: { memoEditor: false } })).status).toBe(200);
    expect((await call(headB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId })).status).toBe(404);
    // закрываем цикл, чтобы не оставлять активный
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId })).status).toBe(200);
  });
});

describe("отправка справки ЗГД, архив, возврат", () => {
  let cycleId = "";
  let itemId = "";
  let versionId = "";
  const word = `уникальноеслово${Date.now().toString(36)}`;

  it("подготовка: цикл, поданная позиция, правка справки", async () => {
    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    cycleId = start.data.id;
    created.cycles.push(cycleId);
    const it1 = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} для архива`, operFlag: true, comment: `Подготовлено письмо ${word}.` } });
    expect(it1.status).toBe(201);
    itemId = it1.data.row.id;
    created.items.push(itemId);
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    const doc = r.data.doc;
    doc.sections[0].bullets[0] = { ...doc.sections[0].bullets[0], text: `Направлено письмо ${word} в адрес ГД.`, edited: true };
    expect((await call(directorB, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc, version: r.data.version, meetingDate: "2026-09-14" } })).status).toBe(200);
  });

  it("отправка ЗГД: справка фиксируется версией; руководитель отправить не может", async () => {
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    expect((await call(headB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId, body: { note: "Прошу принять." } })).status).toBe(403);
    const fin = await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId, body: { note: "Прошу принять." } });
    expect(fin.status).toBe(200);
    const v = await prisma.memoVersion.findFirstOrThrow({ where: { cycleId } });
    versionId = v.id;
    expect(v.revision).toBe(1);
    expect(v.note).toBe("Прошу принять.");
    expect(v.title).toContain("14.09.2026");
    // снимок не меняется от последующих правок данных
    expect(v.searchText).toContain(word.toLowerCase());
  });

  it("архив: список, поиск по словам, фильтр дат; доступ только своей дирекции и ЗГД", async () => {
    const all = await call(directorB, archive.GET, "/api/memo-archive");
    expect(all.status).toBe(200);
    const row = all.data.versions.find((x: { id: string }) => x.id === versionId);
    expect(row.revision).toBe(1);
    expect(row.bullets).toBe(1);
    const found = await call(directorB, archive.GET, `/api/memo-archive?q=${q(word)}`);
    expect(found.data.versions.map((x: { id: string }) => x.id)).toContain(versionId);
    expect(found.data.versions[0].matches[0].text).toContain(word);
    expect((await call(directorB, archive.GET, "/api/memo-archive?q=совсемнесуществующее")).data.versions).toHaveLength(0);
    expect((await call(directorB, archive.GET, "/api/memo-archive?from=2026-10-01")).data.versions.some((x: { id: string }) => x.id === versionId)).toBe(false);
    expect((await call(directorB, archive.GET, "/api/memo-archive?from=2026-09-01&to=2026-09-30")).data.versions.some((x: { id: string }) => x.id === versionId)).toBe(true);
    // ЗГД видит все дирекции, чужая дирекция и обычный руководитель — нет
    expect((await call(management, archive.GET, "/api/memo-archive")).data.versions.some((x: { id: string }) => x.id === versionId)).toBe(true);
    expect((await call(director, archive.GET, "/api/memo-archive")).data.versions.some((x: { id: string }) => x.id === versionId)).toBe(false);
    expect((await call(headB, archive.GET, "/api/memo-archive")).status).toBe(403);
    expect((await call(headB, archiveOne.GET, `/api/memo-archive/${versionId}`, { id: versionId })).status).toBe(404);
    expect((await call(director, archiveOne.GET, `/api/memo-archive/${versionId}`, { id: versionId })).status).toBe(404);
  });

  it("версия целиком и файлы; вернуть может только ЗГД", async () => {
    const d = await call(directorB, archiveOne.GET, `/api/memo-archive/${versionId}`, { id: versionId });
    expect(d.status).toBe(200);
    expect(d.data.version.note).toBe("Прошу принять.");
    expect(d.data.version.canReturn).toBe(false);
    expect(d.data.version.doc.sections[0].bullets[0].text).toContain(word);
    expect((await call(management, archiveOne.GET, `/api/memo-archive/${versionId}`, { id: versionId })).data.version.canReturn).toBe(true);
    for (const f of ["pdf", "docx"]) {
      const r = await call(directorB, archiveExport.GET, `/api/memo-archive/${versionId}/export?format=${f}`, { id: versionId });
      expect(r.status).toBe(200);
      expect((await r.res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }
    expect((await call(directorB, archiveReturn.POST, `/api/memo-archive/${versionId}/return`, { method: "POST", id: versionId, body: { comment: "x" } })).status).toBe(403);
    expect((await call(management, archiveReturn.POST, `/api/memo-archive/${versionId}/return`, { method: "POST", id: versionId, body: { comment: "  " } })).status).toBe(400);
  });

  it("таблица на дату отправки: вся таблица с пометками, не меняется от правок, права как у справки, выгрузка", async () => {
    const t = await call(directorB, archiveTable.GET, `/api/memo-archive/${versionId}/table`, { id: versionId });
    expect(t.status).toBe(200);
    expect(t.data.mode).toBe("full");
    expect(t.data.columns.some((c: { key: string }) => c.key === "operFlag" || c.key === "memo")).toBe(false);
    const mine = t.data.rows.find((r: { id: string }) => r.id === itemId);
    expect(mine).toMatchObject({ name: `${TAG} для архива`, submitted: true, inMemo: true });
    // вся таблица дирекции, а не только поданное
    const liveCount = await prisma.operationalItem.count({ where: { directorateId: directorB.directorateId!, archivedAt: null } });
    expect(t.data.rows).toHaveLength(liveCount);

    await prisma.operationalItem.update({ where: { id: itemId }, data: { title: `${TAG} для архива (переименовано)` } });
    const again = await call(directorB, archiveTable.GET, `/api/memo-archive/${versionId}/table`, { id: versionId });
    expect(again.data.rows.find((r: { id: string }) => r.id === itemId).name).toBe(`${TAG} для архива`);
    await prisma.operationalItem.update({ where: { id: itemId }, data: { title: `${TAG} для архива` } });

    expect((await call(management, archiveTable.GET, `/api/memo-archive/${versionId}/table`, { id: versionId })).status).toBe(200);
    expect((await call(headB, archiveTable.GET, `/api/memo-archive/${versionId}/table`, { id: versionId })).status).toBe(404);
    expect((await call(director, archiveTable.GET, `/api/memo-archive/${versionId}/table`, { id: versionId })).status).toBe(404);

    const x = await call(directorB, archiveTable.GET, `/api/memo-archive/${versionId}/table?format=xlsx&view=memo`, { id: versionId });
    expect(x.status).toBe(200);
    expect((await x.res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await call(directorB, archiveTable.GET, `/api/memo-archive/${versionId}/table?format=doc`, { id: versionId })).status).toBe(400);

    // уведомление ЗГД ведёт прямо на эту справку
    const executives = await prisma.user.count({ where: { role: "EXECUTIVE", isActive: true } });
    expect(await prisma.notification.count({ where: { type: "MEMO_SENT", link: `/operativka?tab=finals&memo=${versionId}` } })).toBe(executives);
  });

  it("ИИ у ЗГД: настройки только у ЗГД, ключ не возвращается, чат и сводка берут справки по id только доступные", async () => {
    const put = (who: Actor, body: unknown) => call(who, aiSettings.PUT, "/api/ai/settings", { method: "PUT", body });
    // руководитель направления — нельзя ничего
    expect((await call(headB, aiSettings.GET, "/api/ai/settings")).status).toBe(403);
    expect((await put(headB, { provider: "openai", apiKey: "k" })).status).toBe(403);
    expect((await call(headB, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [{ role: "user", content: "?" }] } })).status).toBe(403);
    // директор: свой «ИИ-помощник», но только по справкам своей дирекции; сводка дирекций — только у ЗГД
    for (const who of [directorB, director]) {
      expect((await call(who, aiSettings.GET, "/api/ai/settings")).status).toBe(200);
      expect((await call(who, aiConsolidate.POST, "/api/ai/consolidate", { method: "POST", body: { versionIds: [versionId] } })).status).toBe(403);
    }
    const foreign = await call(director, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [{ role: "user", content: "?" }], engine: "local" } });
    expect(foreign.status).toBe(400); // чужая справка не видна
    const own = await call(directorB, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [{ role: "user", content: "Какие вопросы мне зададут по справке?" }], engine: "local" } });
    expect(own.status).toBe(200);
    expect(own.data.local.system).toContain("помощник директора");
    expect(own.data.local.messages.at(-1).content).toContain("руководство (ЗГД) скорее всего задаст");
    // админ подключает ИИ себе так же, как ЗГД, но сводка из нескольких дирекций — только у ЗГД
    expect((await call(curator, aiSettings.GET, "/api/ai/settings")).status).toBe(200);
    expect((await call(curator, aiConsolidate.POST, "/api/ai/consolidate", { method: "POST", body: { versionIds: [versionId] } })).status).toBe(403);
    // без подключения: чат просит подключить ИИ, сводка — простая склейка
    expect((await call(management, aiSettings.GET, "/api/ai/settings")).data.configured).toBe(false);
    const noAi = await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [{ role: "user", content: "?" }] } });
    expect(noAi.status).toBe(409);
    // локальная модель работает и без облачного подключения: сервер отдаёт справку в запросе для браузера
    const local = await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [{ role: "user", content: "?" }], engine: "local" } });
    expect(local.status).toBe(200);
    expect(local.data.local.kind).toBe("stream");
    expect(local.data.local.system).toContain(word);
    expect(local.data.local.system).toContain("РАЗБОР");
    const quick = await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [{ role: "user", content: "Сроки: что просрочено?" }], engine: "local", localDevice: "cpu" } });
    expect(quick.data.local.kind).toBe("text");
    expect(quick.data.local.text).toContain("Просрочено:");
    expect((await call(headB, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [{ role: "user", content: "?" }], engine: "local" } })).status).toBe(403);
    const merged = await call(management, aiConsolidate.POST, "/api/ai/consolidate", { method: "POST", body: { versionIds: [versionId] } });
    expect(merged.data.aiUsed).toBe(false);
    expect(JSON.stringify(merged.data.topics)).toContain(word);

    // валидация и сохранение
    expect((await put(management, { provider: "gemini", apiKey: "k" })).status).toBe(400);
    expect((await put(management, { provider: "openai", baseUrl: "ftp://x", apiKey: "k" })).status).toBe(400);
    expect((await put(management, { provider: "openai" })).status).toBe(400); // ключа нет
    expect((await put(management, { provider: "openai", baseUrl: "https://ai.example/v1", model: "test-model", apiKey: "sk-SECRET-KEY-000000009999" })).status).toBe(200);
    const s = await call(management, aiSettings.GET, "/api/ai/settings");
    expect(s.data).toMatchObject({ configured: true, provider: "openai", baseUrl: "https://ai.example/v1", model: "test-model", keyHint: "…9999" });
    expect(JSON.stringify(s.data)).not.toContain("SECRET");
    expect((await prisma.aiSetting.findUniqueOrThrow({ where: { userId: management.id } })).apiKeyEnc).not.toContain("SECRET"); // в базе шифртекст
    // повторное сохранение без ключа ключ не стирает
    expect((await put(management, { provider: "openai", baseUrl: "https://ai.example/v1", model: "other" })).status).toBe(200);
    expect((await call(management, aiSettings.GET, "/api/ai/settings")).data.keyHint).toBe("…9999");

    // ИИ подменяем: ловим, что и куда уходит
    const seen: Array<{ url: string; auth: string | null; body: { messages: Array<{ role: string; content: string }> } }> = [];
    let reply: (url: string) => Response = () => new Response("", { status: 500 });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).authorization ?? null, body: JSON.parse(init.body as string) });
      return reply(url);
    });
    try {
      reply = () => Response.json({ choices: [{ message: { content: "ок" } }] });
      const test = await call(management, aiSettingsTest.POST, "/api/ai/settings/test", { method: "POST", body: { provider: "openai" } });
      expect(test.data).toMatchObject({ ok: true, model: "other" });
      expect(seen[0]).toMatchObject({ url: "https://ai.example/v1/chat/completions", auth: "Bearer sk-SECRET-KEY-000000009999" }); // сохранённый ключ подставился на сервере

      reply = () => new Response("no", { status: 401 });
      const bad = await call(management, aiSettingsTest.POST, "/api/ai/settings/test", { method: "POST", body: { provider: "openai", apiKey: "sk-wrong-key-000000000000" } });
      expect(bad.status).toBe(401);
      expect(JSON.stringify(bad.data)).not.toContain("wrong-key");
      // браузер подставил в поле ключа сохранённый пароль — к провайдеру не уходит, человеку понятная подсказка
      const calls = seen.length;
      const pwd = await call(management, aiSettingsTest.POST, "/api/ai/settings/test", { method: "POST", body: { provider: "openai", apiKey: "Maykov2026!" } });
      expect(pwd.status).toBe(400);
      expect(pwd.data.message).toContain("пароль");
      expect(seen.length).toBe(calls);

      // чат: контекст — справка, вопрос из истории; чужая (несуществующая) справка в контекст не попадает
      seen.length = 0;
      reply = () => new Response('data: {"choices":[{"delta":{"content":"Выжимка"}}]}\n\ndata: [DONE]\n', { headers: { "content-type": "text/event-stream" } });
      const chat = await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId, "нет-такой"], messages: [{ role: "user", content: "Сделай выжимку" }] } });
      expect(chat.status).toBe(200);
      expect(await chat.res.text()).toBe("Выжимка");
      const sys = seen[0].body.messages[0].content;
      expect(sys).toContain(word);
      expect(seen[0].body.messages.at(-1)).toEqual({ role: "user", content: "Сделай выжимку" });
      // справка не открыта — контекст: последние справки дирекций
      seen.length = 0;
      reply = () => new Response('data: {"choices":[{"delta":{"content":"ок"}}]}\n\n', { headers: { "content-type": "text/event-stream" } });
      const latest = await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { messages: [{ role: "user", content: "Что нового?" }] } });
      expect(latest.status).toBe(200);
      expect(await latest.res.text()).toBe("ок");
      expect(seen[0].body.messages[0].content).toContain("=== СПРАВКА:");
      expect((await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: ["нет-такой"], messages: [{ role: "user", content: "?" }] } })).status).toBe(400);
      expect((await call(management, aiChat.POST, "/api/ai/chat", { method: "POST", body: { versionIds: [versionId], messages: [] } })).status).toBe(400);

      // сводка через ИИ: ссылки на номера превращаются в справку и пункт; выдуманные номера отбрасываются
      reply = () => Response.json({ choices: [{ message: { content: JSON.stringify({ summary: "Главное", topics: [{ title: "Письма", items: [{ text: "Письмо направлено", refs: [1] }, { text: "Выдумка", refs: [500] }] }] }) } }] });
      const cons = await call(management, aiConsolidate.POST, "/api/ai/consolidate", { method: "POST", body: { versionIds: [versionId] } });
      expect(cons.data).toMatchObject({ aiUsed: true, summary: "Главное" });
      expect(cons.data.topics[0].items).toHaveLength(1);
      expect(cons.data.topics[0].items[0]).toMatchObject({ versionId, text: "Письмо направлено" });

      // ИИ упал — сводка всё равно есть (склейка) с пояснением
      reply = () => new Response("x", { status: 500 });
      const fallback = await call(management, aiConsolidate.POST, "/api/ai/consolidate", { method: "POST", body: { versionIds: [versionId] } });
      expect(fallback.data.aiUsed).toBe(false);
      expect(fallback.data.warning).toContain("склейка");
    } finally {
      vi.unstubAllGlobals();
    }

    // выгрузка сводки файлом
    for (const f of ["pdf", "docx"]) {
      const r = await call(management, aiConsolidateExport.POST, `/api/ai/consolidate/export?format=${f}`, { method: "POST", body: merged.data });
      expect(r.status).toBe(200);
      expect((await r.res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }
    expect((await call(directorB, aiConsolidateExport.POST, "/api/ai/consolidate/export?format=pdf", { method: "POST", body: merged.data })).status).toBe(403);

    expect((await call(management, aiSettings.DELETE, "/api/ai/settings", { method: "DELETE" })).status).toBe(200);
    expect((await call(management, aiSettings.GET, "/api/ai/settings")).data.configured).toBe(false);
  });

  it("возврат ЗГД: оперативка снова на «Сборке» (ред. 2), справка — копия, «Опер» вернулся; повторный возврат нельзя", async () => {
    const back = await call(management, archiveReturn.POST, `/api/memo-archive/${versionId}/return`, { method: "POST", id: versionId, body: { comment: "Уточните сроки" } });
    expect(back.status).toBe(200);
    const cyc = await prisma.cycle.findUniqueOrThrow({ where: { id: cycleId } });
    expect(cyc.status).toBe("IN_REVIEW");
    expect(cyc.revision).toBe(2);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: itemId } })).operFlag).toBe(true);
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(r.data.doc.sections[0].bullets[0].text).toContain(word);
    expect(r.data.editable).toBe(true);
    const detail = await call(directorB, archiveOne.GET, `/api/memo-archive/${versionId}`, { id: versionId });
    expect(detail.data.version.returnComment).toBe("Уточните сроки");
    expect(detail.data.version.canReturn).toBe(false);
    expect((await call(management, archiveReturn.POST, `/api/memo-archive/${versionId}/return`, { method: "POST", id: versionId, body: { comment: "ещё" } })).status).toBe(409);
    expect(await prisma.notification.count({ where: { userId: directorB.id, type: "MEMO_RETURNED" } })).toBe(1);
  });

  it("повторная отправка: новая ревизия, старая версия неизменна", async () => {
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    const doc = r.data.doc;
    doc.sections[0].bullets[0] = { ...doc.sections[0].bullets[0], text: `Исправлено: письмо ${word} направлено 15.09.`, edited: true };
    expect((await call(directorB, memo.PUT, `/api/cycles/${cycleId}/memo`, { method: "PUT", id: cycleId, body: { doc, version: r.data.version } })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId, body: {} })).status).toBe(200);
    const versions = await prisma.memoVersion.findMany({ where: { cycleId }, orderBy: { revision: "asc" } });
    expect(versions.map((x) => x.revision)).toEqual([1, 2]);
    expect(JSON.stringify(versions[0].doc)).toContain(`Направлено письмо ${word}`); // первая версия не изменилась
    expect(JSON.stringify(versions[1].doc)).toContain("Исправлено");
    const list = await call(directorB, archive.GET, "/api/memo-archive");
    const latest = list.data.versions.find((x: { id: string }) => x.id === versions[1].id);
    expect(latest.revision).toBe(2);
    expect(latest.revisions).toBe(2);
    // у каждой ревизии своя таблица на дату отправки
    expect(Array.isArray(versions[0].rows) && Array.isArray(versions[1].rows)).toBe(true);
  });

  it("старые справки без снимка таблицы: последняя ревизия — только поданные строки, промежуточная — «не сохранялась»", async () => {
    const versions = await prisma.memoVersion.findMany({ where: { cycleId }, orderBy: { revision: "asc" } });
    await prisma.memoVersion.updateMany({ where: { cycleId }, data: { rows: Prisma.DbNull, columns: Prisma.DbNull } });
    const first = await call(directorB, archiveTable.GET, `/api/memo-archive/${versions[0].id}/table`, { id: versions[0].id });
    expect(first.data.mode).toBe("none");
    const last = await call(directorB, archiveTable.GET, `/api/memo-archive/${versions[1].id}/table`, { id: versions[1].id });
    expect(last.data.mode).toBe("submitted");
    expect(last.data.rows.every((r: { submitted: boolean }) => r.submitted)).toBe(true);
    expect(last.data.rows.some((r: { id: string }) => r.id === itemId)).toBe(true);
  });
});

describe("вид справки: галочки задают и разделы, и текст пункта", () => {
  let cycleId = "";
  it("«трек + задача + комментарий + ответственный»: раздел = название трека, текст собирается по отмеченным столбцам", async () => {
    const put = await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { fields: ["track", "task", "comment", "owner"] } } });
    expect(put.status).toBe(200);
    const got = await call(directorB, memoSections.GET, "/api/memo-sections");
    expect(got.data.config).toEqual({ fields: ["track", "task", "comment", "owner"] });
    expect((await call(headB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { fields: ["comment"] } } })).status).toBe(403);
    expect((await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { fields: ["нет-такого"] } } })).status).toBe(400);

    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    cycleId = start.data.id;
    created.cycles.push(cycleId);
    const track = await prisma.track.findFirstOrThrow({ where: { directorateId: dirB, name: { contains: TAG } } });
    const it1 = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} авто`, trackId: track.id, operFlag: true, comment: "Комментарий." } });
    expect(it1.status).toBe(201);
    created.items.push(it1.data.row.id);
    const r = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(r.status).toBe(200);
    expect(r.data.doc.sections[0].title).toBe(track.name);
    expect(r.data.doc.sections[0].bullets[0].text).toBe(`${TAG} авто: Комментарий. (${headB.name})`);
    expect(r.data.unmappedTracks).toEqual([]);
  });

  it("сняли «Трек» — разделы по трекам пропадают, справка становится списком пунктов без заголовков", async () => {
    expect((await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { fields: ["comment"] } } })).status).toBe(200);
    const got = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(got.status).toBe(200);
    expect(got.data.doc.sections).toHaveLength(1);
    expect(got.data.doc.sections[0].title).toBe(""); // заголовка нет — в файл пойдут просто пункты
    expect(got.data.unmappedTracks).toEqual([]); // предупреждение про «трек не из структуры» тут неуместно
  });

  it("Сегмент и Трек можно отметить одновременно — оба идут в текст пункта; раздел всё равно по треку", async () => {
    expect((await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { fields: ["segment", "track", "comment"] } } })).status).toBe(200);
    const track = await prisma.track.findFirstOrThrow({ where: { directorateId: dirB, name: { contains: TAG } } });
    const r = await call(directorB, memoRefresh.POST, `/api/cycles/${cycleId}/memo/refresh`, { method: "POST", id: cycleId });
    expect(r.status).toBe(200);
    const got = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(got.data.doc.sections[0].title).toBe(track.name); // раздел не поменялся
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId })).status).toBe(200);
  });
});

describe("недели в «Общей таблице»", () => {
  let c2 = "";
  let c3 = "";
  const list = (who: Actor) => call(who, weeksList.GET, "/api/weeks");
  // call() отдаёт параметр как `id`, а у этого маршрута он называется `cycleId`
  const week = (who: Actor, id: string) => call(who, (req, ctx) => weekOne.GET(req, { params: ctx.params.then((p) => ({ cycleId: p.id })) }), `/api/weeks/${id}`, { id });

  it("список недель: только своя дирекция, новые сверху; у старой (без снимка) счётчиков нет", async () => {
    const r = await list(directorB);
    expect(r.status).toBe(200);
    expect(r.data.current).toBeNull();
    expect(r.data.weeks.length).toBeGreaterThanOrEqual(2);
    const nums = r.data.weeks.map((w: { number: number }) => w.number);
    expect(nums).toEqual([...nums].sort((a: number, b: number) => b - a));
    const newest = r.data.weeks[0];
    const oldest = r.data.weeks.find((w: { rowsCount: number | null }) => w.rowsCount === null); // цикл «отправка ЗГД, архив», у которого снимок стёрт
    c2 = newest.cycleId;
    expect(typeof newest.rowsCount).toBe("number");
    expect(newest.rowsCount).toBeGreaterThan(0);
    expect(oldest).toMatchObject({ rowsCount: null, submitted: null, inMemo: null, revisions: 2 });
    // доступ: руководитель своей дирекции видит; чужая дирекция — свои недели; ЗГД — нет
    expect((await list(headB)).status).toBe(200);
    expect((await list(director)).data.weeks.some((w: { cycleId: string }) => w.cycleId === c2)).toBe(false);
    expect((await list(management)).status).toBe(403);
  });

  it("неделя: таблица последней ревизии, предыдущая неделя старая — сравнения нет; чужое, ЗГД и незавершённое недоступны", async () => {
    const r = await week(directorB, c2);
    expect(r.status).toBe(200);
    expect(r.data.table.mode).toBe("full");
    expect(r.data.prev).not.toBeNull();
    expect(r.data.diff).toBeNull(); // у прошлой недели полного снимка нет
    expect((await week(headB, c2)).status).toBe(200);
    expect((await week(director, c2)).status).toBe(404);
    expect((await week(management, c2)).status).toBe(403);
    expect((await week(directorB, "нет-такой")).status).toBe(404);
    await prisma.cycle.update({ where: { id: c2 }, data: { status: "IN_REVIEW" } });
    expect((await week(directorB, c2)).status).toBe(404);
    await prisma.cycle.update({ where: { id: c2 }, data: { status: "FINAL" } });
  });

  it("руководителю — только «подано»: отметок «в справке» нет ни в таблице, ни в списке, ни в выгрузке", async () => {
    const lead = await week(headB, c2);
    expect(lead.data.memoVisible).toBe(false);
    expect(lead.data.table.rows.some((r: { inMemo: boolean }) => r.inMemo)).toBe(false);
    expect(lead.data.table.rows.some((r: { submitted: boolean }) => r.submitted)).toBe(true);
    expect((await list(headB)).data.weeks.every((w: { inMemo: number | null }) => w.inMemo === null)).toBe(true);
    const boss = await week(directorB, c2);
    expect(boss.data.memoVisible).toBe(true);
    expect(boss.data.table.rows.some((r: { inMemo: boolean }) => r.inMemo)).toBe(true);
    const x = await call(headB, (req, ctx) => weekOne.GET(req, { params: ctx.params.then((p) => ({ cycleId: p.id })) }), `/api/weeks/${c2}?format=csv&view=memo`, { id: c2 });
    expect(x.status).toBe(200);
    const csv = await x.res.text();
    expect(csv).not.toContain("В справке");
    expect(csv).toContain("Подано директору");
  });

  it("сравнение с прошлой неделей: новая, изменённая и убранная строки; правки после отправки в снимок не попадают", async () => {
    const changed = await prisma.operationalItem.findFirstOrThrow({ where: { directorateId: dirB, title: `${TAG} авто` } });
    // убираем из таблицы любую строку, которая была в прошлой неделе и ещё жива
    const prevRows = ((await prisma.memoVersion.findFirstOrThrow({ where: { cycleId: c2 }, orderBy: { revision: "desc" } })).rows as unknown as Array<{ id: string }>).map((x) => x.id);
    const removed = await prisma.operationalItem.findFirstOrThrow({ where: { id: { in: prevRows, not: changed.id }, directorateId: dirB, archivedAt: null } });
    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    c3 = start.data.id;
    created.cycles.push(c3);
    const fresh = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} новая на неделе`, operFlag: true, comment: "Новое." } });
    expect(fresh.status).toBe(201);
    created.items.push(fresh.data.row.id);
    await prisma.operationalItem.update({ where: { id: changed.id }, data: { comment: `Изменено на неделе ${TAG}` } });
    await prisma.operationalItem.update({ where: { id: removed.id }, data: { archivedAt: new Date() } });

    expect((await call(directorB, cycleReview.POST, `/api/cycles/${c3}/review`, { method: "POST", id: c3 })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${c3}/finalize`, { method: "POST", id: c3, body: {} })).status).toBe(200);
    await prisma.operationalItem.update({ where: { id: changed.id }, data: { comment: "правка уже после отправки" } });

    const r = await week(directorB, c3);
    expect(r.status).toBe(200);
    expect(r.data.prev.cycleId).toBe(c2);
    const d = r.data.diff;
    expect(d.rows[fresh.data.row.id]).toEqual({ kind: "new" });
    expect(d.rows[changed.id].kind).toBe("changed");
    expect(d.rows[changed.id].fields.map((f: { key: string }) => f.key)).toContain("comment");
    expect(d.removed.map((x: { id: string }) => x.id)).toContain(removed.id);
    expect(d.summary.new).toBe(1);
    expect(d.summary.removed).toBe(1);
    // в снимке недели значение на момент отправки
    expect(r.data.table.rows.find((x: { id: string }) => x.id === changed.id).comment).toBe(`Изменено на неделе ${TAG}`);
    expect((await list(directorB)).data.weeks[0].cycleId).toBe(c3);
  });

  it("возврат ЗГД возвращает «Опер» всем строкам, поданным в версии, а не только видимым в справке", async () => {
    const hiddenOne = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} подана но вне справки`, operFlag: false } });
    expect(hiddenOne.status).toBe(201);
    created.items.push(hiddenOne.data.row.id);
    const v = await prisma.memoVersion.findFirstOrThrow({ where: { cycleId: c3 }, orderBy: { revision: "desc" } });
    const rows = v.rows as unknown as Array<{ id: string; submitted: boolean }>;
    expect(rows.some((x) => x.id === hiddenOne.data.row.id)).toBe(false); // создана после отправки — в снимке её нет
    const snap = await prisma.operationalItem.findFirstOrThrow({ where: { directorateId: dirB, title: `${TAG} новая на неделе` } });
    await prisma.operationalItem.update({ where: { id: snap.id }, data: { operFlag: false } });
    // строка была подана в версии, но в справке её нет (пункт скрыт): «Опер» всё равно должен вернуться
    const doc = v.doc as unknown as { sections: Array<{ bullets: Array<{ itemIds: string[]; hidden?: boolean }> }> };
    for (const s of doc.sections) for (const b of s.bullets) if (b.itemIds.includes(snap.id)) b.hidden = true;
    await prisma.memoVersion.update({ where: { id: v.id }, data: { doc: doc as unknown as Prisma.InputJsonValue } });

    const back = await call(management, archiveReturn.POST, `/api/memo-archive/${v.id}/return`, { method: "POST", id: v.id, body: { comment: "Вернуть весь пакет" } });
    expect(back.status).toBe(200);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: snap.id } })).operFlag).toBe(true);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: hiddenOne.data.row.id } })).operFlag).toBe(false); // не подававшуюся не трогаем
    // неделя, вернувшаяся на доработку, из списка пропала (она снова текущая)
    const l = await list(directorB);
    expect(l.data.current.cycleId).toBe(c3);
    expect(l.data.weeks.some((w: { cycleId: string }) => w.cycleId === c3)).toBe(false);
    expect((await week(directorB, c3)).status).toBe(404);
    // закрываем, чтобы не мешать следующим проверкам
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${c3}/finalize`, { method: "POST", id: c3, body: {} })).status).toBe(200);
  });

  it("вернуть можно только последнюю отправленную неделю и только пока новой нет", async () => {
    const old = await prisma.memoVersion.findFirstOrThrow({ where: { cycleId: c2 }, orderBy: { revision: "desc" } });
    const r = await call(management, archiveReturn.POST, `/api/memo-archive/${old.id}/return`, { method: "POST", id: old.id, body: { comment: "старую" } });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("NOT_LATEST");
    expect((await prisma.cycle.findUniqueOrThrow({ where: { id: c2 } })).status).toBe("FINAL");
    expect((await call(management, archiveOne.GET, `/api/memo-archive/${old.id}`, { id: old.id })).data.version.canReturn).toBe(false);
    const latest = await prisma.memoVersion.findFirstOrThrow({ where: { cycleId: c3 }, orderBy: { revision: "desc" } });
    expect((await call(management, archiveOne.GET, `/api/memo-archive/${latest.id}`, { id: latest.id })).data.version.canReturn).toBe(true);
    // открыта новая оперативка — вернуть нельзя и последнюю
    const next = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    expect(next.status).toBe(201);
    created.cycles.push(next.data.id);
    expect((await call(management, archiveOne.GET, `/api/memo-archive/${latest.id}`, { id: latest.id })).data.version.canReturn).toBe(false);
    const blocked = await call(management, archiveReturn.POST, `/api/memo-archive/${latest.id}/return`, { method: "POST", id: latest.id, body: { comment: "x" } });
    expect(blocked.data.error).toBe("CYCLE_EXISTS");

    // подано во время сборки — само встаёт в справку, отправка не блокируется и подача не «сгорает» мимо справки
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${next.data.id}/review`, { method: "POST", id: next.data.id })).status).toBe(200);
    const late = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} подана во время сборки`, operFlag: true } });
    expect(late.status).toBe(201);
    created.items.push(late.data.row.id);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${next.data.id}/finalize`, { method: "POST", id: next.data.id, body: {} })).status).toBe(200);
    const v = await prisma.memoVersion.findFirstOrThrow({ where: { cycleId: next.data.id } });
    expect((v.rows as unknown as Array<{ id: string; inMemo: boolean }>).find((x) => x.id === late.data.row.id)?.inMemo).toBe(true);
  });
});

describe("админ, который подаёт как руководитель", () => {
  it("с флагом он в списке подачи и получает напоминание даже без позиций; без флага — нет; флаг меняет только админ", async () => {
    const u = await prisma.user.create({ data: { name: `${TAG} Админ-руководитель`, email: `${TAG}.adminhead@e2e.local`, passwordHash: "x", role: "ADMIN", directorateId: dirB } });
    testUserIds.push(u.id);
    let cyc = await prisma.cycle.findFirst({ where: { directorateId: dirB, status: "OPEN" } });
    const mineCycle = !cyc;
    if (!cyc) {
      await prisma.cycle.updateMany({ where: { directorateId: dirB, status: "IN_REVIEW" }, data: { status: "FINAL" } });
      const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
      expect(start.status).toBe(201);
      created.cycles.push(start.data.id);
      cyc = await prisma.cycle.findUniqueOrThrow({ where: { id: start.data.id } });
    }
    const inSummary = async () => ((await call(directorB, cyclesCurrent.GET, "/api/cycles/current")).data.summary as Array<{ id: string }>).some((p) => p.id === u.id);
    expect(await inSummary()).toBe(false); // как «Куратор (первичный)»: админ без позиций в подачу не входит
    const viewAsCall = () => call(directorB, viewAs.POST, "/api/view-as", { method: "POST", body: { userId: u.id } });
    expect((await viewAsCall()).status).toBe(403); // без флага директор не смотрит админа

    // включить может только админ; директор — нет
    expect((await call(directorB, user.PATCH, `/api/users/${u.id}`, { method: "PATCH", id: u.id, body: { submits: true } })).status).toBe(403);
    expect((await call(admin, user.PATCH, `/api/users/${u.id}`, { method: "PATCH", id: u.id, body: { submits: true } })).status).toBe(200);
    expect(await inSummary()).toBe(true);
    expect((await viewAsCall()).status).toBe(200); // с флагом — может (смотрит как руководителя)

    // напоминание приходит ему лично
    const r = await call(directorB, cycleRemind.POST, `/api/cycles/${cyc.id}/remind`, { method: "POST", id: cyc.id, body: { userIds: [u.id] } });
    expect(r.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: u.id, type: "SUBMISSION_MISSING" } })).toBe(1);

    // у себя он видит полосу «подано ваших X из Y»
    const mine = await call({ id: u.id, role: "ADMIN", name: u.name, directorateId: dirB, submits: true } as Actor, cyclesCurrent.GET, "/api/cycles/current");
    expect(mine.data.mine).toEqual({ total: 0, sent: 0 });

    // свою позицию он создаёт на себя: поданная засчитывается ему (найдено сквозной проверкой на проде 06.10.2026)
    const adminActor = { id: u.id, role: "ADMIN", name: u.name, directorateId: dirB, submits: true } as Actor;
    const own = await call(adminActor, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} позиция админа`, operFlag: true } });
    expect(own.status).toBe(201);
    created.items.push(own.data.row.id);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: own.data.row.id } })).responsibleId).toBe(u.id);
    expect((await call(adminActor, cyclesCurrent.GET, "/api/cycles/current")).data.mine).toEqual({ total: 1, sent: 1 });
    // свою оперативку закрываем, чтобы следующие проверки могли начать новую
    if (mineCycle) await prisma.cycle.update({ where: { id: cyc.id }, data: { status: "FINAL" } });
  });
});

describe("напоминания по расписанию", () => {
  it("без секрета Vercel Cron маршрут закрыт; с секретом — проходит", async () => {
    const run = (auth?: string) => cronReminders.GET(new NextRequest("http://localhost/api/cron/reminders", { headers: auth ? { authorization: auth } : {} }));
    const prev = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await run("Bearer ")).status).toBe(401);
      process.env.CRON_SECRET = "e2e-cron-secret";
      expect((await run()).status).toBe(401);
      expect((await run("Bearer wrong-secret-xx")).status).toBe(401);
      const ok = await run("Bearer e2e-cron-secret");
      expect(ok.status).toBe(200);
      expect(typeof (await ok.json()).cycles).toBe("number");
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});

describe("напоминание не подавшим", () => {
  let cycleId = "";
  const remindCall = (who: Actor, body?: unknown) => call(who, cycleRemind.POST, `/api/cycles/${cycleId}/remind`, { method: "POST", id: cycleId, body: body ?? {} });
  const mine = () => prisma.notification.count({ where: { userId: headB.id, type: "SUBMISSION_MISSING", message: { startsWith: "Напоминание · Оперативка" } } });

  it("директор напоминает: человек получает уведомление; повтор сразу не спамит; чужие и руководитель не могут", async () => {
    const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    cycleId = start.data.id;
    created.cycles.push(cycleId);

    expect((await remindCall(headB)).status).toBe(403); // руководитель
    expect((await remindCall(director)).status).toBe(404); // директор другой дирекции: цикла у него нет
    expect((await remindCall(management)).status).toBe(403);

    const before = await mine();
    const first = await remindCall(directorB, { userIds: [headB.id] });
    expect(first.status).toBe(200);
    expect(first.data).toMatchObject({ sent: 1, skippedRecent: 0 });
    expect(await mine()).toBe(before + 1);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: headB.id, type: "SUBMISSION_MISSING", message: { startsWith: "Напоминание" } }, orderBy: { createdAt: "desc" } });
    expect(n.link).toBe(`/table?dir=${dirB}`);
    expect(n.message).toContain("ещё ничего не отправили");

    // сразу повторно — не отправляется (защита от нажатий «по кругу»)
    expect((await remindCall(directorB, { userIds: [headB.id] })).data).toMatchObject({ sent: 0, skippedRecent: 1 });
    expect(await mine()).toBe(before + 1);
    // «всем» не трогает самого директора и тех, кому только что напомнили
    const all = await remindCall(directorB);
    expect(all.status).toBe(200);
    expect(all.data.skippedRecent).toBeGreaterThanOrEqual(1);
  });

  it("директор и админ без своих позиций не считаются «не подавшими»; с позициями — участвуют", async () => {
    const { cycleSummary } = await import("@/lib/cycles");
    const before = await cycleSummary(dirB);
    expect(before.some((p) => p.role === "DIRECTOR" && p.total === 0)).toBe(false);
    const own = await call(directorB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} позиция директора`, responsibleId: directorB.id } });
    expect(own.status).toBe(201);
    created.items.push(own.data.row.id);
    const after = await cycleSummary(dirB);
    expect(after.find((p) => p.id === directorB.id)).toMatchObject({ role: "DIRECTOR", total: 1, sent: 0 });
    await prisma.operationalItem.update({ where: { id: own.data.row.id }, data: { archivedAt: new Date() } });
  });

  it("кто уже подал — не получает напоминания; после отправки ЗГД напоминать нельзя", async () => {
    const it1 = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} для напоминания`, operFlag: true } });
    expect(it1.status).toBe(201);
    created.items.push(it1.data.row.id);
    await prisma.notification.deleteMany({ where: { userId: headB.id, message: { startsWith: "Напоминание" } } });
    expect((await remindCall(directorB, { userIds: [headB.id] })).data.sent).toBe(0);
    expect(await mine()).toBe(0);

    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId, body: {} })).status).toBe(200);
    expect((await remindCall(directorB)).status).toBe(409);
  });
});

describe("ограничение частоты запросов и защита от 500", () => {
  it("счётчик: лимит держится, окно сбрасывается, ключи независимы", async () => {
    const k = `${TAG}:rl`;
    const hits = [];
    for (let i = 0; i < 4; i++) hits.push(await hitRateLimit(k, 3, 600));
    expect(hits.map((h) => h.ok)).toEqual([true, true, true, false]);
    expect(hits[3].retryAfterSec).toBeGreaterThanOrEqual(1);
    expect((await hitRateLimit(`${k}:другой`, 3, 600)).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 700));
    expect((await hitRateLimit(k, 3, 600)).ok).toBe(true); // окно истекло — счёт с нуля
  });

  it("параллельные запросы считаются точно (нет гонки на счётчике)", async () => {
    const k = `${TAG}:race`;
    const res = await Promise.all(Array.from({ length: 20 }, () => hitRateLimit(k, 5, 60_000)));
    expect(res.filter((r) => r.ok)).toHaveLength(5);
  });

  it("запросы к ИИ ограничиваются по пользователю: после лимита 429 с Retry-After, у другого пользователя — нет", async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: management.id } } });
    const statuses: number[] = [];
    let last: Awaited<ReturnType<typeof call>> | null = null;
    for (let i = 0; i < 12; i++) {
      last = await call(management, aiSettingsTest.POST, "/api/ai/settings/test", { method: "POST", body: {} });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true); // ИИ не подключён — 409, но лимит уже считается
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(last!.res.headers.get("retry-after")).toBeTruthy();
    expect(last!.data.message).toContain("Слишком много");
    expect((await call(curator, aiSettingsTest.POST, "/api/ai/settings/test", { method: "POST", body: {} })).status).toBe(409);
    await prisma.rateLimit.deleteMany({ where: { key: { contains: management.id } } });
  });

  it("ЗГД без дирекции не получает 500 на справочниках дирекции — понятный 403", async () => {
    for (const [handler, url] of [[tracks.GET, "/api/tracks"], [tableColumns.GET, "/api/table-columns"]] as const) {
      const r = await call(management, handler as never, url);
      expect(r.status).toBe(403);
      expect(r.data).toEqual({ error: "NO_DIRECTORATE" });
    }
  });

  it("устаревшая/удалённая сессия даёт 401, а не 500", async () => {
    state.actor = null;
    const r = await tracks.GET(new NextRequest("http://localhost/api/tracks"));
    expect(r.status).toBe(401);
  });
});

describe("отзыв сессий и гонки", () => {
  it("isRevoked: токен, выданный до отзыва, недействителен; выданный после — действителен", async () => {
    const { isRevoked } = await import("@/lib/auth");
    const at = new Date("2026-09-24T10:00:00Z");
    const sec = Math.floor(at.getTime() / 1000);
    expect(isRevoked({ iat: sec - 60 }, at)).toBe(true);
    expect(isRevoked({ iat: sec }, at)).toBe(false); // вход в ту же секунду после смены пароля проходит
    expect(isRevoked({ iat: sec + 5 }, at)).toBe(false);
    expect(isRevoked({ iat: sec - 60 }, null)).toBe(false);
    expect(isRevoked({}, at)).toBe(true); // токен без времени выдачи после отзыва не принимаем
  });

  it("смена пароля, отключение и смена роли выставляют отметку отзыва сессий", async () => {
    const created = await call(curator, users.POST, "/api/users", { method: "POST", body: { name: `${TAG} revoke`, email: `${TAG}.revoke@e2e.local`, password: "Password-12345", role: "HEAD", directorateId: curator.directorateId } });
    expect(created.status).toBe(201);
    const uid = created.data.user.id;
    const get = async () => (await prisma.user.findUniqueOrThrow({ where: { id: uid }, select: { sessionsValidAfter: true } })).sessionsValidAfter;
    expect(await get()).toBeNull();
    expect((await call(curator, user.PATCH, `/api/users/${uid}`, { method: "PATCH", id: uid, body: { name: "Новое имя" } })).status).toBe(200);
    expect(await get()).toBeNull(); // обычная правка сессии не трогает
    expect((await call(curator, user.PATCH, `/api/users/${uid}`, { method: "PATCH", id: uid, body: { password: "Another-pass-777" } })).status).toBe(200);
    const first = await get();
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect((await call(curator, user.PATCH, `/api/users/${uid}`, { method: "PATCH", id: uid, body: { isActive: false } })).status).toBe(200);
    expect((await get())!.getTime()).toBeGreaterThan(first!.getTime());
  });

  it("десять одновременных «Начать оперативку» создают ровно одну активную оперативку", async () => {
    await prisma.cycle.deleteMany({ where: { directorateId: dirB!, status: { not: "FINAL" } } });
    const res = await Promise.all(Array.from({ length: 10 }, () => call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(9);
    const active = await prisma.cycle.findMany({ where: { directorateId: dirB!, status: { not: "FINAL" } }, select: { id: true } });
    expect(active).toHaveLength(1);
    created.cycles.push(active[0].id);
  });

  it("чужое уведомление «не существует» (404), а не «запрещено»", async () => {
    const n = await prisma.notification.create({ data: { userId: headB.id, type: "ITEM_RETURNED", message: `${TAG} чужое` } });
    expect((await call(head, notif.PATCH, `/api/notifications/${n.id}`, { method: "PATCH", id: n.id, body: { isRead: true } })).status).toBe(404);
    expect((await call(headB, notif.PATCH, `/api/notifications/${n.id}`, { method: "PATCH", id: n.id, body: { isRead: true } })).status).toBe(200);
  });
});

describe("сборка догоняет поданное", () => {
  it("справка открыта пустой, потом руководитель подал — «Начать сборку» добавляет поданное, правки директора не теряются", async () => {
    let cyc = await prisma.cycle.findFirst({ where: { directorateId: dirB, status: { not: "FINAL" } } });
    if (!cyc) {
      const start = await call(directorB, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 6 * 864e5).toISOString() } });
      expect(start.status).toBe(201);
      created.cycles.push(start.data.id);
      cyc = await prisma.cycle.findUniqueOrThrow({ where: { id: start.data.id } });
    }
    expect(cyc.status).toBe("OPEN");
    const first = await call(directorB, memo.GET, `/api/cycles/${cyc.id}/memo`, { id: cyc.id }); // черновик сохраняется на этом моменте
    const before = JSON.stringify(first.data.doc);
    const late = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} поданная позже`, operFlag: true, comment: `Позднее-${TAG}` } });
    expect(late.status).toBe(201);
    created.items.push(late.data.row.id);
    expect(before).not.toContain(`Позднее-${TAG}`);
    // директор успел отредактировать заголовок в черновике
    const doc = first.data.doc;
    doc.title = "Мой заголовок директора";
    expect((await call(directorB, memo.PUT, `/api/cycles/${cyc.id}/memo`, { method: "PUT", id: cyc.id, body: { doc, version: first.data.version } })).status).toBe(200);

    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cyc.id}/review`, { method: "POST", id: cyc.id })).status).toBe(200);
    const after = await call(directorB, memo.GET, `/api/cycles/${cyc.id}/memo`, { id: cyc.id });
    expect(JSON.stringify(after.data.doc)).toContain(`Позднее-${TAG}`); // поданное догнало
    expect(after.data.doc.title).toBe("Мой заголовок директора"); // правки не потеряны
  });
});

describe("дирекции: заведение, директор, роли, отключение, обзор ЗГД", () => {
  let dirC = "";
  let headC: Actor;
  const password = "Passw0rd-e2e";

  afterAll(async () => {
    if (!dirC) return;
    await prisma.notification.deleteMany({ where: { link: { contains: `dir=${dirC}` } } });
    await prisma.notification.deleteMany({ where: { user: { email: `${TAG}.headc@e2e.local` } } });
    await prisma.user.deleteMany({ where: { email: `${TAG}.headc@e2e.local` } });
    await prisma.track.deleteMany({ where: { directorateId: dirC } });
    await prisma.memoSection.deleteMany({ where: { directorateId: dirC } });
    await prisma.segment.deleteMany({ where: { directorateId: dirC } });
    await prisma.customColumn.deleteMany({ where: { directorateId: dirC } });
    await prisma.appSetting.deleteMany({ where: { key: `table.columns:${dirC}` } });
    await prisma.directorate.deleteMany({ where: { id: dirC } });
  });

  it("новая дирекция: короткое название и копия «Общей таблицы» другой дирекции — без позиций и людей", async () => {
    expect((await call(director, directorates.POST, "/api/directorates", { method: "POST", body: { name: `${TAG} Дирекция В` } })).status).toBe(403);
    const r = await call(admin, directorates.POST, "/api/directorates", { method: "POST", body: { name: `${TAG} Дирекция В`, shortName: "ДВ", copyFrom: dirB } });
    expect(r.status).toBe(201);
    dirC = r.data.directorate.id;
    const [tracksB, tracksC, segC, itemsC, peopleC] = await Promise.all([
      prisma.track.count({ where: { directorateId: dirB } }),
      prisma.track.findMany({ where: { directorateId: dirC }, include: { segment: true, memoSection: true } }),
      prisma.segment.count({ where: { directorateId: dirC } }),
      prisma.operationalItem.count({ where: { directorateId: dirC } }),
      prisma.user.count({ where: { directorateId: dirC } }),
    ]);
    expect(tracksB).toBeGreaterThan(0);
    expect(tracksC).toHaveLength(tracksB);
    expect(tracksC.every((t) => (!t.segment || t.segment.directorateId === dirC) && (!t.memoSection || t.memoSection.directorateId === dirC))).toBe(true);
    expect(segC).toBe(await prisma.segment.count({ where: { directorateId: dirB } }));
    expect(itemsC).toBe(0);
    expect(peopleC).toBe(0);
    expect((await prisma.directorate.findUniqueOrThrow({ where: { id: dirC } })).shortName).toBe("ДВ");

    const list = await call(admin, directorates.GET, "/api/directorates");
    const card = list.data.directorates.find((d: { id: string }) => d.id === dirC);
    expect(card).toMatchObject({ shortName: "ДВ", directors: [], people: 0, openCycle: null });
  });

  it("без директора уведомления о правках справки получают админы", async () => {
    const editor = { id: headB.id, name: `${TAG} составитель`, role: "HEAD" };
    await notifyDirectors(editor, { id: "x", number: 1, directorateId: dirC }, `${TAG} правка без директора`);
    const toAdmins = await prisma.notification.findMany({ where: { message: `${TAG} правка без директора` }, include: { user: { select: { role: true } } } });
    expect(toAdmins.length).toBeGreaterThan(0);
    expect(toAdmins.every((n) => n.user.role === "ADMIN")).toBe(true);
    expect(toAdmins[0].link).toBe(`/operativka?dir=${dirC}`);
  });

  it("роль и дирекция сходятся: руководителю дирекция обязательна, ЗГД — без дирекции", async () => {
    const r = await call(admin, users.POST, "/api/users", { method: "POST", body: { name: `${TAG} рук В`, email: `${TAG}.headc@e2e.local`, password, role: "HEAD", directorateId: dirC } });
    expect(r.status).toBe(201);
    headC = { id: r.data.user.id, name: r.data.user.name, role: "HEAD", directorateId: dirC };
    await prisma.user.update({ where: { id: headC.id }, data: { passwordHash: await hashPassword(password) } });
    const bad = await call(admin, user.PATCH, `/api/users/${headC.id}`, { method: "PATCH", id: headC.id, body: { directorateId: null } });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe("NEEDS_DIRECTORATE");
    // ЗГД: дирекция снимается сама; обратно руководителем без дирекции — нельзя
    expect((await call(admin, user.PATCH, `/api/users/${headC.id}`, { method: "PATCH", id: headC.id, body: { role: "EXECUTIVE" } })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: headC.id } })).directorateId).toBeNull();
    expect((await call(admin, user.PATCH, `/api/users/${headC.id}`, { method: "PATCH", id: headC.id, body: { role: "HEAD" } })).data.error).toBe("NEEDS_DIRECTORATE");
    expect((await call(admin, user.PATCH, `/api/users/${headC.id}`, { method: "PATCH", id: headC.id, body: { role: "HEAD", directorateId: dirC } })).status).toBe(200);
  });

  it("отключённая дирекция: её руководитель не входит и видит причину; включили — входит", async () => {
    let n = 0;
    const tryLogin = async () => {
      const req = new NextRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${n++}.1` },
        body: JSON.stringify({ email: `${TAG}.headc@e2e.local`, password }),
      });
      const res = await login.POST(req);
      return { status: res.status, data: await res.json() };
    };
    expect((await tryLogin()).status).toBe(200);
    expect((await call(admin, directorateOne.PATCH, `/api/directorates/${dirC}`, { method: "PATCH", id: dirC, body: { isActive: false } })).status).toBe(200);
    const off = await tryLogin();
    expect(off.status).toBe(403);
    expect(off.data.error).toBe("DIRECTORATE_DISABLED");
    expect((await call(admin, directorateOne.PATCH, `/api/directorates/${dirC}`, { method: "PATCH", id: dirC, body: { isActive: true, shortName: "" } })).status).toBe(200);
    expect((await tryLogin()).status).toBe(200);
    expect((await prisma.directorate.findUniqueOrThrow({ where: { id: dirC } })).shortName).toBeNull();
  });

  it("порядок дирекций: «выше» ставит дирекцию перед соседкой", async () => {
    const order = async () => (await prisma.directorate.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true } })).map((d) => d.id);
    const i = (await order()).indexOf(dirC);
    expect((await call(admin, directorateOne.PATCH, `/api/directorates/${dirC}`, { method: "PATCH", id: dirC, body: { move: "up" } })).status).toBe(200);
    expect((await order()).indexOf(dirC)).toBe(Math.max(0, i - 1));
  });

  it("ЗГД видит по каждой дирекции, прислала ли она справку на этой неделе; остальным обзор не отдаётся", async () => {
    const z = await call(management, archive.GET, "/api/memo-archive");
    expect(z.data.overview.find((d: { id: string }) => d.id === dirC)).toMatchObject({ lastSentAt: null, thisWeek: false });
    expect(z.data.overview.some((d: { thisWeek: boolean }) => d.thisWeek)).toBe(true); // дирекция Б отправляла в этих тестах
    expect((await call(directorB, archive.GET, "/api/memo-archive")).data.overview).toBeUndefined();
  });
});

describe("удалить навсегда из «Удалённых»", () => {
  it("только из «Удалённых»; директор и ответственный получают уведомление; позиция и её история стираются", async () => {
    const mk = async (title: string) => (await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} ${title}` } })).data.row.id as string;
    const purge = (who: Actor, id: string) => call(who, purgeRoute.POST, `/api/items/${id}/purge`, { method: "POST", id });

    // директор удаляет навсегда позицию руководителя — руководитель узнаёт
    const a = await mk("навсегда директором");
    expect((await purge(directorB, a)).status).toBe(409); // сначала — в «Удалённые»
    expect((await call(headB, item.DELETE, `/api/items/${a}`, { method: "DELETE", id: a })).status).toBe(200);
    expect((await purge(director, a)).status).toBe(404); // чужая дирекция
    expect((await purge(directorB, a)).status).toBe(200);
    expect(await prisma.operationalItem.findUnique({ where: { id: a } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityId: a } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: headB.id, message: { contains: "навсегда" }, AND: { message: { contains: "навсегда директором" } } } })).toBe(1);

    // руководитель удаляет навсегда свою — узнаёт директор; сам себе не уведомляет
    const b = await mk("навсегда руководителем");
    await call(headB, item.DELETE, `/api/items/${b}`, { method: "DELETE", id: b });
    expect((await purge(headB, b)).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: directorB.id, message: { contains: "навсегда руководителем" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: headB.id, message: { contains: "навсегда руководителем" } } })).toBe(0);
  });
});

describe("трекер: виды таблицы, «Выполнено» принимает директор", () => {
  const status = async (name: string) => (await prisma.status.findFirstOrThrow({ where: { name } })).id;
  let t = "";
  let version = 1;
  const patch = (a: Actor, body: Record<string, unknown>) => call(a, item.PATCH, `/api/items/${t}`, { method: "PATCH", id: t, body: { version, ...body } });

  it("трекер видят те, у кого есть таблица; ЗГД — по отправленным справкам, без черновиков; чужая дирекция не видна", async () => {
    const c = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} задача трекера` } });
    expect(c.status).toBe(201);
    t = c.data.row.id;
    created.items.push(t);
    const r = await call(head, tracker.GET, "/api/tracker");
    expect(r.status).toBe(200);
    expect(r.data.rows.some((x: { id: string }) => x.id === t)).toBe(true);
    expect(r.data.statuses.find((s: { name: string }) => s.name === "На проверке")?.trackerColumn).toBe("REVIEW");
    expect(r.data.events.some((e: { itemId: string; kind: string }) => e.itemId === t && e.kind === "created")).toBe(true);
    const z = await call(management, tracker.GET, "/api/tracker");
    expect(z.status).toBe(200);
    expect(z.data.mode).toBe("sent");
    // свежей позиции нет ни в одной отправленной справке — ЗГД её не видит
    expect(z.data.rows.some((x: { id: string }) => x.id === t)).toBe(false);
    const b = await call(directorB, tracker.GET, "/api/tracker");
    expect(b.data.rows.some((x: { id: string }) => x.id === t)).toBe(false);
  });

  it("формальная приёмка: прямо статус «На проверке»/«Завершено» не ставится; сдать с результатом → вернуть с причиной → сдать → принять", async () => {
    const tr = (a: Actor, body: Record<string, unknown>) => call(a, transition.POST, `/api/items/${t}/transition`, { method: "POST", id: t, body: { version, ...body } });
    const take = (r: { status: number; data: { row?: { version: number } } }) => {
      if (r.data.row) version = r.data.row.version;
      return r;
    };
    // прямая смена статуса в колонки приёмки — нельзя ни руководителю, ни директору
    expect((await patch(head, { statusId: await status("На проверке") })).status).toBe(403);
    expect((await patch(director, { statusId: await status("Завершено") })).status).toBe(403);
    // сдать без результата — 400; с результатом — ок
    expect((await tr(head, { action: "submit", result: "" })).status).toBe(400);
    expect(take(await tr(head, { action: "submit", result: "ТКП получено, письмо №12 в документах" })).status).toBe(200);
    // сдана — до решения директора руководитель её не правит и не удаляет
    const frozen = await patch(head, { comment: "дописал после сдачи" });
    expect(frozen.status).toBe(409);
    expect(frozen.data.error).toBe("LOCKED");
    const delFrozen = await call(head, item.DELETE, `/api/items/${t}`, { method: "DELETE", id: t });
    expect(delFrozen.status).toBe(409);
    expect(delFrozen.data.message).toMatch(/на проверке/);
    // руководитель не принимает; директор возвращает только с причиной
    expect((await tr(head, { action: "accept" })).status).toBe(403);
    expect((await tr(director, { action: "return", comment: "" })).status).toBe(400);
    expect(take(await tr(director, { action: "return", comment: "Нет сравнения цен" })).status).toBe(200);
    expect(take(await tr(head, { action: "submit", result: "Добавлено сравнение цен (таблица в документах)" })).status).toBe(200);
    const accepted = take(await tr(director, { action: "accept" }));
    expect(accepted.status).toBe(200);
    expect((accepted.data.row as { statusName?: string } | undefined)?.statusName).toBe("Завершено");
    // закрытую задачу руководитель не переоткрывает; история приёмки — в журнале и в «Ходе работы»
    expect((await tr(head, { action: "reopen", reason: "ещё раз" })).status).toBe(403);
    const wf = await call(director, workflow.GET, `/api/items/${t}/workflow`, { id: t });
    expect(wf.data.reviews.map((r: { decision: string }) => r.decision)).toEqual(["ACCEPTED", "RETURNED"]);
    expect(wf.data.publication?.reason).toBe("принял(а) задачу");
    const ev = (await call(director, tracker.GET, "/api/tracker")).data.events.filter((e: { itemId: string }) => e.itemId === t).map((e: { text: string }) => e.text);
    expect(ev).toEqual(expect.arrayContaining(["возвращена на доработку: Нет сравнения цен", expect.stringMatching(/^принята директором/)]));
    // директору пришло уведомление о сдаче
    expect(await prisma.notification.count({ where: { userId: director.id, type: "REVIEW_SUBMITTED" } })).toBeGreaterThan(0);
  });

  it("блокер — отдельным действием с причиной; перенос срока — только с причиной, исходный срок сохраняется", async () => {
    const c = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} задача со сроком`, deadline: "2026-11-01" } });
    const id = c.data.row.id;
    created.items.push(id);
    let v = c.data.row.version;
    const tr = async (body: Record<string, unknown>) => {
      const r = await call(head, transition.POST, `/api/items/${id}/transition`, { method: "POST", id, body: { version: v, ...body } });
      if (r.data.row) v = r.data.row.version;
      return r;
    };
    expect((await tr({ action: "block", blockedBy: "" })).status).toBe(400);
    // «На стопе» напрямую не ставится — только действием с причиной
    const stop = (await prisma.status.findFirstOrThrow({ where: { name: "На стопе" } })).id;
    const direct = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, statusId: stop } });
    expect(direct.status).toBe(403);
    expect(direct.data.message).toMatch(/Поставить на стоп/);
    const b = await tr({ action: "block", blockedBy: "решение ПАО", blockedUntil: "2026-10-20" });
    expect(b.status).toBe(200);
    expect(b.data.row.blockedBy).toBe("решение ПАО");
    expect(b.data.row.statusName).toBe("На стопе");
    // и напрямую не снимается
    const work = (await prisma.status.findFirstOrThrow({ where: { name: "В работе" } })).id;
    expect((await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, statusId: work } })).status).toBe(403);
    const ub = await tr({ action: "unblock" });
    expect(ub.data.row.blockedBy).toBeNull();
    expect(ub.data.row.statusName).toBe("В работе");
    const noReason = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, deadline: "2026-11-15" } });
    expect(noReason.status).toBe(400);
    const moved = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, deadline: "2026-11-15", deadlineReason: "ждём поставку" } });
    expect(moved.status).toBe(200);
    expect(String(moved.data.row.originalDeadline).slice(0, 10)).toBe("2026-11-01");
    expect(await prisma.auditEvent.count({ where: { entityId: id, fieldName: "deadlineReason", after: "ждём поставку" } })).toBe(1);
  });

  it("пункт меню: в bootstrap у руководителя и ЗГД есть; скрыть может только админ", async () => {
    expect((await call(head, bootstrap.GET, "/api/bootstrap")).data.tracker).toBe(true);
    expect((await call(management, bootstrap.GET, "/api/bootstrap")).data.tracker).toBe(true);
    expect((await call(director, tracker.PATCH, "/api/tracker", { method: "PATCH", body: { enabled: false } })).status).toBe(403);
    const before = await prisma.appSetting.findUnique({ where: { key: "tracker.enabled" } });
    try {
      expect((await call(curator, tracker.PATCH, "/api/tracker", { method: "PATCH", body: { enabled: false } })).status).toBe(200);
      expect((await call(head, bootstrap.GET, "/api/bootstrap")).data.tracker).toBe(false);
    } finally {
      if (before) await prisma.appSetting.update({ where: { key: "tracker.enabled" }, data: { value: before.value as object } });
      else await prisma.appSetting.deleteMany({ where: { key: "tracker.enabled" } });
    }
  });
});

describe("ЗГД в трекере: только подтверждённое директором; контроль, запрос статуса, поручение, перенос срока через директора", () => {
  // настоящий пользователь-ЗГД: журнал, комментарии и поручения ссылаются на автора (у общего тестового ЗГД записи в базе нет)
  const zgdUser: Actor = { id: "", role: "EXECUTIVE", name: `${TAG} ЗГД`, directorateId: null };
  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: `${TAG} ЗГД`, email: `${TAG}.zgd@e2e.local`, passwordHash: "x", role: "EXECUTIVE" } });
    zgdUser.id = u.id;
    testUserIds.push(u.id);
  });
  const zgdRows = async () => (await call(zgdUser, tracker.GET, "/api/tracker")).data.rows as Array<{ id: string; name: string; comment: string | null; statusName: string | null; blockedBy: string | null; zgdControl: boolean; origin: string | null; assignedById?: string | null; deadline: string | null; confirmedBy: string; openRequest?: boolean }>;
  const zgdAct = (a: Actor, body: Record<string, unknown>) => call(a, zgd.POST, "/api/zgd", { method: "POST", body });
  let id = "";
  let v = 1;

  it("ЗГД не видит задачу и её правки, пока директор не подтвердит («Обновить для ЗГД» / решение по задаче)", async () => {
    const c = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} задача для ЗГД`, deadline: "2026-12-01" } });
    id = c.data.row.id;
    v = c.data.row.version;
    created.items.push(id);
    expect((await zgdRows()).some((r) => r.id === id)).toBe(false);
    // подтверждать может только директор
    expect((await call(head, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [id] } })).status).toBe(403);
    expect((await call(director, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [id] } })).data.published).toBe(1);
    expect((await zgdRows()).find((r) => r.id === id)?.name).toBe(`${TAG} задача для ЗГД`);
    // руководитель поправил текст — у ЗГД прежнее, пока директор не подтвердит; повторное подтверждение без правок — пусто
    const e = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: v, title: `${TAG} задача для ЗГД (черновик)` } });
    v = e.data.row.version;
    expect((await zgdRows()).find((r) => r.id === id)?.name).toBe(`${TAG} задача для ЗГД`);
    expect((await call(director, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [id] } })).data.published).toBe(1);
    expect((await call(director, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [id] } })).data.published).toBe(0);
    const row = (await zgdRows()).find((r) => r.id === id)!;
    expect(row.name).toBe(`${TAG} задача для ЗГД (черновик)`);
    expect(row.confirmedBy).toMatch(/подтвердил\(а\) актуальность для ЗГД/);
  });

  it("на контроль и комментарий: директор и ответственный узнают; срок задачи на контроле руководитель не переносит сам", async () => {
    expect((await zgdAct(zgdUser, { action: "control", itemId: id, on: true })).status).toBe(200);
    expect((await zgdRows()).find((r) => r.id === id)?.zgdControl).toBe(true);
    expect((await zgdAct(zgdUser, { action: "comment", itemId: id, text: "Прошу ускорить" })).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: head.id, type: "ZGD_COMMENT" } })).toBeGreaterThan(0);
    const cur = await prisma.operationalItem.findUniqueOrThrow({ where: { id } });
    const moved = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: cur.version, deadline: "2026-12-20", deadlineReason: "не успеваем" } });
    expect(moved.status).toBe(403);
    // руководитель просит — директор согласует — срок меняется, ЗГД видит подтверждение
    expect((await zgdAct(head, { action: "deadline-request", itemId: id, newDeadline: "2026-12-20", reason: "ждём поставку" })).status).toBe(200);
    const req = await prisma.deadlineRequest.findFirstOrThrow({ where: { itemId: id, decision: null } });
    expect((await zgdAct(head, { action: "deadline-decide", requestId: req.id, approve: true })).status).toBe(403);
    expect((await zgdAct(director, { action: "deadline-decide", requestId: req.id, approve: true })).status).toBe(200);
    const after = await prisma.operationalItem.findUniqueOrThrow({ where: { id } });
    expect(after.deadline?.toISOString().slice(0, 10)).toBe("2026-12-20");
    expect(after.originalDeadline?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect((await zgdRows()).find((r) => r.id === id)?.deadline?.slice(0, 10)).toBe("2026-12-20");
  });

  it("запрос статуса: сигнал «Запрос ЗГД» до ответа; ответ директора подтверждает состояние и уходит ЗГД", async () => {
    expect((await zgdAct(zgdUser, { action: "request", itemId: id, text: "Где договор?", dueAt: "2026-10-01" })).status).toBe(200);
    const hot = (await call(director, tracker.GET, "/api/tracker")).data.hot[id];
    expect(hot.kinds).toContain("request");
    const q = await prisma.zgdRequest.findFirstOrThrow({ where: { itemId: id, answeredAt: null } });
    expect((await zgdAct(zgdUser, { action: "answer", requestId: q.id, answer: "сам себе" })).status).toBe(403);
    expect((await zgdAct(director, { action: "answer", requestId: q.id, answer: "Договор на подписи, будет 25.10" })).status).toBe(200);
    // спросивший получает ровно одно уведомление — ответ (без дубля «подтверждённое изменение» по задаче на контроле)
    expect(await prisma.notification.count({ where: { userId: zgdUser.id, type: "ZGD_ANSWER", link: { contains: id } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: zgdUser.id, type: "ZGD_UPDATE", message: { contains: "ответил(а) на запрос" }, link: { contains: id } } })).toBe(0);
    // директору — запрос; руководителю — комментарий ЗГД; самому ЗГД о своих действиях — ничего
    expect(await prisma.notification.count({ where: { userId: director.id, type: "ZGD_REQUEST", link: { contains: id } } })).toBe(1);
    expect((await call(director, tracker.GET, "/api/tracker")).data.hot[id]?.kinds ?? []).not.toContain("request");
    const ev = (await call(zgdUser, tracker.GET, "/api/tracker")).data.events.filter((e: { itemId: string }) => e.itemId === id).map((e: { text: string }) => e.text);
    expect(ev).toEqual(expect.arrayContaining([expect.stringMatching(/^ответил\(а\) на запрос ЗГД: Договор на подписи/)]));
  });

  it("ИИ ЗГД не видит неподтверждённого: ни в данных модели, ни в прямых ответах; действовать над ней ЗГД тоже не может", async () => {
    const secret = `${TAG} СЕКРЕТНЫЙ-ЧЕРНОВИК-${Date.now()}`;
    const c = await call(head, items.POST, "/api/items", { method: "POST", body: { title: secret, deadline: "2026-09-01" } });
    created.items.push(c.data.row.id);
    expect((await zgdAct(zgdUser, { action: "control", itemId: c.data.row.id, on: true })).status).toBe(404);
    expect((await zgdAct(zgdUser, { action: "request", itemId: c.data.row.id, text: "что там?" })).status).toBe(404);
    // модель (локальная: сервер отдаёт готовый запрос — видно всё, что ушло бы в модель) и прямой ответ программы
    for (const body of [
      { messages: [{ role: "user", content: "Что по задачам дирекции? Что просрочено и что горит?" }], engine: "local" },
      { messages: [{ role: "user", content: "Что застряло?" }], engine: "local", localDevice: "cpu" },
      { messages: [{ role: "user", content: "Найди черновик" }], engine: "local", localDevice: "cpu" },
    ]) {
      const r = await call(zgdUser, aiChat.POST, "/api/ai/chat", { method: "POST", body });
      expect([200, 400]).toContain(r.status);
      expect(JSON.stringify(r.data)).not.toContain("СЕКРЕТНЫЙ-ЧЕРНОВИК");
    }
    // задачу, которую ЗГД видел (было подтверждение), нельзя стереть навсегда — история решений сохраняется
    const seen = await prisma.operationalItem.findFirstOrThrow({ where: { id } });
    const del = await call(head, item.DELETE, `/api/items/${id}`, { method: "DELETE", id });
    expect(del.status).toBe(200);
    const purgeRes = await call(head, purgeRoute.POST, `/api/items/${id}/purge`, { method: "POST", id });
    expect(purgeRes.status).toBe(409);
    expect(purgeRes.data.error).toBe("HAS_DECISIONS");
    await call(head, restore.POST, `/api/items/${id}/restore`, { method: "POST", id });
    void seen;
    // у директора эта задача в данных ИИ есть (контрольная проверка, что тест вообще что-то ловит)
    const d = await call(director, aiChat.POST, "/api/ai/chat", { method: "POST", body: { messages: [{ role: "user", content: "Что просрочено?" }], engine: "local", localDevice: "cpu" } });
    expect(JSON.stringify(d.data)).toContain("СЕКРЕТНЫЙ-ЧЕРНОВИК");
  });

  it("поручение ЗГД: дирекция получает задачу без ответственного, на контроле; без результата или срока — нельзя; руководитель не даёт поручений", async () => {
    expect((await zgdAct(zgdUser, { action: "order", directorateId: curator.directorateId, title: `${TAG} поручение`, expectedResult: "", deadline: "2027-11-30" })).status).toBe(400);
    expect((await zgdAct(head, { action: "order", directorateId: curator.directorateId, title: `${TAG} поручение`, expectedResult: "Справка по флоту", deadline: "2027-11-30" })).status).toBe(403);
    const o = await zgdAct(zgdUser, { action: "order", directorateId: curator.directorateId, title: `${TAG} поручение`, expectedResult: "Справка по флоту", deadline: "2027-11-30" });
    expect(o.status).toBe(200);
    created.items.push(o.data.id);
    const it = await prisma.operationalItem.findUniqueOrThrow({ where: { id: o.data.id } });
    expect(it).toMatchObject({ origin: "ZGD", zgdControl: true, responsibleId: null, expectedResult: "Справка по флоту" });
    expect((await zgdRows()).find((r) => r.id === o.data.id)?.origin).toBe("ZGD");
    expect(await prisma.notification.count({ where: { userId: director.id, type: "ZGD_ORDER", link: { contains: o.data.id } } })).toBe(1);
    // ЗГД не получает уведомление о собственном поручении
    expect(await prisma.notification.count({ where: { userId: zgdUser.id, link: { contains: o.data.id } } })).toBe(0);
  });

  it("поручение ЗГД сразу сотруднику: исполнитель и директор узнают; сотрудник чужой дирекции — нельзя", async () => {
    const bad = await zgdAct(zgdUser, { action: "order", directorateId: curator.directorateId, title: `${TAG} поручение чужому`, expectedResult: "Результат", deadline: "2027-11-30", responsibleId: headB.id });
    expect(bad.status).toBe(400);
    const o = await zgdAct(zgdUser, { action: "order", directorateId: curator.directorateId, title: `${TAG} поручение сотруднику`, expectedResult: "Результат", deadline: "2027-11-30", responsibleId: head.id });
    expect(o.status).toBe(200);
    created.items.push(o.data.id);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: o.data.id } })).responsibleId).toBe(head.id);
    expect(await prisma.notification.count({ where: { userId: head.id, type: "ZGD_ORDER", link: { contains: o.data.id } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: director.id, type: "ZGD_ORDER", link: { contains: o.data.id } } })).toBe(1);
  });

  it("поручение директора сотруднику: только директор, исполнитель обязателен и из своей дирекции, метка «поручение директора»", async () => {
    const body = { action: "director-order", responsibleId: head.id, title: `${TAG} поручение директора`, expectedResult: "Таблица загрузки", deadline: "2027-11-20" };
    expect((await zgdAct(head, body)).status).toBe(403);
    expect((await zgdAct(zgdUser, body)).status).toBe(403);
    expect((await zgdAct(director, { ...body, responsibleId: headB.id })).status).toBe(400);
    expect((await zgdAct(director, { ...body, expectedResult: "" })).status).toBe(400);
    const o = await zgdAct(director, body);
    expect(o.status).toBe(200);
    created.items.push(o.data.id);
    expect(await prisma.operationalItem.findUniqueOrThrow({ where: { id: o.data.id } })).toMatchObject({ origin: "DIRECTOR", responsibleId: head.id, zgdControl: false, expectedResult: "Таблица загрузки" });
    expect(await prisma.notification.count({ where: { userId: head.id, type: "ZGD_ORDER", link: { contains: o.data.id } } })).toBe(1);
    // у ЗГД — только после подтверждения директором
    expect((await zgdRows()).some((r) => r.id === o.data.id)).toBe(false);
    // исполнитель видит поручение в своих задачах и может сдать его на проверку
    const row = (await call(head, tracker.GET, "/api/tracker")).data.rows.find((r: { id: string }) => r.id === o.data.id);
    expect(row?.origin).toBe("DIRECTOR");
  });

  it("срок поручения директора руководитель не переносит сам; директор сам сменил срок — просьба закрыта; решения и ответы — один раз", async () => {
    const o = await zgdAct(director, { action: "director-order", responsibleId: head.id, title: `${TAG} поручение со сроком`, expectedResult: "Расчёт", deadline: "2027-11-20" });
    expect(o.status).toBe(200);
    const oid = o.data.id as string;
    created.items.push(oid);
    let cur = await prisma.operationalItem.findUniqueOrThrow({ where: { id: oid } });
    expect((await call(head, item.PATCH, `/api/items/${oid}`, { method: "PATCH", id: oid, body: { version: cur.version, deadline: "2026-12-01", deadlineReason: "не успеваем" } })).status).toBe(403);
    expect((await zgdAct(head, { action: "deadline-request", itemId: oid, newDeadline: "2026-12-01", reason: "ждём данные" })).status).toBe(200);
    expect((await call(director, tracker.GET, "/api/tracker")).data.hot[oid]?.kinds ?? []).toContain("deadlineRequest");
    // директор сам поставил свой срок — висящая просьба закрыта, сигнал снят
    cur = await prisma.operationalItem.findUniqueOrThrow({ where: { id: oid } });
    expect((await call(director, item.PATCH, `/api/items/${oid}`, { method: "PATCH", id: oid, body: { version: cur.version, deadline: "2026-11-25", deadlineReason: "даю неделю" } })).status).toBe(200);
    const req = await prisma.deadlineRequest.findFirstOrThrow({ where: { itemId: oid } });
    expect(req.decision).toBe("CLOSED");
    expect(req.decidedByName).toBeTruthy();
    expect((await call(director, tracker.GET, "/api/tracker")).data.hot[oid]?.kinds ?? []).not.toContain("deadlineRequest");
    expect((await zgdAct(director, { action: "deadline-decide", requestId: req.id, approve: true })).status).toBe(409);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: oid } })).deadline?.toISOString().slice(0, 10)).toBe("2026-11-25");
    // на запрос ЗГД отвечают один раз
    const answered = await prisma.zgdRequest.findFirstOrThrow({ where: { itemId: id, answeredAt: { not: null } } });
    expect((await zgdAct(director, { action: "answer", requestId: answered.id, answer: "ещё один ответ" })).status).toBe(409);
  });

  it("решение директора уходит ЗГД без черновых правок карточки; у директора задача остаётся «не подтверждена»; «Мои поручения»", async () => {
    const before = (await zgdRows()).find((r) => r.id === id)!;
    const cur = await prisma.operationalItem.findUniqueOrThrow({ where: { id } });
    const e = await call(head, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: cur.version, comment: `${TAG} черновик руководителя` } });
    expect(e.status).toBe(200);
    const b = await call(director, transition.POST, `/api/items/${id}/transition`, { method: "POST", id, body: { version: e.data.row.version, action: "block", blockedBy: "решение ПАО" } });
    expect(b.status).toBe(200);
    const after = (await zgdRows()).find((r) => r.id === id)!;
    expect(after.statusName).toBe("На стопе");
    expect(after.blockedBy).toBe("решение ПАО");
    expect(after.comment).toBe(before.comment); // черновик руководителя ЗГД не ушёл
    const live = await prisma.operationalItem.findUniqueOrThrow({ where: { id } });
    expect(live.updatedAt.getTime()).toBeGreaterThan(live.publishedAt!.getTime());
    // снять со стопа, чтобы следующие проверки шли с задачей в работе
    expect((await call(director, transition.POST, `/api/items/${id}/transition`, { method: "POST", id, body: { version: live.version, action: "unblock" } })).status).toBe(200);
    // «Мои поручения»: у ЗГД видно, кто дал поручение
    const mine = (await zgdRows()).filter((r) => r.origin === "ZGD" && r.assignedById === zgdUser.id);
    expect(mine.length).toBeGreaterThan(0);
  });

  it("исполнитель не переписывает формулировку и ожидаемый результат поручения; ход работы — в комментарии; директор может", async () => {
    const o = await zgdAct(director, { action: "director-order", responsibleId: head.id, title: `${TAG} поручение с формулировкой`, expectedResult: "Справка по флоту", deadline: "2027-12-10" });
    expect(o.status).toBe(200);
    const oid = o.data.id as string;
    created.items.push(oid);
    let cur = await prisma.operationalItem.findUniqueOrThrow({ where: { id: oid } });
    const put = (a: Actor, body: Record<string, unknown>) => call(a, item.PATCH, `/api/items/${oid}`, { method: "PATCH", id: oid, body: { version: cur.version, ...body } });
    expect((await put(head, { title: "Сделать что-то попроще" })).status).toBe(403);
    expect((await put(head, { expectedResult: "Устный доклад" })).status).toBe(403);
    // та же формулировка (карточка шлёт все поля) и комментарий — можно
    const ok = await put(head, { title: `${TAG} поручение с формулировкой`, expectedResult: "Справка по флоту", comment: "Собрали данные по 3 судам" });
    expect(ok.status).toBe(200);
    cur = await prisma.operationalItem.findUniqueOrThrow({ where: { id: oid } });
    expect((await put(director, { expectedResult: "Справка по флоту и предложения" })).status).toBe(200);
  });

  it("сводка за неделю: директору — что ждёт приёмки, ЗГД — его поручения; повторный запуск не дублирует", async () => {
    const c = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} ждёт приёмки (сводка)` } });
    created.items.push(c.data.row.id);
    const sub = await call(head, transition.POST, `/api/items/${c.data.row.id}/transition`, { method: "POST", id: c.data.row.id, body: { version: c.data.row.version, action: "submit", result: "Отчёт в документах" } });
    expect(sub.status).toBe(200);
    const monday = new Date(Date.now() + ((8 - new Date(Date.now() + 3 * 3600e3).getUTCDay()) % 7) * 864e5);
    const since = new Date(Date.now() - 60000);
    await prisma.appSetting.deleteMany({ where: { key: "weekly.digest.week" } }); // отметка недели от прошлого прогона мешала бы
    try {
      const first = await sendWeeklyDigests(monday);
      expect(first.directors).toBeGreaterThan(0);
      const dir = await prisma.notification.findFirst({ where: { userId: director.id, type: "WEEKLY_UPDATE_DUE", createdAt: { gte: since } } });
      expect(dir?.message).toMatch(/ждут вашей приёмки — \d+/);
      expect(dir?.link).toContain("kind=review");
      const z = await prisma.notification.findFirst({ where: { userId: zgdUser.id, type: "WEEKLY_UPDATE_DUE", createdAt: { gte: since } } });
      expect(z?.message).toMatch(/^Сводка за неделю: в работе/);
      expect(z?.link).toContain("scope=mine");
      const before = await prisma.notification.count({ where: { type: "WEEKLY_UPDATE_DUE" } });
      await sendWeeklyDigests(monday);
      expect(await prisma.notification.count({ where: { type: "WEEKLY_UPDATE_DUE" } })).toBe(before);
      // неделя отмечена: даже без защиты «6 дней» повторный запуск ничего не шлёт
      expect(await sendWeeklyDigests(monday)).toEqual({ zgd: 0, directors: 0 });
    } finally {
      await prisma.appSetting.deleteMany({ where: { key: "weekly.digest.week" } });
      await prisma.notification.deleteMany({ where: { type: "WEEKLY_UPDATE_DUE", createdAt: { gte: since } } });
    }
  });

  it("админ, который сам ведёт позиции, свою сданную задачу не принимает — принимает директор", async () => {
    const u = await prisma.user.create({ data: { name: `${TAG} Админ-исполнитель`, email: `${TAG}.adminexec${Date.now()}@e2e.local`, passwordHash: "x", role: "ADMIN", directorateId: director.directorateId, submits: true } });
    testUserIds.push(u.id);
    invalidateDicts(); // создан мимо API — справочник людей перечитать
    const me = { id: u.id, role: "ADMIN", name: u.name, directorateId: director.directorateId, submits: true } as Actor;
    const c = await call(me, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} задача админа` } });
    expect(c.status, JSON.stringify(c.data)).toBe(201);
    const tid = c.data.row.id as string;
    created.items.push(tid);
    let ver = c.data.row.version as number;
    const tr = async (a: Actor, body: Record<string, unknown>) => {
      const r = await call(a, transition.POST, `/api/items/${tid}/transition`, { method: "POST", id: tid, body: { version: ver, ...body } });
      if (r.data.row) ver = r.data.row.version;
      return r;
    };
    expect((await tr(me, { action: "submit", result: "Готово, файл в документах" })).status).toBe(200);
    const self = await tr(me, { action: "accept" });
    expect(self.status).toBe(403);
    expect((await tr(me, { action: "return", comment: "сам себе" })).status).toBe(403);
    expect((await tr(director, { action: "accept" })).status).toBe(200);
  });
});

describe("сквозной сценарий: руководитель → справка ЗГД → трекер ЗГД → решения директора → возврат → ред. 2", () => {
  // своя дирекция и люди — сценарий не зависит от остальных проверок и не мешает им
  let dirF = "";
  let dF: Actor;
  let hF: Actor;
  let zF: Actor;
  let cycleId = "";
  let a = "";
  let b = "";
  let v1 = "";
  type ZRow = { id: string; name: string; comment: string | null; deadline: string | null; ownerName: string | null; statusName: string | null; confirmedBy: string; inMemo?: boolean; zgdControl: boolean; openRequest?: boolean; review?: { decision: string | null } | null };
  const zgdData = async () => (await call(zF, tracker.GET, "/api/tracker")).data as { rows: ZRow[]; events: Array<{ itemId: string; text: string }> };
  const zRow = async (id: string) => (await zgdData()).rows.find((r) => r.id === id);
  const live = async (id: string) => ((await call(dF, tracker.GET, "/api/tracker")).data.rows as Array<ZRow & { updatedAt: string; publishedAt: string | null }>).find((r) => r.id === id)!;
  const inbox = (u: Actor, type: string, contains?: string) => prisma.notification.count({ where: { userId: u.id, type: type as never, ...(contains ? { message: { contains } } : {}) } });
  const ver = async (id: string) => (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).version;
  const patchF = async (who: Actor, id: string, body: Record<string, unknown>) => call(who, item.PATCH, `/api/items/${id}`, { method: "PATCH", id, body: { version: await ver(id), ...body } });
  const trF = async (who: Actor, id: string, body: Record<string, unknown>) => call(who, transition.POST, `/api/items/${id}/transition`, { method: "POST", id, body: { version: await ver(id), ...body } });

  beforeAll(async () => {
    dirF = (await prisma.directorate.create({ data: { name: `${TAG} Сквозная дирекция`, shortName: "Сквозная" } })).id;
    const mk = async (key: string, name: string, role: "HEAD" | "DIRECTOR" | "EXECUTIVE", directorateId: string | null): Promise<Actor> => {
      const u = await prisma.user.create({ data: { name: `${TAG} ${name}`, email: `${TAG}.flow-${key}@e2e.local`, passwordHash: "x", role, directorateId } });
      testUserIds.push(u.id);
      return { id: u.id, name: u.name, role, directorateId };
    };
    dF = await mk("dir", "Директор", "DIRECTOR", dirF);
    hF = await mk("head", "Руководитель", "HEAD", dirF);
    zF = await mk("zgd", "ЗГД", "EXECUTIVE", null);
    invalidateDicts();
  });

  afterAll(async () => {
    if (!dirF) return;
    const ids = (await prisma.operationalItem.findMany({ where: { directorateId: dirF }, select: { id: true } })).map((i) => i.id);
    const people = [dF?.id, hF?.id, zF?.id].filter(Boolean) as string[];
    await prisma.auditEvent.deleteMany({ where: { OR: [{ entityId: { in: ids } }, { actorId: { in: people } }] } });
    await prisma.itemNote.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: people } }, { link: { contains: dirF } }, ...ids.map((i) => ({ link: { contains: i } }))] } });
    await prisma.operationalItem.deleteMany({ where: { directorateId: dirF } });
    await prisma.cycle.deleteMany({ where: { directorateId: dirF } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
    await prisma.directorate.deleteMany({ where: { id: dirF } });
  });

  it("руководитель заводит и подаёт две задачи: трекер директора их видит, ЗГД — ещё нет", async () => {
    const ca = await call(hF, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} Сквозная А`, comment: "Исходный текст А", deadline: "2026-11-20", operFlag: true } });
    const cb = await call(hF, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} Сквозная Б`, comment: "Исходный текст Б", operFlag: true } });
    expect([ca.status, cb.status]).toEqual([201, 201]);
    a = ca.data.row.id;
    b = cb.data.row.id;
    expect((await live(a)).publishedAt).toBeNull(); // у директора — «не подтверждено для ЗГД»
    expect(await zRow(a)).toBeUndefined();
  });

  it("оперативка: сборка → справка из поданного → отправка: версия, уведомление ЗГД, подтверждение задач, подача сброшена", async () => {
    const start = await call(dF, cycles.POST, "/api/cycles", { method: "POST", body: { deadline: new Date(Date.now() + 5 * 864e5).toISOString() } });
    expect(start.status).toBe(201);
    cycleId = start.data.id;
    expect((await call(dF, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    const m = await call(dF, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    const used = (m.data.doc.sections as Array<{ bullets: Array<{ itemIds: string[]; text: string }> }>).flatMap((s) => s.bullets);
    expect(used.flatMap((x) => x.itemIds).sort()).toEqual([a, b].sort());
    expect(used.map((x) => x.text)).toEqual(expect.arrayContaining(["Исходный текст А", "Исходный текст Б"]));
    // руководитель на сборке поданное не меняет
    expect((await patchF(hF, a, { comment: "поздняя правка" })).status).toBe(409);
    const fin = await call(dF, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId, body: { note: "Для ОС" } });
    expect(fin.status).toBe(200);
    expect(fin.data.count).toBe(2);
    v1 = (await prisma.memoVersion.findFirstOrThrow({ where: { cycleId } })).id;
    expect(await inbox(zF, "MEMO_SENT")).toBe(1);
    expect(await prisma.itemPublication.count({ where: { itemId: { in: [a, b] }, reason: "отправлена справка" } })).toBe(2);
    expect((await prisma.operationalItem.findMany({ where: { id: { in: [a, b] } } })).every((i) => !i.operFlag)).toBe(true);
    expect((await live(a)).publishedAt).not.toBeNull();
  });

  it("ЗГД читает ровно то, что ушло: справка, таблица на момент отправки и трекер совпадают с данными директора", async () => {
    const list = await call(zF, archive.GET, "/api/memo-archive");
    const row = list.data.versions.find((x: { id: string }) => x.id === v1);
    expect(row).toMatchObject({ revision: 1, bullets: 2, returned: false });
    const one = await call(zF, archiveOne.GET, `/api/memo-archive/${v1}`, { id: v1 });
    expect(one.data.version.canReturn).toBe(true);
    expect(JSON.stringify(one.data.version.doc)).toContain("Исходный текст А");
    const table = await call(zF, archiveTable.GET, `/api/memo-archive/${v1}/table`, { id: v1 });
    const ta = table.data.rows.find((r: { id: string }) => r.id === a);
    expect(ta).toMatchObject({ name: `${TAG} Сквозная А`, comment: "Исходный текст А", ownerName: hF.name });
    const za = (await zRow(a))!;
    const la = await live(a);
    expect(za).toMatchObject({ name: la.name, comment: la.comment, ownerName: la.ownerName, statusName: la.statusName, inMemo: true });
    expect(za.deadline?.slice(0, 10)).toBe("2026-11-20");
    expect(za.confirmedBy).toMatch(/справка от/);
  });

  it("после отправки: черновик руководителя ЗГД не видит; сдал → заморожено → директор принял → ЗГД видит только решение", async () => {
    expect((await patchF(hF, a, { comment: "Черновик после справки" })).status).toBe(200);
    expect((await zRow(a))!.comment).toBe("Исходный текст А");
    expect((await trF(hF, a, { action: "submit", result: "Отчёт готов, в документах" })).status).toBe(200);
    expect(await inbox(dF, "REVIEW_SUBMITTED")).toBe(1);
    expect((await patchF(hF, a, { comment: "ещё правка" })).status).toBe(409); // на проверке — до решения директора
    expect((await zRow(a))!.statusName).not.toBe("На проверке"); // сдача руководителя — не решение директора
    expect((await trF(dF, a, { action: "accept" })).status).toBe(200);
    expect(await inbox(hF, "REVIEW_DECIDED")).toBe(1);
    const za = (await zRow(a))!;
    expect(za.statusName).toBe("Завершено");
    expect(za.review?.decision).toBe("ACCEPTED");
    expect(za.comment).toBe("Исходный текст А"); // черновик руководителя не ушёл вместе с решением
    expect((await zgdData()).events.filter((e) => e.itemId === a).map((e) => e.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^принял\(а\) задачу/)]));
    const la = await live(a);
    expect(new Date(la.updatedAt).getTime()).toBeGreaterThan(new Date(la.publishedAt!).getTime()); // у директора правка ждёт подтверждения
  });

  it("ЗГД: контроль и запрос по Б → директору сигнал и уведомление → ответ уходит ЗГД", async () => {
    expect((await call(zF, zgd.POST, "/api/zgd", { method: "POST", body: { action: "control", itemId: b, on: true } })).status).toBe(200);
    expect((await call(zF, zgd.POST, "/api/zgd", { method: "POST", body: { action: "request", itemId: b, text: "Когда будет результат?" } })).status).toBe(200);
    expect(await inbox(dF, "ZGD_REQUEST")).toBe(1);
    expect((await call(dF, tracker.GET, "/api/tracker")).data.hot[b]?.kinds ?? []).toContain("request");
    expect((await zRow(b))!.openRequest).toBe(true);
    const rq = await prisma.zgdRequest.findFirstOrThrow({ where: { itemId: b, answeredAt: null } });
    expect((await call(dF, zgd.POST, "/api/zgd", { method: "POST", body: { action: "answer", requestId: rq.id, answer: "Результат к 05.12" } })).status).toBe(200);
    expect(await inbox(zF, "ZGD_ANSWER")).toBe(1);
    const zb = (await zRow(b))!;
    expect(zb.openRequest).toBe(false);
    expect(zb.zgdControl).toBe(true);
    expect(zb.confirmedBy).toMatch(/ответил\(а\) на запрос/);
  });

  it("ЗГД возвращает справку: оперативка снова на сборке (ред. 2), поданное восстановлено, директору — уведомление", async () => {
    expect((await call(zF, archiveReturn.POST, `/api/memo-archive/${v1}/return`, { method: "POST", id: v1, body: { comment: "Уточните срок по Б" } })).status).toBe(200);
    const cyc = await prisma.cycle.findUniqueOrThrow({ where: { id: cycleId } });
    expect(cyc).toMatchObject({ status: "IN_REVIEW", revision: 2 });
    expect((await prisma.operationalItem.findMany({ where: { id: { in: [a, b] } } })).every((i) => i.operFlag)).toBe(true);
    expect(await inbox(dF, "MEMO_RETURNED")).toBe(1);
    const one = await call(zF, archiveOne.GET, `/api/memo-archive/${v1}`, { id: v1 });
    expect(one.data.version.returnedAt).not.toBeNull();
    expect(one.data.version.canReturn).toBe(false);
    expect((await patchF(hF, b, { comment: "правка" })).status).toBe(409); // сборка — поданное заморожено
  });

  it("директор возвращает Б руководителю без замечания → правка и подача → повторная отправка: ред. 2 у ЗГД", async () => {
    const back = await call(dF, ret.POST, `/api/items/${b}/return`, { method: "POST", id: b, body: { comment: "" } });
    expect(back.status).toBe(200);
    expect(back.data.row.operFlag).toBe(false);
    expect((await patchF(hF, b, { comment: "Уточнённый текст Б", deadline: "2026-12-05" })).status).toBe(200);
    expect((await patchF(hF, b, { operFlag: true })).status).toBe(200);
    expect((await call(dF, memoRefresh.POST, `/api/cycles/${cycleId}/memo/refresh`, { method: "POST", id: cycleId })).status).toBe(200);
    const fin = await call(dF, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId });
    expect(fin.status).toBe(200);
    expect(await inbox(zF, "MEMO_SENT", "ред. 2")).toBe(1);
    const list = await call(zF, archive.GET, "/api/memo-archive");
    const ours = new Set((await prisma.memoVersion.findMany({ where: { cycleId }, select: { id: true } })).map((x) => x.id));
    const mine = list.data.versions.filter((x: { id: string }) => ours.has(x.id));
    expect(mine).toHaveLength(1); // одна строка на оперативку — последняя ревизия
    expect(mine[0]).toMatchObject({ revision: 2, revisions: 2 });
    const zb = (await zRow(b))!;
    expect(zb).toMatchObject({ comment: "Уточнённый текст Б", zgdControl: true });
    expect(zb.deadline?.slice(0, 10)).toBe("2026-12-05");
    // справка подтверждает всё: теперь и правка А, сделанная после первой отправки
    expect((await zRow(a))!.comment).toBe("Черновик после справки");
    const la = await live(a);
    expect(new Date(la.updatedAt).getTime()).toBeLessThanOrEqual(new Date(la.publishedAt!).getTime());
  });

  it("история у директора: создание, сдача и приёмка (смена статуса — в самом действии), вхождение в обе справки", async () => {
    const ev = ((await call(dF, tracker.GET, "/api/tracker")).data.events as Array<{ itemId: string; kind: string; text: string; before?: string; after?: string }>).filter((e) => e.itemId === a);
    expect(ev.map((e) => e.kind)).toEqual(expect.arrayContaining(["created", "workflow", "memo"]));
    expect(ev.find((e) => e.kind === "workflow" && e.text.startsWith("сдана"))).toMatchObject({ after: "На проверке" });
    expect(ev.filter((e) => e.kind === "memo").length).toBe(2); // ред. 1 и ред. 2
    expect(ev.some((e) => e.kind === "status" && e.text.includes("На проверке"))).toBe(false); // без повтора строки статуса
  });
});

describe("poke holes: границы входа, права, изоляция дирекций и защита от перегрузки (трекер)", () => {
  let dirP = "";
  let dP: Actor;
  let hP: Actor;
  let zP: Actor;
  let item1 = ""; // задача руководителя, подтверждена для ЗГД
  let item2 = ""; // задача руководителя, НЕ подтверждена для ЗГД
  const mk = async (key: string, name: string, role: "HEAD" | "DIRECTOR" | "EXECUTIVE", directorateId: string | null): Promise<Actor> => {
    const u = await prisma.user.create({ data: { name: `${TAG} ${name}`, email: `${TAG}.holes-${key}@e2e.local`, passwordHash: "x", role, directorateId } });
    testUserIds.push(u.id);
    return { id: u.id, name: u.name, role, directorateId };
  };
  const zg = (who: Actor | null, body: unknown) => call(who, zgd.POST, "/api/zgd", { method: "POST", body });
  const ver = async (id: string) => (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).version;

  beforeAll(async () => {
    dirP = (await prisma.directorate.create({ data: { name: `${TAG} Дирекция проверок`, shortName: "Проверки" } })).id;
    dP = await mk("dir", "Директор П", "DIRECTOR", dirP);
    hP = await mk("head", "Руководитель П", "HEAD", dirP);
    zP = await mk("zgd", "ЗГД П", "EXECUTIVE", null);
    invalidateDicts();
    item1 = (await call(hP, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} проверка 1`, deadline: "2026-12-01" } })).data.row.id;
    item2 = (await call(hP, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} проверка 2` } })).data.row.id;
    expect((await call(dP, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [item1] } })).data.published).toBe(1);
  });

  afterAll(async () => {
    if (!dirP) return;
    const ids = (await prisma.operationalItem.findMany({ where: { directorateId: dirP }, select: { id: true } })).map((i) => i.id);
    const people = [dP?.id, hP?.id, zP?.id].filter(Boolean) as string[];
    await prisma.rateLimit.deleteMany({ where: { OR: people.map((p) => ({ key: { contains: p } })) } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ entityId: { in: ids } }, { actorId: { in: people } }] } });
    await prisma.itemNote.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: people } }, ...ids.map((i) => ({ link: { contains: i } }))] } });
    await prisma.operationalItem.deleteMany({ where: { directorateId: dirP } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
    await prisma.directorate.deleteMany({ where: { id: dirP } });
  });

  it("даты вне разумных границ (год 9999, 1900, +275760) отклоняются везде — иначе одна опечатка вешает таймлайн у всех", async () => {
    const far = ["9999-12-31", "1900-01-01", "+275760-09-13T00:00:00.000Z"];
    for (const d of far) {
      expect((await call(hP, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} далёкий срок`, deadline: d } })).status).toBe(400);
      expect((await call(hP, item.PATCH, `/api/items/${item2}`, { method: "PATCH", id: item2, body: { version: await ver(item2), deadline: d } })).status).toBe(400);
      expect((await zg(zP, { action: "order", directorateId: dirP, title: "Поручение", expectedResult: "Результат", deadline: d })).status).toBe(400);
      expect((await zg(zP, { action: "request", itemId: item1, text: "Вопрос", dueAt: d })).status).toBe(400);
      expect((await zg(hP, { action: "deadline-request", itemId: item1, newDeadline: d, reason: "причина" })).status).toBe(400);
      expect((await call(hP, transition.POST, `/api/items/${item2}/transition`, { method: "POST", id: item2, body: { version: await ver(item2), action: "block", blockedBy: "ждём", blockedUntil: d } })).status).toBe(400);
    }
    // нормальная дата проходит
    const ok = await call(hP, item.PATCH, `/api/items/${item2}`, { method: "PATCH", id: item2, body: { version: await ver(item2), deadline: "2027-03-01" } });
    expect(ok.status).toBe(200);
    expect(await prisma.operationalItem.count({ where: { directorateId: dirP, deadline: { gt: new Date("2101-01-01") } } })).toBe(0);
  });

  it("поля без границ длины и служебные ключи: «Оценка» не раздувает базу, __proto__ в своих колонках не роняет сервер", async () => {
    const v = await ver(item2);
    expect((await call(hP, item.PATCH, `/api/items/${item2}`, { method: "PATCH", id: item2, body: { version: v, cost: "9".repeat(5000) } })).status).toBe(400);
    const proto = await call(hP, item.PATCH, `/api/items/${item2}`, { method: "PATCH", id: item2, body: { version: v, customValues: JSON.parse('{"__proto__":"x","constructor":"y"}') } });
    expect(proto.status).toBeLessThan(500);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("чужая дирекция: по id чужой задачи — 404 на действия, ход работы, просьбы, ответы, подтверждение", async () => {
    expect((await call(headB, transition.POST, `/api/items/${item1}/transition`, { method: "POST", id: item1, body: { version: await ver(item1), action: "block", blockedBy: "взлом" } })).status).toBe(404);
    expect((await call(directorB, transition.POST, `/api/items/${item1}/transition`, { method: "POST", id: item1, body: { version: await ver(item1), action: "cancel", reason: "взлом" } })).status).toBe(404);
    expect((await call(headB, workflow.GET, `/api/items/${item1}/workflow`, { id: item1 })).status).toBe(404);
    expect((await zg(headB, { action: "deadline-request", itemId: item1, newDeadline: "2027-01-01", reason: "взлом" })).status).toBe(404);
    // просьба и запрос чужой дирекции: решить/ответить нельзя
    expect((await zg(hP, { action: "deadline-request", itemId: item1, newDeadline: "2027-01-01", reason: "нужно время" })).status).toBe(200);
    expect((await zg(zP, { action: "request", itemId: item1, text: "Как дела?" })).status).toBe(200);
    const dl = await prisma.deadlineRequest.findFirstOrThrow({ where: { itemId: item1, decision: null } });
    const rq = await prisma.zgdRequest.findFirstOrThrow({ where: { itemId: item1, answeredAt: null } });
    expect((await zg(directorB, { action: "deadline-decide", requestId: dl.id, approve: true })).status).toBe(404);
    expect((await zg(directorB, { action: "answer", requestId: rq.id, answer: "взлом" })).status).toBe(404);
    expect((await prisma.deadlineRequest.findUniqueOrThrow({ where: { id: dl.id } })).decision).toBeNull();
    expect((await prisma.zgdRequest.findUniqueOrThrow({ where: { id: rq.id } })).answeredAt).toBeNull();
    // «подтвердить для ЗГД» чужие задачи нельзя: фильтр по своей дирекции
    const pub = await call(directorB, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [item1, item2] } });
    expect(pub.data.total ?? 0).toBe(0);
    // чужие данные не попадают в трекер
    expect(((await call(directorB, tracker.GET, "/api/tracker")).data.rows as Array<{ id: string }>).some((r) => r.id === item1)).toBe(false);
    // закрываем висящие просьбы, чтобы не мешать остальным проверкам
    await zg(dP, { action: "deadline-decide", requestId: dl.id, approve: false, comment: "не сейчас" });
    await zg(dP, { action: "answer", requestId: rq.id, answer: "в работе" });
  });

  it("роли: руководитель не берёт чужие полномочия; ЗГД не пользуется рабочими маршрутами; без входа — 401", async () => {
    // руководитель: всё, что принадлежит ЗГД и директору
    for (const body of [
      { action: "control", itemId: item1, on: true },
      { action: "request", itemId: item1, text: "Вопрос" },
      { action: "comment", itemId: item1, text: "Комментарий" },
      { action: "order", directorateId: dirP, title: "Поручение", expectedResult: "Результат", deadline: "2027-01-01" },
      { action: "director-order", responsibleId: hP.id, title: "Поручение", expectedResult: "Результат", deadline: "2027-01-01" },
    ]) expect([403, 404]).toContain((await zg(hP, body)).status);
    expect((await call(hP, publish.GET, "/api/tracker/publish")).status).toBe(403);
    expect((await call(hP, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [item1] } })).status).toBe(403);
    expect((await call(hP, tracker.PATCH, "/api/tracker", { method: "PATCH", body: { enabled: false } })).status).toBe(403);
    for (const action of ["accept", "return", "cancel", "reopen"]) expect([400, 403]).toContain((await call(hP, transition.POST, `/api/items/${item1}/transition`, { method: "POST", id: item1, body: { version: await ver(item1), action, comment: "текст", reason: "текст" } })).status);
    // ЗГД: рабочие маршруты дирекции ему закрыты
    expect([403, 404]).toContain((await call(zP, transition.POST, `/api/items/${item1}/transition`, { method: "POST", id: item1, body: { version: await ver(item1), action: "accept" } })).status);
    expect([403, 404]).toContain((await call(zP, workflow.GET, `/api/items/${item1}/workflow`, { id: item1 })).status);
    expect([403, 404]).toContain((await call(zP, item.PATCH, `/api/items/${item1}`, { method: "PATCH", id: item1, body: { version: await ver(item1), title: "взлом" } })).status);
    expect([403, 404]).toContain((await call(zP, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [item1] } })).status);
    expect((await prisma.operationalItem.findUniqueOrThrow({ where: { id: item1 } })).title).toBe(`${TAG} проверка 1`);
    // ЗГД не видит и не трогает неподтверждённое: ни действия, ни карточка с запросами
    expect((await zg(zP, { action: "request", itemId: item2, text: "Вопрос" })).status).toBe(404);
    expect((await call(zP, zgd.GET, `/api/zgd?itemId=${item2}`)).status).toBe(403);
    // без входа
    expect((await call(null, tracker.GET, "/api/tracker")).status).toBe(401);
    expect((await zg(null, { action: "control", itemId: item1, on: true })).status).toBe(401);
    expect((await call(null, transition.POST, `/api/items/${item1}/transition`, { method: "POST", id: item1, body: { version: 1, action: "submit", result: "x" } })).status).toBe(401);
    expect((await call(null, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [item1] } })).status).toBe(401);
  });

  it("подтверждение при отправке справки не плодит копии: без изменений — новой строки нет, с изменением — есть; решение директора не мешает", async () => {
    const rec = () => prisma.operationalItem.findUniqueOrThrow({ where: { id: item2 } });
    const me = { id: dP.id, name: dP.name };
    await publishAll([await rec()], me, "отправлена справка", { dedupe: true });
    const base = await prisma.itemPublication.count({ where: { itemId: item2 } });
    expect(await publishAll([await rec()], me, "отправлена справка", { dedupe: true })).toBe(0);
    expect(await publishAll([await rec()], me, "отправлена справка", { dedupe: true })).toBe(0);
    expect(await prisma.itemPublication.count({ where: { itemId: item2 } })).toBe(base);
    expect((await rec()).publishedAt).not.toBeNull(); // «подтверждено» у директора обновилось и без новой строки
    await prisma.operationalItem.update({ where: { id: item2 }, data: { comment: "Изменили после справки" } });
    expect(await publishAll([await rec()], me, "отправлена справка", { dedupe: true })).toBe(1);
    // явное «Обновить для ЗГД» (без dedupe) строку пишет всегда — у него своя дата и автор
    expect(await publishAll([await rec()], me, "подтвердил(а) актуальность для ЗГД")).toBe(1);
  });

  it("перегрузка: частые действия трекера упираются в ограничение (429), а не в базу; первое обращение при этом обычное", async () => {
    const spammer = await mk("spam", "Спамер", "HEAD", dirP);
    invalidateDicts();
    const statuses: number[] = [];
    for (let i = 0; i < 80; i++) statuses.push((await call(spammer, transition.POST, "/api/items/net-takoj/transition", { method: "POST", id: "net-takoj", body: { version: 1, action: "unblock" } })).status);
    expect(statuses[0]).not.toBe(429);
    expect(statuses).toContain(429);
    const zStatuses: number[] = [];
    for (let i = 0; i < 80; i++) zStatuses.push((await zg(spammer, { action: "deadline-request", itemId: "net-takoj", newDeadline: "2027-01-01", reason: "x" })).status);
    expect(zStatuses).toContain(429);
    await prisma.rateLimit.deleteMany({ where: { key: { contains: spammer.id } } });
  });
});

describe("эксплуатация: окно журнала для трекера и уборка старых уведомлений", () => {
  it("журнал в трекере — окно по времени и потолок по строкам: старше 540 дней и сверх потолка отрезается, порядок по возрастанию", async () => {
    const c = await call(head, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} окно журнала` } });
    const id = c.data.row.id as string;
    created.items.push(id);
    const day = 24 * 3600 * 1000;
    const at = (ms: number) => new Date(Date.now() - ms);
    await prisma.auditEvent.createMany({
      data: [
        { entityType: "OperationalItem", entityId: id, action: "UPDATE", fieldName: "comment", timestamp: at(600 * day) },
        ...[5, 4, 3, 2, 1].map((m) => ({ entityType: "OperationalItem", entityId: id, action: "UPDATE" as const, fieldName: "comment", timestamp: at(m * 60_000) })),
      ],
    });
    const all = await loadAuditWindow([id]);
    expect(all.truncated).toBe(true); // старое за пределами окна есть
    expect(all.rows.every((r) => r.timestamp.getTime() > Date.now() - 541 * day)).toBe(true);
    const times = all.rows.map((r) => r.timestamp.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times); // по возрастанию
    expect(all.rows.length).toBeGreaterThanOrEqual(6); // создание + 5 правок
    // потолок: только самые свежие, порядок прежний
    const capped = await loadAuditWindow([id], { max: 3 });
    expect(capped.rows).toHaveLength(3);
    expect(capped.truncated).toBe(true);
    expect(capped.rows.map((r) => r.timestamp.getTime())).toEqual(times.slice(-3));
    // окно пошире — видна и старая запись
    expect((await loadAuditWindow([id], { days: 700 })).rows.length).toBe(all.rows.length + 1);
    expect(await loadAuditWindow([])).toEqual({ rows: [], truncated: false });
    // сам трекер живёт и с окном: задача на месте, события есть
    const t = await call(head, tracker.GET, "/api/tracker");
    expect(t.status).toBe(200);
    expect((t.data.events as Array<{ itemId: string }>).filter((e) => e.itemId === id).length).toBeGreaterThan(0);
  });

  it("уборка уведомлений: прочитанные старше 60 дней и любые старше 180 — удаляются; свежие и непрочитанные средней давности остаются", async () => {
    const u = await prisma.user.create({ data: { name: `${TAG} Уборка`, email: `${TAG}.prune@e2e.local`, passwordHash: "x", role: "HEAD", directorateId: head.directorateId } });
    testUserIds.push(u.id);
    const day = 24 * 3600 * 1000;
    const mkN = (name: string, ageDays: number, isRead: boolean) => prisma.notification.create({ data: { userId: u.id, type: "CHANGE_ATTENTION", message: `${TAG} ${name}`, isRead, createdAt: new Date(Date.now() - ageDays * day) } });
    const readOld = await mkN("прочитано давно", 70, true);
    const unreadMid = await mkN("не прочитано 70 дней", 70, false);
    const unreadOld = await mkN("не прочитано полгода", 200, false);
    const readNew = await mkN("прочитано недавно", 10, true);
    expect(await pruneNotifications(new Date(), { userIds: [u.id] })).toBe(2);
    const left = (await prisma.notification.findMany({ where: { userId: u.id }, select: { id: true } })).map((n) => n.id).sort();
    expect(left).toEqual([unreadMid.id, readNew.id].sort());
    expect(left).not.toContain(readOld.id);
    expect(left).not.toContain(unreadOld.id);
    // повтор ничего не находит
    expect(await pruneNotifications(new Date(), { userIds: [u.id] })).toBe(0);
  });
});

describe("«Удалённые» в трекере: удалить можно из трекера, видно в удалённых трекера и таблицы; поручения удаляет только директор", () => {
  let dirD = "";
  let dD: Actor;
  let hD: Actor;
  let zD: Actor;
  let ordinary = "";
  let order = "";
  const mk = async (key: string, name: string, role: "HEAD" | "DIRECTOR" | "EXECUTIVE", directorateId: string | null): Promise<Actor> => {
    const u = await prisma.user.create({ data: { name: `${TAG} ${name}`, email: `${TAG}.del-${key}@e2e.local`, passwordHash: "x", role, directorateId } });
    testUserIds.push(u.id);
    return { id: u.id, name: u.name, role, directorateId };
  };
  const rowsOf = async (who: Actor, archived: boolean) => ((await call(who, tracker.GET, archived ? "/api/tracker?archive=archived" : "/api/tracker")).data.rows as Array<{ id: string; archived?: boolean }>).map((r) => r.id);
  const del = (who: Actor, id: string) => call(who, item.DELETE, `/api/items/${id}`, { method: "DELETE", id });
  const back = (who: Actor, id: string) => call(who, restore.POST, `/api/items/${id}/restore`, { method: "POST", id });

  beforeAll(async () => {
    dirD = (await prisma.directorate.create({ data: { name: `${TAG} Дирекция удалённых`, shortName: "Удал" } })).id;
    dD = await mk("dir", "Директор У", "DIRECTOR", dirD);
    hD = await mk("head", "Руководитель У", "HEAD", dirD);
    zD = await mk("zgd", "ЗГД У", "EXECUTIVE", null);
    invalidateDicts();
    ordinary = (await call(hD, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} обычная на удаление`, deadline: "2026-12-01" } })).data.row.id;
    const o = await call(zD, zgd.POST, "/api/zgd", { method: "POST", body: { action: "order", directorateId: dirD, title: `${TAG} поручение ЗГД на удаление`, expectedResult: "Справка", deadline: "2027-12-10", responsibleId: hD.id } });
    expect(o.status).toBe(200);
    order = o.data.id;
  });

  afterAll(async () => {
    if (!dirD) return;
    const ids = (await prisma.operationalItem.findMany({ where: { directorateId: dirD }, select: { id: true } })).map((i) => i.id);
    const people = [dD?.id, hD?.id, zD?.id].filter(Boolean) as string[];
    await prisma.auditEvent.deleteMany({ where: { OR: [{ entityId: { in: ids } }, { actorId: { in: people } }] } });
    await prisma.itemNote.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: people } }, ...ids.map((i) => ({ link: { contains: i } }))] } });
    await prisma.operationalItem.deleteMany({ where: { directorateId: dirD } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
    await prisma.directorate.deleteMany({ where: { id: dirD } });
  });

  it("обычная задача: руководитель удаляет → её нет в рабочем трекере, есть в «Удалённых» трекера у него и у директора и в «Удалённых» таблицы; возврат — обратно", async () => {
    expect(await rowsOf(hD, false)).toContain(ordinary);
    expect((await del(hD, ordinary)).status).toBe(200);
    expect(await rowsOf(hD, false)).not.toContain(ordinary);
    expect(await rowsOf(hD, true)).toContain(ordinary);
    expect(await rowsOf(dD, true)).toContain(ordinary);
    // та же задача — в «Удалённых» таблицы
    const table = await call(dD, items.GET, "/api/items?archive=archived");
    expect((table.data.rows as Array<{ id: string }>).map((r) => r.id)).toContain(ordinary);
    // журнал знает, кто и когда удалил — из него «удалена 16.10 · Имя» в трекере
    const ev = ((await call(dD, tracker.GET, "/api/tracker?archive=archived")).data.events as Array<{ itemId: string; kind: string; who: string | null }>).filter((e) => e.itemId === ordinary && e.kind === "archived");
    expect(ev).toHaveLength(1);
    expect(ev[0].who).toBe(hD.name);
    // удалённые ни на что не «горят»
    expect((await call(dD, tracker.GET, "/api/tracker?archive=archived")).data.hot).toEqual({});
    // возврат — и снова в рабочем трекере, а из удалённых пропала
    expect((await back(hD, ordinary)).status).toBe(200);
    expect(await rowsOf(hD, false)).toContain(ordinary);
    expect(await rowsOf(hD, true)).not.toContain(ordinary);
  });

  it("значение archive вне списка — рабочие задачи; ЗГД параметр не меняет (он видит своё, по справкам)", async () => {
    expect(await rowsOf(hD, false)).toContain(ordinary);
    expect(((await call(hD, tracker.GET, "/api/tracker?archive=all")).data.rows as Array<{ id: string }>).map((r) => r.id)).toContain(ordinary);
    expect(((await call(hD, tracker.GET, "/api/tracker?archive=%27%3Bdrop")).data.rows as Array<{ id: string }>).map((r) => r.id)).toContain(ordinary);
    expect((await call(zD, tracker.GET, "/api/tracker?archive=archived")).data.mode).toBe("sent");
  });

  it("поручение: исполнитель-руководитель удалить не может (403), директор — может; ЗГД узнаёт, поручение пропадает из его трекера и возвращается", async () => {
    expect((await del(hD, order)).status).toBe(403);
    expect(await rowsOf(hD, false)).toContain(order);
    // директор подтверждает поручение для ЗГД, чтобы оно было видно ему
    expect((await call(dD, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [order] } })).status).toBe(200);
    const zRows = async () => ((await call(zD, tracker.GET, "/api/tracker")).data.rows as Array<{ id: string }>).map((r) => r.id);
    expect(await zRows()).toContain(order);
    const before = await prisma.notification.count({ where: { userId: zD.id, type: "ZGD_UPDATE", message: { contains: "удалил(а)" } } });
    expect((await del(dD, order)).status).toBe(200); // директор — не ответственный, но поручение удалить может
    expect(await prisma.notification.count({ where: { userId: zD.id, type: "ZGD_UPDATE", message: { contains: "удалил(а)" } } })).toBe(before + 1);
    expect(await zRows()).not.toContain(order);
    expect(await rowsOf(dD, true)).toContain(order);
    // вернуть может директор; ЗГД снова видит и узнаёт об этом
    expect((await back(dD, order)).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: zD.id, type: "ZGD_UPDATE", message: { contains: "вернул(а) из удалённых" } } })).toBe(1);
    expect(await zRows()).toContain(order);
  });

  it("навсегда поручение исполнитель тоже стереть не может; задача на проверке у руководителя не удаляется", async () => {
    // исполнитель: «удалить навсегда» — только из удалённых, а удалить поручение ему нельзя; директор удаляет и стирает не может (есть решения)
    const purge = await call(hD, purgeRoute.POST, `/api/items/${order}/purge`, { method: "POST", id: order });
    expect([403, 409]).toContain(purge.status);
    const c = await call(hD, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} на проверке, не удалить` } });
    const id = c.data.row.id as string;
    expect((await call(hD, transition.POST, `/api/items/${id}/transition`, { method: "POST", id, body: { version: c.data.row.version, action: "submit", result: "Готово, в документах" } })).status).toBe(200);
    const blocked = await del(hD, id);
    expect(blocked.status).toBe(409);
    expect(await rowsOf(hD, false)).toContain(id);
  });
});

describe("комментарии в карточке, срок поручения, отменённые задачи", () => {
  let dirN = "";
  let dN: Actor;
  let hN: Actor;
  let h2N: Actor;
  let zN: Actor;
  let taskA = "";
  let taskB = "";
  const mk = async (key: string, name: string, role: "HEAD" | "DIRECTOR" | "EXECUTIVE", directorateId: string | null): Promise<Actor> => {
    const u = await prisma.user.create({ data: { name: `${TAG} ${name}`, email: `${TAG}.note-${key}@e2e.local`, passwordHash: "x", role, directorateId } });
    testUserIds.push(u.id);
    return { id: u.id, name: u.name, role, directorateId };
  };
  const note = (who: Actor | null, id: string, text: string, toZgd?: boolean) => call(who, zgd.POST, "/api/zgd", { method: "POST", body: { action: "note", itemId: id, text, ...(toZgd === undefined ? {} : { toZgd }) } });
  const inbox = (u: Actor, type: string, contains: string) => prisma.notification.count({ where: { userId: u.id, type: type as never, message: { contains } } });
  const zNotes = async (id: string) => ((await call(zN, zgd.GET, `/api/zgd?itemId=${id}`)).data.notes as Array<{ text: string; audience?: string }>).map((n) => n.text);
  const dayShift = (n: number) => new Date(Date.now() + 3 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

  beforeAll(async () => {
    dirN = (await prisma.directorate.create({ data: { name: `${TAG} Дирекция комментариев`, shortName: "Комм" } })).id;
    dN = await mk("dir", "Директор К", "DIRECTOR", dirN);
    hN = await mk("head", "Руководитель К", "HEAD", dirN);
    h2N = await mk("head2", "Другой руководитель К", "HEAD", dirN);
    zN = await mk("zgd", "ЗГД К", "EXECUTIVE", null);
    invalidateDicts();
    taskA = (await call(hN, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} задача А для комментариев` } })).data.row.id;
    taskB = (await call(hN, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} задача Б, ЗГД не видит` } })).data.row.id;
    expect((await call(dN, publish.POST, "/api/tracker/publish", { method: "POST", body: { itemIds: [taskA] } })).data.published).toBe(1);
  });

  afterAll(async () => {
    if (!dirN) return;
    const ids = (await prisma.operationalItem.findMany({ where: { directorateId: dirN }, select: { id: true } })).map((i) => i.id);
    const people = [dN?.id, hN?.id, h2N?.id, zN?.id].filter(Boolean) as string[];
    await prisma.rateLimit.deleteMany({ where: { OR: people.map((p) => ({ key: { contains: p } })) } });
    await prisma.auditEvent.deleteMany({ where: { OR: [{ entityId: { in: ids } }, { actorId: { in: people } }] } });
    await prisma.itemNote.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: people } }, ...ids.map((i) => ({ link: { contains: i } }))] } });
    await prisma.operationalItem.deleteMany({ where: { directorateId: dirN } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
    await prisma.directorate.deleteMany({ where: { id: dirN } });
  });

  it("обычный комментарий: ответственный и директор пишут, второй стороне — уведомление; ЗГД его не видит", async () => {
    expect((await note(hN, taskA, "Договор у юристов, жду визу")).status).toBe(200);
    expect(await inbox(dN, "CHANGE_ATTENTION", "Договор у юристов")).toBe(1);
    expect((await note(dN, taskA, "Поторопите юристов до пятницы")).status).toBe(200);
    expect(await inbox(hN, "CHANGE_ATTENTION", "Поторопите юристов")).toBe(1);
    // карточка дирекции видит оба, ЗГД — ни одного
    const wf = await call(dN, workflow.GET, `/api/items/${taskA}/workflow`, { id: taskA });
    const texts = (wf.data.notes as Array<{ text: string; audience: string }>).filter((n) => n.audience === "INTERNAL").map((n) => n.text);
    expect(texts).toEqual(expect.arrayContaining(["Договор у юристов, жду визу", "Поторопите юристов до пятницы"]));
    expect(await zNotes(taskA)).toEqual([]);
  });

  it("права и границы: чужой руководитель, ЗГД, чужая дирекция, короткий и длинный текст; «ответ ЗГД» — только директор и только по видимой ЗГД задаче", async () => {
    expect((await note(h2N, taskA, "Я не отвечаю за эту задачу")).status).toBe(403);
    expect([403, 404]).toContain((await note(zN, taskA, "ЗГД не пишет внутренних комментариев")).status);
    expect((await note(headB, taskA, "чужая дирекция")).status).toBe(404);
    expect((await note(hN, taskA, "я")).status).toBe(400);
    expect((await note(hN, taskA, "я".repeat(2001))).status).toBe(400);
    expect((await note(hN, taskA, "Ответ для ЗГД от руководителя", true)).status).toBe(403);
    // задача Б ЗГД ещё не видит — отвечать ему по ней нельзя
    expect((await note(dN, taskB, "Ответ по неподтверждённой", true)).status).toBe(400);
    expect(await zNotes(taskA)).toEqual([]);
  });

  it("ответ директора ЗГД: ЗГД получает уведомление и видит его (с пометкой), но не внутренние комментарии и не замечания при возврате", async () => {
    expect((await note(dN, taskA, "Сроки подтверждаю: к 05.12 будет готово", true)).status).toBe(200);
    expect(await inbox(zN, "ZGD_UPDATE", "Сроки подтверждаю")).toBe(1);
    const info = (await call(zN, zgd.GET, `/api/zgd?itemId=${taskA}`)).data.notes as Array<{ text: string; audience?: string; author: { name: string } }>;
    expect(info.map((n) => n.text)).toEqual(["Сроки подтверждаю: к 05.12 будет готово"]);
    expect(info[0]).toMatchObject({ audience: "ZGD", author: { name: dN.name } });
    // замечание при возврате — внутреннее: ЗГД его не видит
    const cur = await prisma.operationalItem.findUniqueOrThrow({ where: { id: taskA } });
    expect((await call(hN, item.PATCH, `/api/items/${taskA}`, { method: "PATCH", id: taskA, body: { version: cur.version, operFlag: true } })).status).toBe(200);
    expect((await call(dN, ret.POST, `/api/items/${taskA}/return`, { method: "POST", id: taskA, body: { comment: "СЕКРЕТНОЕ-ЗАМЕЧАНИЕ-директора" } })).status).toBe(200);
    expect(JSON.stringify(await zNotes(taskA))).not.toContain("СЕКРЕТНОЕ");
  });

  it("поручение: срок в прошлом — 400 (и у ЗГД, и у директора); сегодняшний срок — можно", async () => {
    const body = (d: string) => ({ action: "order", directorateId: dirN, title: `${TAG} поручение со сроком`, expectedResult: "Справка", deadline: d });
    expect((await call(zN, zgd.POST, "/api/zgd", { method: "POST", body: body(dayShift(-1)) })).status).toBe(400);
    expect((await call(dN, zgd.POST, "/api/zgd", { method: "POST", body: { action: "director-order", responsibleId: hN.id, title: `${TAG} поручение директора`, expectedResult: "Справка", deadline: dayShift(-3) } })).status).toBe(400);
    const ok = await call(zN, zgd.POST, "/api/zgd", { method: "POST", body: body(dayShift(0)) });
    expect(ok.status).toBe(200);
    created.items.push(ok.data.id);
  });

  it("отменённая задача остаётся в данных трекера (скрыта лишь переключателем) и переоткрывается директором", async () => {
    const t = await call(hN, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} будет отменена` } });
    const id = t.data.row.id as string;
    const ver = async () => (await prisma.operationalItem.findUniqueOrThrow({ where: { id } })).version;
    const tr = async (who: Actor, body: Record<string, unknown>) => call(who, transition.POST, `/api/items/${id}/transition`, { method: "POST", id, body: { version: await ver(), ...body } });
    expect((await tr(hN, { action: "cancel", reason: "не нужна" })).status).toBe(403); // руководитель не отменяет
    expect((await tr(dN, { action: "cancel", reason: "не нужна: проект закрыт" })).status).toBe(200);
    const row = ((await call(dN, tracker.GET, "/api/tracker")).data.rows as Array<{ id: string; statusName: string; cancelReason?: string }>).find((r) => r.id === id);
    expect(row).toMatchObject({ statusName: "Не актуально", cancelReason: "не нужна: проект закрыт" });
    expect((await tr(hN, { action: "reopen", reason: "снова нужна" })).status).toBe(403);
    const back = await tr(dN, { action: "reopen", reason: "проект возобновили" });
    expect(back.status).toBe(200);
    expect(back.data.row.statusName).toBe("В работе");
  });
});
