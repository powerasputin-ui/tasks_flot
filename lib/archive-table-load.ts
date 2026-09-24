import type { MemoVersion } from "@prisma/client";
import { legacyArchiveTable, type ArchiveLayout, type ArchiveRow, type ArchiveTable } from "@/lib/archive-table";
import { prisma } from "@/lib/prisma";

/**
 * Таблица, как она была на момент отправки версии справки. У новых версий — полный снимок (`rows/columns`);
 * у старых остался только `Cycle.snapshot` последней отправки цикла (поданные строки), у промежуточных ревизий таблицы нет.
 */
export async function loadVersionTable(v: Pick<MemoVersion, "id" | "cycleId" | "sentAt" | "rows" | "columns" | "sources">, cycleSnapshot: unknown): Promise<ArchiveTable> {
  const takenAt = v.sentAt.toISOString();
  if (Array.isArray(v.rows) && v.columns && typeof v.columns === "object") {
    return { mode: "full", takenAt, ...(v.columns as unknown as ArchiveLayout), rows: v.rows as unknown as ArchiveRow[] };
  }
  const last = await prisma.memoVersion.findFirst({ where: { cycleId: v.cycleId }, orderBy: { revision: "desc" }, select: { id: true } });
  const inMemo = (Array.isArray(v.sources) ? (v.sources as Array<{ id: string }>) : []).map((s) => s.id);
  return last?.id === v.id && Array.isArray(cycleSnapshot) ? legacyArchiveTable(cycleSnapshot, inMemo, takenAt) : { mode: "none", takenAt, columns: [], segments: [], rows: [] };
}
