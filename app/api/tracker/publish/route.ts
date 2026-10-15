import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { isDirectorial } from "@/lib/permissions";
import { getDicts } from "@/lib/dictionaries";
import { publishItem, snapshotOf } from "@/lib/workflow-server";
import { zgdStateFor } from "@/lib/tracker-load";
import { withApiErrors } from "@/lib/api-guard";

/**
 * «Обновить для ЗГД» — это НЕ одобрение работы: директор подтверждает, что ЗГД может видеть актуальное состояние задач
 * (текст, статус, срок, ответственный). Принять работу — только кнопкой «Принять» в задаче.
 * GET — предпросмотр: какие задачи изменились и что именно (по сравнению с тем, что ЗГД видит сейчас).
 * POST — подтвердить выбранные (itemIds обязателен: директор видит и выбирает, массово «всё подряд» не уходит).
 */
const ru = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : "—");

async function GETHandler() {
  const actor = await requireActor();
  if (!isDirectorial(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const [items, seen] = await Promise.all([prisma.operationalItem.findMany({ where: { directorateId, archivedAt: null }, orderBy: { updatedAt: "desc" } }), zgdStateFor(directorateId)]);
  const changed = items.filter((i) => !i.publishedAt || i.updatedAt > i.publishedAt);
  const list = [];
  for (const i of changed) {
    const now = await snapshotOf(i);
    const was = seen.get(i.id);
    const diff: string[] = [];
    if (!was) diff.push("новая задача — ЗГД её ещё не видел");
    else {
      if (was.name !== now.title) diff.push("изменён текст задачи");
      if ((was.comment ?? "") !== (now.comment ?? "")) diff.push("изменён комментарий");
      if ((was.statusName ?? null) !== now.statusName) diff.push(`статус: ${was.statusName ?? "—"} → ${now.statusName ?? "—"}`);
      if ((was.deadline ?? "").slice(0, 10) !== (now.deadline ?? "").slice(0, 10)) diff.push(`срок: ${ru(was.deadline)} → ${ru(now.deadline)}`);
      if ((was.ownerName ?? null) !== now.ownerName) diff.push(`ответственный: ${was.ownerName ?? "—"} → ${now.ownerName ?? "—"}`);
      if ((was.expectedResult ?? "") !== (now.expectedResult ?? "")) diff.push("изменён ожидаемый результат");
      if ((was.blockedBy ?? "") !== (now.blockedBy ?? "")) diff.push(now.blockedBy ? `блокер: ${now.blockedBy}` : "блок снят");
    }
    // правки, которых ЗГД не видит в карточке (подача в справку, документы, свои поля) — тоже показываем, чтобы счётчик сходился
    if (!diff.length) diff.push("служебные изменения (подача в справку, документы, доп. поля) — ЗГД это не меняет");
    list.push({ id: i.id, title: i.title, changes: diff });
  }
  return NextResponse.json({ items: list });
}


async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!isDirectorial(actor.role) || actor.viewAs) return NextResponse.json({ error: "FORBIDDEN", message: "Подтверждает для ЗГД директор." }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const body = (await request.json().catch(() => null)) as { itemIds?: unknown } | null;
  const ids = Array.isArray(body?.itemIds) ? (body!.itemIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  if (!ids.length) return NextResponse.json({ error: "INVALID_INPUT", message: "Выберите задачи, которые ЗГД должен увидеть." }, { status: 400 });
  const items = await prisma.operationalItem.findMany({ where: { directorateId, archivedAt: null, id: { in: ids } } });
  const changed = items.filter((i) => !i.publishedAt || i.updatedAt > i.publishedAt);
  const me = { id: actor.id, name: (await getDicts()).users.get(actor.id)?.name ?? "Директор" };
  for (const i of changed) await publishItem(i, me, "подтвердил(а) актуальность для ЗГД");
  return NextResponse.json({ published: changed.length, total: items.length });
}

export const POST = withApiErrors(POSTHandler);
export const GET = withApiErrors(GETHandler);
