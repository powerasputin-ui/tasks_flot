import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { isDirectorial } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { invalidateDirectorates } from "@/lib/directorates";
import { loadFieldOptions, loadMemoConfig, loadSources } from "@/lib/memo-load";

const putSchema = z.object({
  shortName: z.string().trim().max(60).nullable().optional(),
  /** Вид справки: отмеченные столбцы таблицы, попадающие в текст пункта. Разделы («1. …», «2. …») — всегда по трекам, не настраиваются. */
  config: z.object({ fields: z.array(z.string().regex(/^(segment|track|task|comment|owner|deadline|status|cost|attractiveness|custom:[\w-]{1,80})$/)).min(1).max(40) }).optional(),
});

// Вид справки дирекции: отмеченные столбцы, короткое название; пример реальной строки для предпросмотра.
export async function GET() {
  const actor = await requireActor();
  if (!isDirectorial(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const [dir, config, sources, fields] = await Promise.all([
    prisma.directorate.findUnique({ where: { id: directorateId }, select: { name: true, shortName: true } }),
    loadMemoConfig(directorateId),
    loadSources(directorateId),
    loadFieldOptions(directorateId),
  ]);
  // для предпросмотра — реальная поданная строка с комментарием (иначе любая с комментарием, иначе любая)
  const sample = sources.find((s) => s.operFlag && s.comment) ?? sources.find((s) => s.comment) ?? sources[0] ?? null;
  const known = new Set(fields.map((o) => o.key));
  return NextResponse.json({
    shortName: dir?.shortName ?? "",
    directorate: dir?.name ?? "",
    config: { fields: config.fields.filter((f) => known.has(f)) },
    fields,
    sample: sample ? { title: sample.title, comment: sample.comment, segmentName: sample.segmentName, trackName: sample.trackName, ownerName: sample.ownerName, deadline: sample.deadline, statusName: sample.statusName, cost: sample.cost ?? null, attractivenessName: sample.attractivenessName ?? null, custom: sample.custom ?? {} } : null,
    labels: Object.fromEntries(fields.map((f) => [f.key, f.label])),
  });
}

// Сохраняет вид справки (короткое название и отмеченные столбцы).
export async function PUT(request: NextRequest) {
  const actor = await requireActor();
  if (!isDirectorial(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const data: Prisma.DirectorateUpdateInput = {};
  if (parsed.data.shortName !== undefined) data.shortName = parsed.data.shortName || null;
  if (parsed.data.config) data.memoConfig = parsed.data.config as unknown as Prisma.InputJsonValue;
  if (Object.keys(data).length) await prisma.directorate.update({ where: { id: directorateId }, data });
  invalidateDirectorates();
  return NextResponse.json({ ok: true });
}
