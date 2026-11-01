/**
 * Состояние миграций боевой базы: что применено, что осталось, а что мешает применять автоматически.
 * Читаем журнал самой базы (_prisma_migrations), а не разбираем текст `prisma migrate status`: код выхода у него один (1) и на
 * «есть что применять», и на «миграция упала», и на «не та база», а текст сообщений меняется между версиями Prisma.
 */
import fs from "node:fs";
import type { PrismaClient } from "@prisma/client";

export interface JournalRow {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
}

export interface MigrationState {
  /** Применены полностью. */
  applied: string[];
  /** Есть в проекте, в базе не применены — их и поставит `migrate deploy`. */
  pending: string[];
  /** Причины остановиться: пока список не пуст, миграции автоматически не применяем. */
  problems: string[];
}

/** Миграции проекта по именам папок (имя начинается со времени, так что порядок по алфавиту = порядок применения). */
export function localMigrations(dir = "prisma/migrations"): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Журнал миграций базы; null — журнала нет совсем (пустая база или не та, где работает Prisma Migrate). */
export async function readJournal(db: Pick<PrismaClient, "$queryRawUnsafe">): Promise<JournalRow[] | null> {
  const has = await db.$queryRawUnsafe<Array<{ ok: boolean }>>(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS ok`);
  if (!has[0]?.ok) return null;
  return db.$queryRawUnsafe<JournalRow[]>(`SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY migration_name`);
}

const names = (list: string[]) => (list.length > 4 ? `${list.slice(0, 4).join(", ")} и ещё ${list.length - 4}` : list.join(", "));

export function classifyMigrations(local: string[], journal: JournalRow[] | null): MigrationState {
  if (!journal) {
    return { applied: [], pending: [], problems: ["В базе нет журнала миграций (_prisma_migrations): это не та база или она не под управлением Prisma Migrate."] };
  }
  const applied = new Set<string>();
  const unfinished: string[] = [];
  for (const r of journal) {
    if (r.rolled_back_at) continue; // помечена откаченной (`migrate resolve --rolled-back`) — для Prisma её как будто не было
    if (r.finished_at) applied.add(r.migration_name);
    else unfinished.push(r.migration_name);
  }
  const known = new Set(local);
  const problems: string[] = [];
  if (unfinished.length) {
    problems.push(`Миграция начата, но не завершена: ${names(unfinished)}. Автоматически не применяю — сначала разберитесь вручную (prisma migrate resolve).`);
  }
  const unknown = [...applied].filter((m) => !known.has(m));
  if (unknown.length) {
    problems.push(`В базе применены миграции, которых нет в проекте: ${names(unknown)}. Это не та база, либо код устарел (git pull).`);
  }
  return { applied: [...applied].sort(), pending: local.filter((m) => !applied.has(m)), problems };
}
