import { prisma } from "@/lib/prisma";
import type { Cycle, CycleStatus, Prisma } from "@prisma/client";
import { archiveLayout, buildArchiveRows } from "@/lib/archive-table";
import { DEFAULT_COLUMNS, normalizeColumns, withCustomColumns, type ColumnConfig, type CustomCol } from "@/lib/table-columns";
import { recordFieldChanges, TRACKED_ITEM_FIELDS } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { loadTableRows } from "@/lib/table-view";
import { prepareVersion } from "@/lib/memo-versions";
import { refreshMemoDraft } from "@/lib/memo-load";
import { isDirectorial, type Actor } from "@/lib/permissions";

/**
 * Цикл оперативки (ТЗ v4, раздел 5): OPEN → IN_REVIEW → FINAL.
 * Все переходы — здесь, API-маршруты только разбирают запрос.
 * «Отправка» позиции — галка «Опер» (operFlag); «вернуть» — снять галку с комментарием куратора.
 */
export const REMINDER_DAYS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CycleError = "FORBIDDEN" | "NOT_FOUND" | "CYCLE_EXISTS" | "BAD_STATE" | "INVALID_INPUT";
export type CycleResult<T = object> = ({ ok: true } & T) | { ok: false; error: CycleError };

export const CYCLE_ERROR_STATUS: Record<CycleError, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CYCLE_EXISTS: 409,
  BAD_STATE: 409,
  INVALID_INPUT: 400,
};

/** Разрешённые переходы статуса цикла. */
const TRANSITIONS: Record<CycleStatus, CycleStatus[]> = {
  OPEN: ["IN_REVIEW"],
  IN_REVIEW: ["FINAL"],
  FINAL: [],
};

export function canTransition(from: CycleStatus, to: CycleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Напоминание «не подал» уходит за REMINDER_DAYS дня до срока и позже (пока цикл не финализирован). */
export function reminderDue(deadline: Date, now: Date = new Date()): boolean {
  return now.getTime() >= deadline.getTime() - REMINDER_DAYS * DAY_MS;
}

const isCurator = (a: Actor) => isDirectorial(a.role);

export async function activeCycle(directorateId: string): Promise<Cycle | null> {
  return prisma.cycle.findFirst({ where: { directorateId, status: { not: "FINAL" } }, orderBy: { number: "desc" } });
}

export async function createCycle(actor: Actor, deadline: Date): Promise<CycleResult<{ id: string }>> {
  if (!isCurator(actor)) return { ok: false, error: "FORBIDDEN" };
  if (Number.isNaN(deadline.getTime())) return { ok: false, error: "INVALID_INPUT" };
  const directorateId = actor.directorateId;
  if (!directorateId) return { ok: false, error: "FORBIDDEN" };
  // Два одновременных запроса не должны завести две активные оперативки: проверка и создание идут под блокировкой дирекции.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cycle:${directorateId}`}))`;
    if (await tx.cycle.findFirst({ where: { directorateId, status: { not: "FINAL" } }, select: { id: true } })) return null;
    const last = await tx.cycle.findFirst({ where: { directorateId }, orderBy: { number: "desc" }, select: { number: true } });
    return tx.cycle.create({ data: { number: (last?.number ?? 0) + 1, directorateId, deadline, createdById: actor.id } });
  });
  if (!created) return { ok: false, error: "CYCLE_EXISTS" };
  return { ok: true, id: created.id };
}

export async function startReview(actor: Actor, id: string): Promise<CycleResult> {
  if (!isCurator(actor)) return { ok: false, error: "FORBIDDEN" };
  const cycle = await prisma.cycle.findFirst({ where: { id, directorateId: actor.directorateId ?? "" } });
  if (!cycle) return { ok: false, error: "NOT_FOUND" };
  if (!canTransition(cycle.status, "IN_REVIEW")) return { ok: false, error: "BAD_STATE" };
  const started = await prisma.cycle.update({ where: { id }, data: { status: "IN_REVIEW", reviewStartedAt: new Date() } });
  // «Сборка»: справка догоняет поданное. Черновик мог быть создан раньше, когда почти ничего не было подано, — без этого
  // директор отправил бы ЗГД справку без поданных позиций. Правки директора не трогаются.
  await refreshMemoDraft(started).catch(() => null);
  return { ok: true };
}

/**
 * Финализация: в неизменяемый снимок попадают отправленные (operFlag) неархивные позиции.
 * После этого галки «Опер» сбрасываются — следующий цикл начинается с чистого листа.
 */
