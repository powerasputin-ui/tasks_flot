import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor, requireFreshSession } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { canManageDirectory, canViewItems } from "@/lib/permissions";
import { loadTracker } from "@/lib/tracker-load";
import { TRACKER_SETTING } from "@/lib/tracker";
import { withApiErrors } from "@/lib/api-guard";

// «Трекер»: позиции таблицы, колонки статусов, история (журнал + отправленные справки) и «горит».
// Права — как у таблицы: ЗГД рабочих позиций не видит.
async function GETHandler() {
  const actor = await requireActor();
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json(await loadTracker(requireDirectorate(actor)));
}

export const GET = withApiErrors(GETHandler);

// Показать/скрыть пункт «Трекер» у всех (админ). Данные не трогает — только меню.
async function PATCHHandler(request: NextRequest) {
  const session = await requireFreshSession();
  if (!canManageDirectory(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const enabled = (await request.json().catch(() => null))?.enabled;
  if (typeof enabled !== "boolean") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  await prisma.appSetting.upsert({ where: { key: TRACKER_SETTING }, create: { key: TRACKER_SETTING, value: enabled }, update: { value: enabled } });
  return NextResponse.json({ enabled });
}

export const PATCH = withApiErrors(PATCHHandler);
