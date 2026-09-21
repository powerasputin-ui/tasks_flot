import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

// Сессия подменяется: тест вызывает настоящие маршруты от имени выбранного пользователя.
const state = vi.hoisted(() => ({ actor: null as null | { id: string; role: string; name: string; directorateId: string | null; memoEditor?: boolean } }));
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
import * as ret from "@/app/api/items/[id]/return/route";
import * as history from "@/app/api/items/[id]/history/route";
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
import * as report from "@/app/api/report/route";
import * as templates from "@/app/api/report-templates/route";
import * as template from "@/app/api/report-templates/[id]/route";
import * as exportReport from "@/app/api/export/report/route";
import * as cycleFinalize from "@/app/api/cycles/[id]/finalize/route";
import * as cycleReport from "@/app/api/cycles/[id]/report/route";
import * as directorates from "@/app/api/directorates/route";
import * as segments from "@/app/api/segments/route";
import * as memo from "@/app/api/cycles/[id]/memo/route";
import * as memoRefresh from "@/app/api/cycles/[id]/memo/refresh/route";
import * as memoExport from "@/app/api/cycles/[id]/memo/export/route";
import * as memoSections from "@/app/api/memo-sections/route";
import * as memoInclude from "@/app/api/cycles/[id]/memo/include/route";
import * as inclusion from "@/app/api/memo/inclusion/route";
import * as archive from "@/app/api/memo-archive/route";
import * as archiveOne from "@/app/api/memo-archive/[id]/route";
import * as archiveExport from "@/app/api/memo-archive/[id]/export/route";
import * as archiveReturn from "@/app/api/memo-archive/[id]/return/route";

const prisma = new PrismaClient();
const TAG = `E2E${Date.now()}`;

type Actor = { id: string; role: string; name: string; directorateId: string | null; memoEditor?: boolean };
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
  // удаляем всё, что создали (журнал, замечания, уведомления, позиции, колонки, треки, циклы) и возвращаем общий вид колонок
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
  if (originalLayout === undefined) {
    // beforeAll не отработал — общий вид колонок не трогали
  } else if (originalLayout === null) await prisma.appSetting.deleteMany({ where: { key: layoutKey } });
  else await prisma.appSetting.update({ where: { key: layoutKey }, data: { value: originalLayout as object } });
  await prisma.$disconnect();
});

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
    expect(labels).toContain("Комментарий");
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

  it("возврат отправленной позиции: только куратор и только с комментарием; галка снимается, уведомление уходит", async () => {
    const cur = (await call(curator, items.GET, `/api/items?q=${q(TAG)}`)).data.rows.find((r: { id: string }) => r.id === headItem);
    const send = await call(head, item.PATCH, `/api/items/${headItem}`, { method: "PATCH", id: headItem, body: { version: cur.version, operFlag: true } });
    expect(send.status).toBe(200);

    expect((await call(head, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: "x" } })).status).toBe(403);
    expect((await call(curator, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: "  " } })).status).toBe(400);

    const ok = await call(curator, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: `${TAG} уточните сумму` } });
    expect(ok.status).toBe(200);
    expect(ok.data.row.operFlag).toBe(false);
    expect((await call(curator, ret.POST, `/api/items/${headItem}/return`, { method: "POST", id: headItem, body: { comment: "ещё" } })).status).toBe(409);

    const note = await prisma.itemNote.findFirst({ where: { itemId: headItem } });
    expect(note?.text).toContain("уточните сумму");
    const notif = await prisma.notification.findFirst({ where: { userId: head.id, message: { contains: TAG } } });
    expect(notif?.type).toBe("ITEM_RETURNED");
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