export async function finalizeCycle(actor: Actor & { name: string }, id: string, note: string | null = null): Promise<CycleResult<{ count: number }>> {
  if (!isCurator(actor)) return { ok: false, error: "FORBIDDEN" };
  const cycle = await prisma.cycle.findFirst({ where: { id, directorateId: actor.directorateId ?? "" } });
  if (!cycle) return { ok: false, error: "NOT_FOUND" };
  if (!canTransition(cycle.status, "FINAL")) return { ok: false, error: "BAD_STATE" };

  const directorateId = cycle.directorateId ?? "";
  const all = await loadTableRows("active", directorateId);
  const sent = all.filter((r) => r.operFlag);
  // Названия своих колонок фиксируем в снимке: позже колонку могут переименовать или удалить.
  const custom = await prisma.customColumn.findMany({ where: { isActive: true, directorateId: cycle.directorateId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const snapshot = JSON.parse(
    JSON.stringify(sent.map((r) => ({ ...r, customFields: custom.map((c) => ({ name: c.name, type: c.type, value: r.customValues[c.id] ?? null })) })))
  );

  // Справка (неизменяемая версия для ЗГД) фиксируется вместе со снимком строк
  const { sourceItemIds, ...version } = await prepareVersion(cycle, actor, note?.trim() || null, await cycleSummary(directorateId));

  // Архив: вся таблица дирекции на момент отправки и её раскладка (столбцы, названия, порядок сегментов)
  const [layoutSetting, segments] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: `table.columns:${directorateId}` } }),
    prisma.segment.findMany({ where: { directorateId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true } }),
  ]);
  const savedColumns = Array.isArray(layoutSetting?.value) ? (layoutSetting!.value as unknown as ColumnConfig[]) : DEFAULT_COLUMNS;
  const customCols: CustomCol[] = custom.map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options }));
  const layout = archiveLayout(withCustomColumns(normalizeColumns(savedColumns.map((c) => ({ ...c }))), customCols), customCols, segments);
  const archiveRows = buildArchiveRows(all, sourceItemIds, segments);

  const created = await prisma.$transaction(async (tx) => {
    // условие по статусу защищает от двойной финализации
    const upd = await tx.cycle.updateMany({
      where: { id, status: "IN_REVIEW" },
      data: { status: "FINAL", finalizedAt: new Date(), finalizedById: actor.id, snapshot },
    });
    if (upd.count !== 1) throw new Error("BAD_STATE");
    await tx.operationalItem.updateMany({
      where: { id: { in: sent.map((r) => r.id) } },
      data: { operFlag: false, version: { increment: 1 } },
    });
    return tx.memoVersion.create({
      data: { ...version, rows: archiveRows as unknown as Prisma.InputJsonValue, columns: layout as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
  });

  // ЗГД получает уведомление, что пришла справка — ссылка сразу на неё
  const executives = await prisma.user.findMany({ where: { role: "EXECUTIVE", isActive: true }, select: { id: true } });
  for (const e of executives) {
    await createNotification({ userId: e.id, type: "MEMO_SENT", message: `Получена справка: ${version.title}${cycle.revision > 1 ? ` (ред. ${cycle.revision})` : ""}`, link: `/operativka?tab=finals&memo=${created.id}` });
  }
  return { ok: true, count: sent.length };
}

/** Куратор возвращает отправленную позицию: галка снимается, к позиции — замечание, ответственному — уведомление. */
export async function returnItem(actor: Actor, itemId: string, comment: string): Promise<CycleResult> {
  if (!isCurator(actor)) return { ok: false, error: "FORBIDDEN" };
  const text = comment.trim();
  if (!text) return { ok: false, error: "INVALID_INPUT" };
  const existing = await prisma.operationalItem.findFirst({ where: { id: itemId, directorateId: actor.directorateId ?? "" } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };
  if (!existing.operFlag || existing.archivedAt) return { ok: false, error: "BAD_STATE" };

  await prisma.$transaction(async (tx) => {
    const updated = await tx.operationalItem.update({
      where: { id: itemId },
      data: { operFlag: false, updatedById: actor.id, version: { increment: 1 } },
    });
    await tx.itemNote.create({ data: { itemId, authorId: actor.id, text } });
    await recordFieldChanges(
      { entityType: "OperationalItem", entityId: itemId, actorId: actor.id, before: existing, after: updated, trackedFields: TRACKED_ITEM_FIELDS },
      tx
    );
  });
  if (existing.responsibleId && existing.responsibleId !== actor.id) {
    await createNotification({
      userId: existing.responsibleId,
      type: "ITEM_RETURNED",
      message: `Куратор вернул позицию «${existing.title}»: ${text}`,
      link: "/table",
    });
  }
  return { ok: true };
}

export type PersonSummary = { id: string; name: string; role: string; total: number; sent: number };

/** Кто сколько заполнил и сколько отправил куратору (руководители и кураторы, заполняющие позиции). */
export async function cycleSummary(directorateId: string): Promise<PersonSummary[]> {
  const [users, items] = await Promise.all([
    prisma.user.findMany({ where: { directorateId, isActive: true, role: { in: ["HEAD", "DIRECTOR", "ADMIN"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    prisma.operationalItem.findMany({ where: { directorateId, archivedAt: null, responsibleId: { not: null } }, select: { responsibleId: true, operFlag: true } }),
  ]);
  return users
    .map((u) => {
      const mine = items.filter((i) => i.responsibleId === u.id);
      return { id: u.id, name: u.name, role: u.role, total: mine.length, sent: mine.filter((i) => i.operFlag).length };
    })
    // директор и админ без своих позиций — не «участники подачи»: им нечего подавать, в «не подали» и в напоминания они не попадают
    .filter((p) => p.role === "HEAD" || p.total > 0);
}

/**
 * Напоминание кураторам «ФИО ничего не заполнил и не подал» — один раз на цикл, за REMINDER_DAYS до срока.
 * Вызывается при открытии экрана цикла; отметка remindersSentAt делает вызов идемпотентным.
 */
export async function sendMissingReminders(cycle: Cycle, now: Date = new Date()): Promise<number> {
  if (cycle.status === "FINAL" || cycle.remindersSentAt || !reminderDue(cycle.deadline, now)) return 0;
  const claimed = await prisma.cycle.updateMany({ where: { id: cycle.id, remindersSentAt: null }, data: { remindersSentAt: now } });
  if (claimed.count !== 1) return 0; // другой запрос уже отправил

  const missing = (await cycleSummary(cycle.directorateId ?? "")).filter((p) => p.sent === 0);
  if (missing.length === 0) return 0;
  const curators = await prisma.user.findMany({ where: { directorateId: cycle.directorateId, role: { in: ["DIRECTOR", "ADMIN"] }, isActive: true }, select: { id: true } });
  const names = missing.map((p) => p.name).join(", ");
  const due = cycle.deadline.toLocaleDateString("ru-RU");
  // сам не подавший руководитель получает личное напоминание
  for (const p of missing.filter((m) => m.role === "HEAD")) {
    await createNotification({
      userId: p.id,
      type: "SUBMISSION_MISSING",
      message: `Оперативка №${cycle.number}: срок подачи ${due}. Вы ещё ничего не отправили директору — отметьте позиции галкой «Опер».`,
      link: "/table",
    });
  }
  for (const c of curators) {
    await createNotification({
      userId: c.id,
      type: "SUBMISSION_MISSING",
      message: `Оперативка №${cycle.number}, срок ${due}: не подали позиции — ${names}`,
      link: "/operativka",
    });
  }
  return missing.length;
}

/** Не чаще одного ручного напоминания одному человеку за это время — чтобы кнопку нельзя было нажать «по кругу». */
export const REMIND_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Директор/админ напоминает тем, кто ещё ничего не подал в этой оперативке (по одному человеку или всем сразу).
 * Напоминание приходит самому человеку в уведомления. Тем, кто уже подал, и тем, кому недавно напоминали, не отправляется.
 */
export async function remindMissing(actor: Actor, cycleId: string, userIds?: string[], now: Date = new Date()): Promise<CycleResult<{ sent: number; skippedRecent: number }>> {
  if (!isCurator(actor)) return { ok: false, error: "FORBIDDEN" };
  const cycle = await prisma.cycle.findFirst({ where: { id: cycleId, directorateId: actor.directorateId ?? "" } });
  if (!cycle) return { ok: false, error: "NOT_FOUND" };
  if (cycle.status === "FINAL") return { ok: false, error: "BAD_STATE" };
  const wanted = userIds ? new Set(userIds) : null;
  const targets = (await cycleSummary(cycle.directorateId ?? "")).filter((p) => p.sent === 0 && p.id !== actor.id && (!wanted || wanted.has(p.id)));
  const due = cycle.deadline.toLocaleDateString("ru-RU");
  const prefix = `Напоминание · Оперативка №${cycle.number}`;
  let sent = 0;
  let skippedRecent = 0;
  for (const p of targets) {
    const recent = await prisma.notification.findFirst({
      where: { userId: p.id, type: "SUBMISSION_MISSING", message: { startsWith: prefix }, createdAt: { gte: new Date(now.getTime() - REMIND_COOLDOWN_MS) } },
      select: { id: true },
    });
    if (recent) {
      skippedRecent++;
      continue;
    }
    await createNotification({
      userId: p.id,
      type: "SUBMISSION_MISSING",
      message: `${prefix}: срок подачи ${due}. Вы ещё ничего не отправили — отметьте позиции кнопкой «Отправить».`,
      link: "/table",
    });
    sent++;
  }
  return { ok: true, sent, skippedRecent };
}
