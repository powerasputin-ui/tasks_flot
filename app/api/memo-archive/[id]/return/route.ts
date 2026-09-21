import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { createNotification } from "@/lib/notifications";
import { parseMemoDoc } from "@/lib/memo";

/**
 * ЗГД возвращает справку директору с комментарием. Оперативка снова открывается на «Сборке» как следующая ревизия:
 * черновик — копия возвращённой справки, поданные позиции снова помечены «Опер», директору и составителям уходит уведомление.
 * Отправленная версия остаётся неизменной (в архиве видна как «возвращена»).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  if (actor.role !== "EXECUTIVE") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { comment?: unknown } | null;
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
  if (!comment) return NextResponse.json({ error: "INVALID_INPUT", message: "Напишите, что нужно исправить." }, { status: 400 });

  const v = await prisma.memoVersion.findUnique({ where: { id }, include: { cycle: true } });
  if (!v) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (v.returnedAt || v.revision !== v.cycle.revision || v.cycle.status !== "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });
  // пока идёт другая оперативка дирекции, вернуть эту нельзя: у дирекции не может быть двух активных
  if (await prisma.cycle.findFirst({ where: { directorateId: v.directorateId, status: { not: "FINAL" } }, select: { id: true } })) return NextResponse.json({ error: "CYCLE_EXISTS" }, { status: 409 });

  const doc = parseMemoDoc(v.doc) ?? { sections: [] };
  const itemIds = doc.sections.flatMap((s) => s.bullets.filter((b) => !b.hidden).flatMap((b) => b.itemIds));

  await prisma.$transaction(async (tx) => {
    const marked = await tx.memoVersion.updateMany({ where: { id, returnedAt: null }, data: { returnedAt: new Date(), returnComment: comment, returnedByName: actor.name } });
    if (marked.count !== 1) throw new Error("BAD_STATE");
    await tx.cycle.update({
      where: { id: v.cycleId },
      data: {
        status: "IN_REVIEW",
        revision: { increment: 1 },
        finalizedAt: null,
        finalizedById: null,
        memoDraft: doc as unknown as Prisma.InputJsonValue,
        memoVersion: { increment: 1 },
      },
    });
    // те же строки снова подписаны «Опер», чтобы директор видел прежний пакет
    if (itemIds.length) await tx.operationalItem.updateMany({ where: { id: { in: itemIds }, directorateId: v.directorateId, archivedAt: null }, data: { operFlag: true, version: { increment: 1 } } });
  });

  const recipients = await prisma.user.findMany({
    where: { directorateId: v.directorateId, isActive: true, OR: [{ role: { in: ["DIRECTOR", "ADMIN"] } }, { memoEditor: true }] },
    select: { id: true },
  });
  for (const r of recipients) {
    await createNotification({ userId: r.id, type: "MEMO_RETURNED", message: `ЗГД вернул справку «${v.title}»: ${comment}`, link: "/operativka" });
  }
  return NextResponse.json({ ok: true });
}
