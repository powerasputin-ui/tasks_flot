/**
 * Общее для резервной копии (backup-db), восстановления (restore-db) и миграции боевой базы (db:prod:migrate).
 *
 * Копия не зависит от схемы Prisma в коде: таблицы, их порядок и столбцы берутся из самой базы, строки читаются как есть
 * (`to_jsonb`). Поэтому её можно снять с базы ДО миграции, которая добавит столбец или таблицу (клиент Prisma из нового кода
 * такой базы не прочитал бы), а новая таблица попадает в копию без правок скрипта.
 * Все таблицы читаются в одной транзакции со снимком (REPEATABLE READ): иначе строка, появившаяся между чтением двух таблиц,
 * ломала бы внешний ключ при восстановлении.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Prisma, type PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;
export type Row = Record<string, unknown>;

/** Журнал миграций самой Prisma: в копию попадает (по нему видно, на какой схеме она снята), при восстановлении не трогается. */
export const JOURNAL_TABLE = "_prisma_migrations";

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;

export function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Адрес базы: из окружения, иначе из .env (либо из файла, который назвали явно). */
export function databaseUrl(envFile?: string): string | undefined {
  if (envFile) return readEnvFile(envFile).DATABASE_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return fs.existsSync(".env") ? readEnvFile(".env").DATABASE_URL : undefined;
}

