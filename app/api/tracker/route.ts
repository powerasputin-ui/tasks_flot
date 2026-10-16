import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActor, requireFreshSession } from "@/lib/session";
import { requireDirectorate } from "@/lib/scope";
import { canManageDirectory, canViewItems } from "@/lib/permissions";
import { loadSentTracker, loadTracker } from "@/lib/tracker-load";
import { TRACKER_SETTING } from "@/lib/tracker";
import { withApiErrors } from "@/lib/api-guard";

// «Трекер»: позиции таблицы, колонки статусов, история (журнал + отправленные справки) и «горит».
// Права — как у таблицы; ЗГД рабочих позиций не видит — ему трекер по отправленным справкам (снимки таблиц), только чтение.
async function GETHandler(request: NextRequest) {
  const actor = await requireActor();
  if (actor.role === "EXECUTIVE") return NextResponse.json(await loadSentTracker());
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  // ?archive=archived — «Удалённые» трекера (те же задачи, что в «Удалённых» таблицы); любое другое значение — рабочие
  const archived = new URL(request.url).searchParams.get("archive") === "archived";
  return NextResponse.json(await loadTracker(requireDirectorate(actor), { archived }));
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
