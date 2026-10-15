import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { isDirectorial } from "@/lib/permissions";
import { getDicts } from "@/lib/dictionaries";
import { publishItem } from "@/lib/workflow-server";
import { withApiErrors } from "@/lib/api-guard";

/**
 * «Обновить для ЗГД»: директор подтверждает текущее состояние задач своей дирекции (все или выбранные).
 * Подтверждаются только изменённые после прошлого подтверждения — ЗГД не получает пустых «обновлений».
 */
async function POSTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (!isDirectorial(actor.role) || actor.viewAs) return NextResponse.json({ error: "FORBIDDEN", message: "Подтверждает для ЗГД директор." }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const body = (await request.json().catch(() => null)) as { itemIds?: unknown } | null;
  const ids = Array.isArray(body?.itemIds) ? (body!.itemIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 500) : null;
  const items = await prisma.operationalItem.findMany({ where: { directorateId, archivedAt: null, ...(ids ? { id: { in: ids } } : {}) } });
  const changed = items.filter((i) => !i.publishedAt || i.updatedAt > i.publishedAt);
  const me = { id: actor.id, name: (await getDicts()).users.get(actor.id)?.name ?? "Директор" };
  for (const i of changed) await publishItem(i, me, "подтвердил(а) состояние для ЗГД");
  return NextResponse.json({ published: changed.length, total: items.length });
}

export const POST = withApiErrors(POSTHandler);