/** Куда подключились — без логина и пароля, чтобы это можно было печатать и класть в _meta.json. */
export function describeDatabase(url: string | undefined): { host: string; name: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { host: u.hostname, name: u.pathname.replace(/^\//, "") };
  } catch {
    return null;
  }
}

export function isLocalDatabase(url: string | undefined): boolean {
  const host = describeDatabase(url)?.host;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export interface TableInfo {
  name: string;
  /** Столбцы первичного ключа: по ним строки выгружаются в одном и том же порядке. */
  pk: string[];
  /** Таблицы, на которые ссылаются внешние ключи этой таблицы (кроме неё самой). */
  parents: string[];
  /** Таблица ссылается сама на себя — порядок строк внутри неё восстановление считать не умеет. */
  selfRef: boolean;
}

/** Таблицы схемы public вместе с первичными и внешними ключами — прямо из каталога базы. */
export async function listTables(db: Db): Promise<TableInfo[]> {
  const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT tablename::text AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const keys = await db.$queryRawUnsafe<Array<{ tbl: string; col: string }>>(`
    SELECT cl.relname::text AS tbl, a.attname::text AS col
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'p' AND ns.nspname = 'public'
    ORDER BY cl.relname, k.ord`);
  const refs = await db.$queryRawUnsafe<Array<{ child: string; parent: string }>>(`
    SELECT cl.relname::text AS child, pl.relname::text AS parent
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_class pl ON pl.oid = c.confrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    WHERE c.contype = 'f' AND ns.nspname = 'public'`);
  return tables.map(({ name }) => ({
    name,
    pk: keys.filter((k) => k.tbl === name).map((k) => k.col),
    parents: [...new Set(refs.filter((r) => r.child === name && r.parent !== name).map((r) => r.parent))].sort(),
    selfRef: refs.some((r) => r.child === name && r.parent === name),
  }));
}

/** Порядок вставки: сначала таблицы, на которые ссылаются другие (удалять — в обратном). Внутри «слоя» по алфавиту. */
export function insertOrder(tables: Array<Pick<TableInfo, "name" | "parents">>): string[] {
  const names = new Set(tables.map((t) => t.name));
  const needs = new Map(tables.map((t) => [t.name, t.parents.filter((p) => names.has(p) && p !== t.name)]));
  const placed = new Set<string>();
  const out: string[] = [];
  while (out.length < tables.length) {
    const ready = [...needs].filter(([n, ps]) => !placed.has(n) && ps.every((p) => placed.has(p))).map(([n]) => n).sort();
    if (!ready.length) throw new Error(`Круговая связь между таблицами: ${[...needs.keys()].filter((n) => !placed.has(n)).join(", ")}`);
    for (const n of ready) {
      placed.add(n);
      out.push(n);
    }
  }
  return out;
}

/** Все строки таблицы как JSON, в порядке первичного ключа (так копии двух дней можно сравнивать построчно). */
async function readRows(db: Db, t: TableInfo): Promise<Row[]> {
  const order = t.pk.length ? ` ORDER BY ${t.pk.map((c) => `x.${quote(c)}`).join(", ")}` : "";
  const res = await db.$queryRawUnsafe<Array<{ rows: Row[] | string }>>(`SELECT coalesce(jsonb_agg(to_jsonb(x)${order}), '[]'::jsonb) AS rows FROM ${quote(t.name)} x`);
  const rows = res[0].rows;
  return typeof rows === "string" ? (JSON.parse(rows) as Row[]) : rows;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

export interface RowsDiff {
  onlyInBackup: number;
  onlyInDb: number;
  /** Ключ одной из расходящихся строк — только ключ, без содержимого. */
  example: string | null;
}

/** Сверка наборов строк независимо от порядка строк и порядка ключей внутри строки. */
export function diffRows(pk: string[], backup: Row[], db: Row[]): RowsDiff {
  const left = new Map<string, { n: number; row: Row }>();
  for (const r of backup) {
    const k = stable(r);
    const e = left.get(k);
    if (e) e.n++;
    else left.set(k, { n: 1, row: r });
  }
  let onlyInDb = 0;
  let sample: Row | undefined;
  for (const r of db) {
    const e = left.get(stable(r));
    if (e && e.n > 0) e.n--;
    else {
      onlyInDb++;
      sample ??= r;
    }
  }
  let onlyInBackup = 0;
  for (const e of left.values()) {
    if (e.n > 0) {
      onlyInBackup += e.n;
      sample ??= e.row;
    }
  }
  const key = sample ? (pk.length ? pk : Object.keys(sample).slice(0, 1)).map((c) => String(sample[c])).join("/") : null;
  return { onlyInBackup, onlyInDb, example: key };
}

export interface BackupMeta {
  /** Версия формата; восстановление понимает только свою. */
  format: 2;
  createdAt: string;
  gitSha: string | null;
  database: { host: string; name: string } | null;
  /** Какие миграции были применены к базе в момент копии — по журналу самой базы (null, если журнала нет). */
  migrations: string[] | null;
  /** Строк в каждой таблице: по этим числам восстановление отличает целую копию от обрезанной. */
  tables: Record<string, number>;
}

const safeLabel = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");

async function withRetry<T>(fn: () => Promise<T>, log: (s: string) => void, attempts = 6, delayMs = 3000): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      log(`Попытка ${i + 1}/${attempts} не удалась (${e instanceof Error ? e.message.split("\n").pop() : e}), повтор…`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

function gitSha(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Снимает полную копию базы в `<корень>/<дата-время>[-<метка>]`; корень — `backups` (или переменная BACKUP_ROOT). Папка появляется
 * только целиком: пишем в `….partial` и в конце переименовываем, так что недоснятая копия за готовую не сойдёт.
 */
export async function makeBackup(
  prisma: PrismaClient,
  opts: { label?: string; root?: string; url?: string; log?: (s: string) => void } = {},
): Promise<{ dir: string; meta: BackupMeta }> {
  const log = opts.log ?? console.log;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const label = opts.label ? safeLabel(opts.label) : "";
  const base = path.join(opts.root ?? process.env.BACKUP_ROOT ?? "backups", label ? `${stamp}-${label}` : stamp);
  // две копии в одну секунду с одной меткой не должны затирать друг друга
  let dir = base;
  for (let n = 2; fs.existsSync(dir); n++) dir = `${base}-${n}`;
  const partial = `${dir}.partial`;
  // папку готовим до повторов: если писать некуда, ждать шесть попыток «соединения» незачем
  fs.rmSync(partial, { recursive: true, force: true });
  fs.mkdirSync(partial, { recursive: true });

  const meta = await withRetry(async () => {
    const counts: Record<string, number> = {};
    let journal: Row[] = [];
    await prisma.$transaction(
      async (tx) => {
        for (const t of await listTables(tx)) {
          const rows = await readRows(tx, t);
          fs.writeFileSync(path.join(partial, `${t.name}.json`), JSON.stringify(rows, null, 2), "utf8");
          counts[t.name] = rows.length;
          if (t.name === JOURNAL_TABLE) journal = rows;
          log(`${t.name}: ${rows.length}`);
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 20_000, timeout: 10 * 60_000 },
    );
    const applied = journal.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => String(r.migration_name)).sort();
    const result: BackupMeta = {
      format: 2,
      createdAt: new Date().toISOString(),
      gitSha: gitSha(),
      database: describeDatabase(opts.url ?? databaseUrl()),
      migrations: counts[JOURNAL_TABLE] === undefined ? null : applied,
      tables: counts,
    };
    fs.writeFileSync(path.join(partial, "_meta.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }, log).catch((e) => {
    fs.rmSync(partial, { recursive: true, force: true }); // недоснятая копия не остаётся лежать
    throw e;
  });

  fs.renameSync(partial, dir);
  return { dir, meta };
}

export interface Backup {
  dir: string;
  meta: BackupMeta;
  rows: Map<string, Row[]>;
}

/** Читает копию с диска и проверяет, что она целая: есть _meta.json, все файлы на месте, строк ровно столько, сколько записано. */
export function readBackup(dir: string): Backup {
  const metaFile = path.join(dir, "_meta.json");
  if (!fs.existsSync(metaFile)) {
    throw new Error(`В ${dir} нет _meta.json: это не полная копия (старые копии содержали не все таблицы) — восстанавливать из неё нельзя.`);
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8")) as BackupMeta;
  if (meta.format !== 2) throw new Error(`Формат копии ${String(meta.format)} не поддерживается (нужен 2).`);
  const rows = new Map<string, Row[]>();
  for (const [name, count] of Object.entries(meta.tables)) {
    if (!/^\w+$/.test(name)) throw new Error(`Недопустимое имя таблицы в _meta.json: ${name}`);
    const file = path.join(dir, `${name}.json`);
    if (!fs.existsSync(file)) throw new Error(`В копии нет файла ${name}.json.`);
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(data) || data.length !== count) {
      throw new Error(`${name}.json: ${Array.isArray(data) ? data.length : "не список"} строк, а при снятии копии было ${count} — файл повреждён или изменён.`);
    }
    rows.set(name, data as Row[]);
  }
  return { dir, meta, rows };
}

async function insertRows(db: Db, table: string, columns: string[], rows: Row[]): Promise<void> {
  if (!rows.length || !columns.length) return;
  const cols = columns.map(quote).join(", ");
  // JSON разбирает сам Postgres по типам столбцов таблицы: даты, jsonb, массивы и перечисления приходят такими, какими были
  const sql = `INSERT INTO ${quote(table)} (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::${quote(table)}, $1::jsonb)`;
  for (let i = 0; i < rows.length; i += 500) await db.$executeRawUnsafe(sql, JSON.stringify(rows.slice(i, i + 500)));
}

/**
 * Загружает копию в базу, схема которой уже создана миграциями. Всё в одной транзакции вместе со сверкой: если что-то не
 * сошлось, откатывается целиком и база остаётся как была. Данные в таблицах заменяются копией; если в базе уже есть
 * пользователи, это разрешено только с wipe.
 */
export async function restoreBackup(prisma: PrismaClient, backup: Backup, opts: { wipe?: boolean; log?: (s: string) => void } = {}): Promise<void> {
  const log = opts.log ?? console.log;
  const journal = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: unknown; rolled_back_at: unknown }>>(
    `SELECT migration_name, finished_at, rolled_back_at FROM public.${JOURNAL_TABLE}`,
  ).catch(() => null);
  if (!journal) throw new Error("В базе нет журнала миграций: сначала создайте схему — npx prisma migrate deploy.");
  const known = new Set(journal.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
  const missing = (backup.meta.migrations ?? []).filter((m) => !known.has(m));
  if (missing.length) {
    throw new Error(`В базе нет миграций, на которых снята копия (${missing.length}, например ${missing[0]}). Сначала: npx prisma migrate deploy.`);
  }

  // локальная база на Windows создаётся в кодировке по локали (WIN1251): символ вне неё (эмодзи, стрелка) не загрузится, и загрузка откатится
  const [{ server_encoding: encoding }] = await prisma.$queryRawUnsafe<Array<{ server_encoding: string }>>(`SHOW server_encoding`);
  if (encoding !== "UTF8") log(`  Внимание: база в кодировке ${encoding}, не UTF8 — символы вне неё в данных копии не загрузятся (загрузка тогда откатится целиком).`);

  await prisma.$transaction(
    async (tx) => {
      const tables = (await listTables(tx)).filter((t) => t.name !== JOURNAL_TABLE);
      const byName = new Map(tables.map((t) => [t.name, t]));
      const selfRef = tables.filter((t) => t.selfRef && backup.rows.has(t.name)).map((t) => t.name);
      if (selfRef.length) throw new Error(`Таблица ссылается сама на себя (${selfRef.join(", ")}): порядок строк восстановление считать не умеет.`);
      const order = insertOrder(tables);

      // «Свежая» база — сразу после migrate deploy: людей в ней нет, есть только справочники, которые вставляют сами миграции
      // (дирекция по умолчанию, статусы трекера, настройки) — их копия заменяет без флага. Есть пользователи — это уже данные.
      if (!opts.wipe && byName.has("users")) {
        const r = await tx.$queryRawUnsafe<Array<{ filled: boolean }>>(`SELECT EXISTS (SELECT 1 FROM "users") AS filled`);
        if (r[0].filled) throw new Error("В базе уже есть пользователи, то есть рабочие данные. Заменить их копией — флаг --wipe (все таблицы будут очищены).");
      }
      for (const name of [...order].reverse()) await tx.$executeRawUnsafe(`DELETE FROM ${quote(name)}`);

      const cols = await tx.$queryRawUnsafe<Array<{ tbl: string; col: string }>>(
        `SELECT table_name::text AS tbl, column_name::text AS col FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
      );
      const columnsOf = (name: string) => new Set(cols.filter((c) => c.tbl === name).map((c) => c.col));
      const restorable = new Map<string, string[]>();

      for (const name of order) {
        const rows = backup.rows.get(name);
        if (!rows) continue; // таблицы нет в копии (копия снята на более старой схеме) — остаётся пустой
        const have = columnsOf(name);
        const columns = Object.keys(rows[0] ?? {}).filter((c) => have.has(c));
        restorable.set(name, columns);
        await insertRows(tx, name, columns, rows);
      }
      for (const name of backup.rows.keys()) {
        if (name !== JOURNAL_TABLE && !byName.has(name)) log(`  ${name}: такой таблицы в базе нет — пропущена (в ней ${backup.rows.get(name)!.length} строк)`);
      }

      // сверка до фиксации: прочитанное из базы должно совпасть с файлом по каждой строке
      for (const name of order) {
        const columns = restorable.get(name);
        const rows = backup.rows.get(name);
        if (!columns || !rows) continue;
        const t = byName.get(name)!;
        const back = (await readRows(tx, t)).map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
        const want = rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])));
        const d = diffRows(t.pk, want, back);
        if (d.onlyInBackup || d.onlyInDb) {
          throw new Error(`${name}: после загрузки данные не совпали с копией (нет в базе: ${d.onlyInBackup}, лишних: ${d.onlyInDb}, например ключ ${d.example}). Ничего не изменено.`);
        }
        log(`  ${name}: ${rows.length} ✓`);
      }
    },
    { maxWait: 20_000, timeout: 30 * 60_000 },
  );
}
