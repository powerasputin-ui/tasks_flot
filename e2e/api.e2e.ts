import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

// Сессия подменяется: тест вызывает настоящие маршруты от имени выбранного пользователя.
const state = vi.hoisted(() => ({ actor: null as null | { id: string; role: string; name: string } }));
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

const prisma = new PrismaClient();
const TAG = `E2E${Date.now()}`;

type Actor = { id: string; role: string; name: string };
let curator: Actor;
let head: Actor;
const admin: Actor = { id: "e2e-admin", role: "SYSTEM_ADMIN", name: "E2E admin" };
const management: Actor = { id: "e2e-mgmt", role: "MANAGEMENT", name: "E2E management" };

const created = { items: [] as string[], columns: [] as string[], tracks: [] as string[], cycles: [] as string[] };
let originalLayout: unknown = undefined;

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
  curator = await prisma.user.findFirstOrThrow({ where: { role: "CURATOR", isActive: true }, select: { id: true, name: true, role: true } });
  head = await prisma.user.findFirstOrThrow({ where: { role: "HEAD", isActive: true }, select: { id: true, name: true, role: true } });
  originalLayout = (await prisma.appSetting.findUnique({ where: { key: "table.columns" } }))?.value ?? null;
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
  if (originalLayout === undefined) {
    // beforeAll не отработал — общий вид колонок не трогали
  } else if (originalLayout === null) await prisma.appSetting.deleteMany({ where: { key: "table.columns" } });
  else await prisma.appSetting.update({ where: { key: "table.columns" }, data: { value: originalLayout as object } });
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
  it("руководитель не управляет пользователями; куратор не создаёт кураторов и не правит не-ответственных", async () => {
    expect((await call(head, users.POST, "/api/users", { method: "POST", body: { name: "x", email: `${TAG}@e2e.local`, password: "longpassword1", role: "HEAD" } })).status).toBe(403);
    expect((await call(curator, users.POST, "/api/users", { method: "POST", body: { name: "x", email: `${TAG}@e2e.local`, password: "longpassword1", role: "CURATOR" } })).status).toBe(403);
    expect((await call(curator, user.PATCH, `/api/users/${curator.id}`, { method: "PATCH", id: curator.id, body: { isActive: false } })).status).toBe(403);
    expect(await prisma.user.findUnique({ where: { email: `${TAG}@e2e.local` } })).toBeNull();
  });

  it("куратор видит в списке ответственных руководителей и кураторов (но не администратора и руководство), e-mail виден ему, руководителю — нет", async () => {
    const c = await call(curator, users.GET, "/api/users?all=1");
    expect(c.data.users.every((u: { role: string }) => u.role === "HEAD" || u.role === "CURATOR")).toBe(true);
    expect(c.data.users.some((u: { id: string }) => u.id === curator.id)).toBe(true);
    expect(c.data.users[0].email).toBeTruthy();
    const h = await call(head, users.GET, "/api/users?all=1");
    expect(h.data.users[0].email).toBeUndefined();
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
