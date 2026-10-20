import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canViewItems } from "@/lib/permissions";
import { normalizeShownFilters, tableFiltersKey } from "@/lib/table-filters";
import { withApiErrors } from "@/lib/api-guard";

const schema = z.object({ shown: z.array(z.string().max(40)).max(20) });

/**
 * Какие фильтры держать в ряду над таблицей — личный выбор человека (галочки в «+ Фильтры»), на всех его устройствах.
 * Отдаётся вместе с /api/bootstrap (tableFilters); здесь только сохранение.
 */
async function PUTHandler(request: NextRequest) {
  const actor = await requireActor();
  // «Посмотреть как»: чужие настройки не меняем
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN", message: "В режиме просмотра настройки не сохраняются." }, { status: 403 });
  if (!canViewItems(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const key = tableFiltersKey(actor.id);
  const shown = normalizeShownFilters(parsed.data.shown);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: shown }, update: { value: shown } });
  return NextResponse.json({ shown });
}

export const PUT = withApiErrors(PUTHandler);
