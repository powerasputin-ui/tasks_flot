import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { activeCycle, cycleSummary, sendMissingReminders } from "@/lib/cycles";
import { isDirectorial } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { listDirectorates } from "@/lib/directorates";
import { withApiErrors } from "@/lib/api-guard";

// Экран «Оперативка»: активный цикл, кто сколько отправил, список финальных оперативок.
// Руководство видит только финальные — активный цикл и рабочие цифры для него не отдаются.
async function GETHandler() {
  const actor = await requireActor();

  // Руководителю, который заполняет таблицу: только номер, срок, статус цикла и его собственные цифры.
  // Чужих подач, «Контроля подачи» и отправленных итогов он не получает.
  if (actor.role === "HEAD") {
    const directorateId = requireDirectorate(actor);
    const cycle = await activeCycle(directorateId);
    if (cycle) await sendMissingReminders(cycle);
    const mine = cycle ? (await cycleSummary(directorateId)).find((p) => p.id === actor.id) : undefined;
    return NextResponse.json({
      cycle: cycle ? { id: cycle.id, number: cycle.number, deadline: cycle.deadline, status: cycle.status } : null,
      mine: mine ? { total: mine.total, sent: mine.sent } : { total: 0, sent: 0 },
      summary: [],
      finals: [],
    });
  }
  // ЗГД видит итоги всех дирекций, остальные — только своей.
  const executive = actor.role === "EXECUTIVE";
  const rows = await prisma.cycle.findMany({
    where: { status: "FINAL", ...(executive ? {} : { directorateId: requireDirectorate(actor) }) },
    orderBy: [{ finalizedAt: "desc" }, { number: "desc" }],
    select: { id: true, number: true, deadline: true, finalizedAt: true, directorateId: true },
  });
  const names = new Map((await listDirectorates()).map((d) => [d.id, d.name]));
  const withMemo = new Set((await prisma.memoVersion.findMany({ where: { cycleId: { in: rows.map((r) => r.id) } }, select: { cycleId: true }, distinct: ["cycleId"] })).map((m) => m.cycleId));
  const finals = rows.map(({ directorateId, ...f }) => ({ ...f, directorate: (directorateId && names.get(directorateId)) || null, hasMemo: withMemo.has(f.id) }));
  if (executive) return NextResponse.json({ cycle: null, summary: [], finals });

  const directorateId = requireDirectorate(actor);
  const cycle = await activeCycle(directorateId);
  if (cycle && isDirectorial(actor.role)) await sendMissingReminders(cycle);
  return NextResponse.json({ cycle, summary: cycle ? await cycleSummary(directorateId) : [], finals, directorate: names.get(directorateId) ?? null });
}

export const GET = withApiErrors(GETHandler);
