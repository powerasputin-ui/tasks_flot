import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { withApiErrors } from "@/lib/api-guard";

export type WeekListItem = {
  cycleId: string;
  number: number;
  meetingDate: string | null;
  sentAt: string;
  revisions: number;
  /** Строк в таблице на момент отправки; null — у старых оперативок полный снимок не сохранялся. */
  rowsCount: number | null;
  submitted: number | null;
  inMemo: number | null;
};

type Counts = { cycleId: string; revisions: bigint; rowsCount: bigint | null; submitted: bigint | null; inMemo: bigint | null };

/**
 * Недели своей дирекции: завершённые оперативки (новые сверху) и текущая. Для тех, кто видит таблицу
 * (руководитель, директор, админ, тех. админ); у ЗГД своя вкладка «Архив».
 */
async function GETHandler() {
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);

  const [cycles, current] = await Promise.all([
    prisma.cycle.findMany({ where: { directorateId, status: "FINAL" }, orderBy: { number: "desc" }, take: 60, select: { id: true, number: true, meetingDate: true, finalizedAt: true, createdAt: true } }),
    prisma.cycle.findFirst({ where: { directorateId, status: { not: "FINAL" } }, select: { id: true, number: true, status: true, deadline: true } }),
  ]);

  // счётчики считает база: в снимке сотни строк, тянуть их ради двух чисел незачем
  const ids = cycles.map((c) => c.id);
  const counts = ids.length
    ? await prisma.$queryRaw<Counts[]>`
        SELECT DISTINCT ON (v."cycleId") v."cycleId" AS "cycleId",
          (SELECT count(*) FROM memo_versions x WHERE x."cycleId" = v."cycleId") AS revisions,
          CASE WHEN jsonb_typeof(v.rows) = 'array' THEN jsonb_array_length(v.rows) END AS "rowsCount",
          CASE WHEN jsonb_typeof(v.rows) = 'array' THEN (SELECT count(*) FROM jsonb_array_elements(v.rows) e WHERE e->>'submitted' = 'true') END AS submitted,
          CASE WHEN jsonb_typeof(v.rows) = 'array' THEN (SELECT count(*) FROM jsonb_array_elements(v.rows) e WHERE e->>'inMemo' = 'true') END AS "inMemo"
        FROM memo_versions v
        WHERE v."cycleId" = ANY(${ids}) AND v."directorateId" = ${directorateId}
        ORDER BY v."cycleId", v.revision DESC`
    : [];
  const byCycle = new Map(counts.map((c) => [c.cycleId, c]));
  const sent = await prisma.memoVersion.findMany({
    where: { cycleId: { in: ids }, directorateId },
    orderBy: { revision: "desc" },
    distinct: ["cycleId"],
    select: { cycleId: true, sentAt: true },
  });
  const sentAt = new Map(sent.map((s) => [s.cycleId, s.sentAt]));

  // оперативка без единой отправленной версии (завершена без справки) — в неделях не показываем: смотреть нечего
  const weeks: WeekListItem[] = cycles.flatMap((c) => {
    const at = sentAt.get(c.id);
    if (!at) return [];
    const k = byCycle.get(c.id);
    const n = (v: bigint | null | undefined) => (v === null || v === undefined ? null : Number(v));
    return [{ cycleId: c.id, number: c.number, meetingDate: c.meetingDate?.toISOString() ?? null, sentAt: at.toISOString(), revisions: n(k?.revisions) ?? 1, rowsCount: n(k?.rowsCount), submitted: n(k?.submitted), inMemo: n(k?.inMemo) }];
  });

  return NextResponse.json({ current: current ? { cycleId: current.id, number: current.number, status: current.status, deadline: current.deadline.toISOString() } : null, weeks });
}

export const GET = withApiErrors(GETHandler);
