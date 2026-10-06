import type { Prisma } from "@prisma/client";

/**
 * Новая дирекция может начать с той же «Общей таблицы», что у существующей: копируются свои столбцы, раскладка таблицы,
 * сегменты, треки, разделы и вид справки. Позиции, люди, оперативки и справки НЕ копируются — у каждой дирекции свои.
 * Идентификаторы новые; ссылки внутри (трек → сегмент/раздел, раскладка и вид справки → свои столбцы) переводятся на копии.
 */
export async function copyDirectorateStructure(tx: Prisma.TransactionClient, fromId: string, toId: string): Promise<void> {
  const [segments, sections, tracks, columns, layout, from] = await Promise.all([
    tx.segment.findMany({ where: { directorateId: fromId } }),
    tx.memoSection.findMany({ where: { directorateId: fromId } }),
    tx.track.findMany({ where: { directorateId: fromId } }),
    tx.customColumn.findMany({ where: { directorateId: fromId } }),
    tx.appSetting.findUnique({ where: { key: `table.columns:${fromId}` } }),
    tx.directorate.findUnique({ where: { id: fromId }, select: { memoConfig: true } }),
  ]);

  const segmentMap = new Map<string, string>();
  for (const s of segments) {
    const c = await tx.segment.create({ data: { name: s.name, color: s.color, sortOrder: s.sortOrder, isActive: s.isActive, directorateId: toId } });
    segmentMap.set(s.id, c.id);
  }
  const sectionMap = new Map<string, string>();
  for (const s of sections) {
    const c = await tx.memoSection.create({ data: { title: s.title, sortOrder: s.sortOrder, directorateId: toId } });
    sectionMap.set(s.id, c.id);
  }
  for (const t of tracks) {
    await tx.track.create({
      data: {
        name: t.name,
        sortOrder: t.sortOrder,
        isActive: t.isActive,
        directorateId: toId,
        segmentId: t.segmentId ? segmentMap.get(t.segmentId) ?? null : null,
        memoSectionId: t.memoSectionId ? sectionMap.get(t.memoSectionId) ?? null : null,
      },
    });
  }
  const columnMap = new Map<string, string>();
  for (const c of columns) {
    const n = await tx.customColumn.create({ data: { name: c.name, type: c.type, options: c.options, sortOrder: c.sortOrder, isActive: c.isActive, directorateId: toId } });
    columnMap.set(c.id, n.id);
  }

  if (layout) await tx.appSetting.create({ data: { key: `table.columns:${toId}`, value: remapCustomKeys(layout.value, columnMap) as Prisma.InputJsonValue } });
  if (from?.memoConfig) await tx.directorate.update({ where: { id: toId }, data: { memoConfig: remapCustomKeys(from.memoConfig, columnMap) as Prisma.InputJsonValue } });
}

/**
 * «custom:<старый id>» → «custom:<новый id>» во всех строках JSON (раскладка таблицы, поля справки).
 * Ссылка на столбец, которого нет в копии, выбрасывается: строкой из массива или целым объектом, если это его `key`.
 */
export function remapCustomKeys(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") {
    if (!value.startsWith("custom:")) return value;
    const next = map.get(value.slice("custom:".length));
    return next ? `custom:${next}` : undefined;
  }
  if (Array.isArray(value)) return value.map((v) => remapCustomKeys(v, map)).filter((v) => v !== undefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const r = remapCustomKeys(v, map);
      if (r === undefined && k === "key") return undefined;
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return value;
}
