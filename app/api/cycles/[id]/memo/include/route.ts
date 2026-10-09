import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canEditMemo, loadMemo, loadSectionDefs, loadSources } from "@/lib/memo-load";
import { setIncluded } from "@/lib/memo";
import { withApiErrors } from "@/lib/api-guard";
import { diffMemo, isEmptyDiff, stampChanges } from "@/lib/memo-changes";
import { logMemoEdit } from "@/lib/memo-log";
import { ITEM_ERROR_STATUS, updateItem } from "@/lib/items";
import { isSubmitter } from "@/lib/permissions";

// Решение «в справку / не в справку» по одной строке (из таблицы или из редактора). Тело: { itemId, include }.
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const cycle = await prisma.cycle.findUnique({ where: { id } });
  if (!cycle || !canEditMemo(actor, cycle)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (cycle.status === "FINAL") return NextResponse.json({ error: "BAD_STATE" }, { status: 409 });
  const body = (await request.json().catch(() => null)) as { itemId?: string; include?: boolean } | null;
  if (!body?.itemId || typeof body.include !== "boolean") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  // Своя строка составителя (директор/админ сам ответственный, или автор строки без ответственного): подавать её
  // некому — он и есть получатель. Поэтому «в справку» сразу и подаёт её (обычной правкой позиции, с историей).
  if (body.include) {
    const raw = await prisma.operationalItem.findUnique({ where: { id: body.itemId }, select: { operFlag: true, responsibleId: true, createdById: true, version: true, directorateId: true, archivedAt: true } });
    // только тем, у кого нет своей кнопки «Отправить директору» (директор, админ без «подаёт как руководитель»)
    const own = !isSubmitter(actor) && !!raw && raw.directorateId === cycle.directorateId && !raw.archivedAt && (raw.responsibleId === actor.id || (!raw.responsibleId && raw.createdById === actor.id));
    if (raw && own && !raw.operFlag) {
      const sub = await updateItem(actor, body.itemId, { operFlag: true, version: raw.version });
      if (!sub.ok) return NextResponse.json({ error: sub.error, message: "message" in sub ? sub.message : undefined }, { status: ITEM_ERROR_STATUS[sub.error] });
    }
  }
  const [state, defs] = await Promise.all([loadMemo(cycle), loadSectionDefs(cycle.directorateId ?? "")]);
  const sources = await loadSources(cycle.directorateId ?? "", undefined, defs);
  const item = sources.find((s) => s.id === body.itemId);
  if (!item) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (body.include && !item.operFlag) return NextResponse.json({ error: "NOT_SUBMITTED", message: "Строка ещё не отправлена директору — в справку попадает только поданное." }, { status: 409 });
  const changed = setIncluded(state.doc, item, body.include, defs, sources);
  const now = new Date();
  const doc = stampChanges(state.doc, changed, actor.name, now); // кто включил/изменил пункт — видно в справке
  const res = await prisma.cycle.updateMany({ where: { id, memoVersion: state.version }, data: { memoDraft: doc as unknown as Prisma.InputJsonValue, memoVersion: { increment: 1 } } });
  if (res.count !== 1) return NextResponse.json({ error: "CONFLICT" }, { status: 409 });
  const diff = { ...diffMemo(state.doc, changed), meeting: false };
  if (!isEmptyDiff(diff)) await logMemoEdit({ id: actor.id, name: actor.name, role: actor.role }, cycle, diff, now);
  return NextResponse.json({ ok: true, included: body.include, version: state.version + 1 });
}

export const POST = withApiErrors(POSTHandler);
