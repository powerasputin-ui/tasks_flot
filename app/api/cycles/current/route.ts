import { NextResponse } from "next/server";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { activeCycle, cycleSummary, sendMissingReminders } from "@/lib/cycles";

// Экран «Оперативка»: активный цикл, кто сколько отправил, список финальных оперативок.
// Руководство видит только финальные — активный цикл и рабочие цифры для него не отдаются.
export async function GET() {
  const actor = await requireActor();
  const finals = await prisma.cycle.findMany({
    where: { status: "FINAL" },
    orderBy: { number: "desc" },
    select: { id: true, number: true, deadline: true, finalizedAt: true },
  });
  if (actor.role === "MANAGEMENT") return NextResponse.json({ cycle: null, summary: [], finals });

  const cycle = await activeCycle();
  if (cycle && actor.role === "CURATOR") await sendMissingReminders(cycle);
  return NextResponse.json({ cycle, summary: cycle ? await cycleSummary() : [], finals });
}
