import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/lib/session";
import { isDirectorial } from "@/lib/permissions";
import { requireDirectorate } from "@/lib/scope";
import { invalidateDirectorates } from "@/lib/directorates";

const putSchema = z.object({
  shortName: z.string().trim().max(60).nullable().optional(),
  sections: z.array(z.object({ id: z.string().optional(), title: z.string().trim().min(1).max(200), trackIds: z.array(z.string()).max(500) })).max(60),
});

// Структура справки: разделы (название, порядок) и какие треки в них входят — настройка дирекции.
export async function GET() {
  const actor = await requireActor();
  if (!isDirectorial(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const [sections, tracks, dir] = await Promise.all([
    prisma.memoSection.findMany({ where: { directorateId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { tracks: { select: { id: true } } } }),
    prisma.track.findMany({ where: { directorateId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, segment: { select: { name: true } } } }),
    prisma.directorate.findUnique({ where: { id: directorateId }, select: { name: true, shortName: true } }),
  ]);
  return NextResponse.json({
    shortName: dir?.shortName ?? "",
    directorate: dir?.name ?? "",
    sections: sections.map((s) => ({ id: s.id, title: s.title, trackIds: s.tracks.map((t) => t.id) })),
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, segmentName: t.segment?.name ?? null })),
  });
}

// Сохраняет структуру целиком (порядок = порядок в списке). Трек может входить только в один раздел.
export async function PUT(request: NextRequest) {
  const actor = await requireActor();
  if (!isDirectorial(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const directorateId = requireDirectorate(actor);
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const own = await prisma.track.findMany({ where: { directorateId }, select: { id: true } });
  const ownIds = new Set(own.map((t) => t.id));
  const seen = new Set<string>();
  for (const s of parsed.data.sections) {
    for (const t of s.trackIds) {
      if (!ownIds.has(t) || seen.has(t)) return NextResponse.json({ error: "INVALID_INPUT", message: "Трек указан неверно или входит в два раздела." }, { status: 400 });
      seen.add(t);
    }
  }
  const existing = await prisma.memoSection.findMany({ where: { directorateId }, select: { id: true } });
  const existingIds = new Set(existing.map((s) => s.id));
  if (parsed.data.sections.some((s) => s.id && !existingIds.has(s.id))) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    const keep = parsed.data.sections.map((s) => s.id).filter(Boolean) as string[];
    await tx.memoSection.deleteMany({ where: { directorateId, id: { notIn: keep } } }); // треки удалённых разделов освобождаются (SetNull)
    await tx.track.updateMany({ where: { directorateId }, data: { memoSectionId: null } });
    for (const [i, s] of parsed.data.sections.entries()) {
      const row = s.id
        ? await tx.memoSection.update({ where: { id: s.id }, data: { title: s.title, sortOrder: i } })
        : await tx.memoSection.create({ data: { directorateId, title: s.title, sortOrder: i } });
      if (s.trackIds.length) await tx.track.updateMany({ where: { id: { in: s.trackIds }, directorateId }, data: { memoSectionId: row.id } });
    }
    if (parsed.data.shortName !== undefined) await tx.directorate.update({ where: { id: directorateId }, data: { shortName: parsed.data.shortName || null } });
  });
  invalidateDirectorates();
  return NextResponse.json({ ok: true });
}
