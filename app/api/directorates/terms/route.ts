import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { canManageSegments } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { normalizeTerms, TERM_MAX, termsKey } from "@/lib/terms";
import { withApiErrors } from "@/lib/api-guard";

const schema = z.object({ one: z.string().max(TERM_MAX * 2), many: z.string().max(TERM_MAX * 2) });

/**
 * Как дирекция называет разделы своей таблицы («Сегмент / Сегменты» → «Проект / Проекты»): директор (в своей дирекции) и админ
 * (в выбранной). Отдаётся вместе с /api/bootstrap (terms); здесь только сохранение. Пустые поля — названия по умолчанию.
 */
async function PUTHandler(request: NextRequest) {
  const actor = await requireActor();
  if (actor.viewAs) return NextResponse.json({ error: "FORBIDDEN", message: "В режиме просмотра настройки не сохраняются." }, { status: 403 });
  if (!canManageSegments(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const key = termsKey(requireDirectorate(actor));
  const terms = normalizeTerms(parsed.data);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value: terms }, update: { value: terms } });
  return NextResponse.json({ terms });
}

export const PUT = withApiErrors(PUTHandler);
