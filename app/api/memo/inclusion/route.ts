import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canCompileMemo } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { loadMemo } from "@/lib/memo-load";
import { withApiErrors } from "@/lib/api-guard";

// Для колонки «В справку» в таблице: какие позиции сейчас в справке активной оперативки и по каким решения ещё нет.
async function GETHandler() {
  const actor = await requireActor();
  if (!canCompileMemo(actor)) return NextResponse.json({ cycleId: null });
  const cycle = await prisma.cycle.findFirst({ where: { directorateId: requireDirectorate(actor), status: { not: "FINAL" } }, orderBy: { number: "desc" } });
  if (!cycle) return NextResponse.json({ cycleId: null });
  const state = await loadMemo(cycle);
  const bullets = state.doc.sections.flatMap((s) => s.bullets);
  return NextResponse.json({
    cycleId: cycle.id,
    number: cycle.number,
    included: [...new Set(bullets.filter((b) => !b.hidden).flatMap((b) => b.itemIds))],
    known: [...new Set(bullets.flatMap((b) => b.itemIds))],
  });
}

export const GET = withApiErrors(GETHandler);