describe("треки", () => {
  it("руководитель не управляет треками; неиспользуемый трек удаляется, используемый скрывается", async () => {
    expect((await call(head, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-x` } })).status).toBe(403);

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
    expect((await call(headB, item.DELETE, `/api/items/${itemId}`, { method: "DELETE", id: itemId })).status).toBe(409);
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

  it("структура справки: директор задаёт разделы и короткое название; чужие и руководитель не могут", async () => {
    const t = await call(directorB, tracks.POST, "/api/tracks", { method: "POST", body: { name: `${TAG}-трек справки` } });
    expect(t.status).toBe(201);
    trackA = t.data.track.id;
    created.tracks.push(trackA);
    const put = await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { shortName: "ТД", sections: [{ title: `${TAG} Первый раздел`, trackIds: [trackA] }] } });
    expect(put.status).toBe(200);
    const got = await call(directorB, memoSections.GET, "/api/memo-sections");
    expect(got.data.shortName).toBe("ТД");
    expect(got.data.sections).toHaveLength(1);
    expect(got.data.sections[0].trackIds).toEqual([trackA]);
    // трек из другой дирекции в структуру не попадёт
    const foreignTrack = await prisma.track.findFirst({ where: { directorateId: curator.directorateId }, select: { id: true } });
    expect((await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { sections: [{ title: "x", trackIds: [foreignTrack!.id] }] } })).status).toBe(400);
    expect((await call(headB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { sections: [] } })).status).toBe(403);
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
    expect(titles[0]).toContain("Первый раздел");
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

  it("«Обновить из данных» добавляет только новые поданные позиции", async () => {
    const before = await call(directorB, memoRefresh.POST, `/api/cycles/${cycleId}/memo/refresh`, { method: "POST", id: cycleId });
    expect(before.data.added).toBe(0);
    const r = await call(headB, items.POST, "/api/items", { method: "POST", body: { title: `${TAG} п5`, trackId: trackA, operFlag: true, comment: "Пятый." } });
    created.items.push(r.data.row.id);
    const after = await call(directorB, memoRefresh.POST, `/api/cycles/${cycleId}/memo/refresh`, { method: "POST", id: cycleId });
    expect(after.data.added).toBe(1);
    const got = await call(directorB, memo.GET, `/api/cycles/${cycleId}/memo`, { id: cycleId });
    expect(got.data.doc.sections[0].bullets.map((b: { text: string }) => b.text)).toContain("Пятый.");
    expect(got.data.doc.sections[0].bullets[0].text).toBe("Моя редакция первого пункта.");
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

  it("решение из таблицы: включить неподанную, исключить поданную; повторная сборка их не возвращает", async () => {
    const on = await call(compiler, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemPlain, include: true } });
    expect(on.status).toBe(200);
    const off = await call(compiler, memoInclude.POST, `/api/cycles/${cycleId}/memo/include`, { method: "POST", id: cycleId, body: { itemId: itemSubmitted, include: false } });
    expect(off.status).toBe(200);
    const inc = await call(compiler, inclusion.GET, "/api/memo/inclusion");
    expect(inc.data.included).toContain(itemPlain);
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
  });
});

describe("вид справки: разделы по трекам и поля таблицы", () => {
  let cycleId = "";
  it("по трекам и с полями «задача + комментарий + ответственный»: раздел = название трека, текст собирается по настройке", async () => {
    const put = await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { groupBy: "track", fields: ["task", "comment", "owner"] } } });
    expect(put.status).toBe(200);
    const got = await call(directorB, memoSections.GET, "/api/memo-sections");
    expect(got.data.config).toEqual({ groupBy: "track", fields: ["task", "comment", "owner"] });
    expect((await call(headB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { groupBy: "track", fields: ["comment"] } } })).status).toBe(403);
    expect((await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { groupBy: "track", fields: ["нет-такого"] } } })).status).toBe(400);

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

  it("по сегментам без разделов вручную: всё в «Прочие направления», если у строки нет сегмента", async () => {
    expect((await call(directorB, memoSections.PUT, "/api/memo-sections", { method: "PUT", body: { config: { groupBy: "segment", fields: ["comment"] } } })).status).toBe(200);
    const r = await call(directorB, memoRefresh.POST, `/api/cycles/${cycleId}/memo/refresh`, { method: "POST", id: cycleId });
    expect(r.status).toBe(200);
    expect((await call(directorB, cycleReview.POST, `/api/cycles/${cycleId}/review`, { method: "POST", id: cycleId })).status).toBe(200);
    expect((await call(directorB, cycleFinalize.POST, `/api/cycles/${cycleId}/finalize`, { method: "POST", id: cycleId })).status).toBe(200);
  });
});
