import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { isDirectorial } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { invalidateDirectorates } from "@/lib/directorates";
import { loadMemoConfig, loadSources } from "@/lib/memo-load";
import { MEMO_FIELDS } from "@/lib/memo";

const fieldKeys = MEMO_FIELDS.map((f) => f.key) as [string, ...string[]];
const putSchema = z.object({
  shortName: z.string().trim().max(60).nullable().optional(),
  /** Вид справки: как группировать разделы и какие поля таблицы попадают в текст пункта. */
  config: z.object({ groupBy: z.enum(["track", "segment", "custom"]).nullable(), fields: z.array(z.enum(fieldKeys)).min(1).max(fieldKeys.length) }).optional(),
  /** Свои разделы (только для группировки «свои»): название, порядок и состав треков. */
  sections: z.array(z.object({ id: z.string().optional(), title: z.string().trim().min(1).max(200), trackIds: z.array(z.string()).max(500) })).max(60).optional(),
});

// Вид справки дирекции: группировка, поля текста пункта, короткое название, свои разделы; пример реальной строки для предпросмотра.
export async function GET() {
  const actor = await requireActor();
  if (!isDirectorial(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const [sections, tracks, dir, config, sources] = await Promise.all([
    prisma.memoSection.findMany({ where: { directorateId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { tracks: { select: { id: true } } } }),
    prisma.track.findMany({ where: { directorateId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, segment: { select: { name: true } } } }),
    prisma.directorate.findUnique({ where: { id: directorateId }, select: { name: true, shortName: true } }),
    loadMemoConfig(directorateId),
    loadSources(directorateId),
  ]);
  // для предпросмотра — реальная поданная строка с комментарием (иначе любая с комментарием, иначе любая)
  const sample = sources.find((s) => s.operFlag && s.comment) ?? sources.find((s) => s.comment) ?? sources[0] ?? null;
  return NextResponse.json({
    shortName: dir?.shortName ?? "",
    directorate: dir?.name ?? "",
    config: { groupBy: config.groupBy ?? (sections.length ? "custom" : "track"), fields: config.fields },
    fields: MEMO_FIELDS,
    sections: sections.map((s) => ({ id: s.id, title: s.title, trackIds: s.tracks.map((t) => t.id) })),
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, segmentName: t.segment?.name ?? null })),
    sample: sample ? { title: sample.title, comment: sample.comment, segmentName: sample.segmentName, trackName: sample.trackName, ownerName: sample.ownerName, deadline: sample.deadline, statusName: sample.statusName } : null,
  });
}

// Сохраняет вид справки. Разделы — целиком (порядок = порядок в списке); трек входит только в один раздел.
export async function PUT(request: NextRequest) {
  const actor = await requireActor();
  if (!isDirectorial(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const custom = parsed.data.sections;
  if (custom) {
    const own = await prisma.track.findMany({ where: { directorateId }, select: { id: true } });
    const ownIds = new Set(own.map((t) => t.id));
    const seen = new Set<string>();
    for (const s of custom) {
      for (const t of s.trackIds) {
        if (!ownIds.has(t) || seen.has(t)) return NextResponse.json({ error: "INVALID_INPUT", message: "Трек указан неверно или входит в два раздела." }, { status: 400 });
        seen.add(t);
      }
    }
    const existing = await prisma.memoSection.findMany({ where: { directorateId }, select: { id: true } });
    const existingIds = new Set(existing.map((s) => s.id));
    if (custom.some((s) => s.id && !existingIds.has(s.id))) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    if (custom) {
      const keep = custom.map((s) => s.id).filter(Boolean) as string[];
      await tx.memoSection.deleteMany({ where: { directorateId, id: { notIn: keep } } }); // треки удалённых разделов освобождаются (SetNull)
      await tx.track.updateMany({ where: { directorateId }, data: { memoSectionId: null } });
      for (const [i, s] of custom.entries()) {
        const row = s.id ? await tx.memoSection.update({ where: { id: s.id }, data: { title: s.title, sortOrder: i } }) : await tx.memoSection.create({ data: { directorateId, title: s.title, sortOrder: i } });
        if (s.trackIds.length) await tx.track.updateMany({ where: { id: { in: s.trackIds }, directorateId }, data: { memoSectionId: row.id } });
      }
    }
    const data: Prisma.DirectorateUpdateInput = {};
    if (parsed.data.shortName !== undefined) data.shortName = parsed.data.shortName || null;
    if (parsed.data.config) data.memoConfig = parsed.data.config as unknown as Prisma.InputJsonValue;
    if (Object.keys(data).length) await tx.directorate.update({ where: { id: directorateId }, data });
  });
  invalidateDirectorates();
  return NextResponse.json({ ok: true });
}
