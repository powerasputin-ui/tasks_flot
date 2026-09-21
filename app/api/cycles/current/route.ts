import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { activeCycle, cycleSummary, sendMissingReminders } from "@/lib/cycles";
import { isDirectorial } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { listDirectorates } from "@/lib/directorates";

// Экран «Оперативка»: активный цикл, кто сколько отправил, список финальных оперативок.
// Руководство видит только финальные — активный цикл и рабочие цифры для него не отдаются.
export async function GET() {
  const actor = await requireActor();
  // ЗГД видит итоги всех дирекций, остальные — только своей.
  const executive = actor.role === "EXECUTIVE";
  const rows = await prisma.cycle.findMany({
    where: { status: "FINAL", ...(executive ? {} : { directorateId: requireDirectorate(actor) }) },
    orderBy: [{ finalizedAt: "desc" }, { number: "desc" }],
    select: { id: true, number: true, deadline: true, finalizedAt: true, directorateId: true },
  });
  const names = new Map((await listDirectorates()).map((d) => [d.id, d.name]));
  const finals = rows.map(({ directorateId, ...f }) => ({ ...f, directorate: (directorateId && names.get(directorateId)) || null }));
  if (executive) return NextResponse.json({ cycle: null, summary: [], finals });

  const directorateId = requireDirectorate(actor);
  const cycle = await activeCycle(directorateId);
  if (cycle && isDirectorial(actor.role)) await sendMissingReminders(cycle);
  return NextResponse.json({ cycle, summary: cycle ? await cycleSummary(directorateId) : [], finals, directorate: names.get(directorateId) ?? null });
}
