/**
 * Копирует данные из боевой базы (Neon, адрес в .env.neon) в локальную (адрес в .env). Только чтение из боевой:
 * боевая база не меняется. Локальные данные при этом заменяются полностью.
 *
 * Запуск: npm run db:pull   (локальная база должна быть запущена: npm run db:local)
 */
import fs from "fs";
import { Prisma, PrismaClient } from "@prisma/client";

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const prodUrl = readEnvFile(".env.neon").DATABASE_URL;
const localUrl = readEnvFile(".env").DATABASE_URL;
if (!prodUrl || !localUrl) throw new Error("Не найден DATABASE_URL в .env.neon или .env");
if (!/localhost|127\.0\.0\.1/.test(localUrl)) throw new Error("Защита: целевая база в .env не локальная — копирование отменено, чтобы не затереть боевую.");

const prod = new PrismaClient({ datasourceUrl: prodUrl });
const local = new PrismaClient({ datasourceUrl: localUrl });

// порядок вставки (с учётом связей); удаление — в обратном
const MODELS = ["Directorate", "User", "Segment", "Attractiveness", "Status", "Track", "CustomColumn", "Cycle", "OperationalItem", "ItemNote", "AuditEvent", "Notification", "ReportTemplate", "AppSetting"] as const;
const delegate = (c: PrismaClient, model: string) => (c as unknown as Record<string, { findMany: (a?: unknown) => Promise<Record<string, unknown>[]>; createMany: (a: unknown) => Promise<unknown>; deleteMany: () => Promise<unknown> }>)[model.charAt(0).toLowerCase() + model.slice(1)];

async function withRetry<T>(fn: () => Promise<T>, what: string, attempts = 8): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`  ${what}: попытка ${i}/${attempts} не удалась, повтор…`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

async function main() {
  const jsonFields = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m.fields.filter((f) => f.type === "Json" && !f.isList).map((f) => f.name)]));
  const data = new Map<string, Record<string, unknown>[]>();

  console.log("Читаю боевую базу (только чтение)…");
  for (const m of MODELS) {
    const rows = await withRetry(() => delegate(prod, m).findMany(), m);
    data.set(m, rows);
    console.log(`  ${m}: ${rows.length}`);
  }

  console.log("Записываю в локальную базу…");
  for (const m of [...MODELS].reverse()) await delegate(local, m).deleteMany();
  for (const m of MODELS) {
    const rows = (data.get(m) ?? []).map((r) => {
      const copy = { ...r };
      for (const f of jsonFields.get(m) ?? []) if (copy[f] === null) copy[f] = Prisma.DbNull;
      return copy;
    });
    // пачками, чтобы не упереться в лимит параметров
    for (let i = 0; i < rows.length; i += 500) await delegate(local, m).createMany({ data: rows.slice(i, i + 500) });
  }
  console.log("Готово: локальная база — копия боевой на этот момент.");
}

main()
  .catch((e) => {
    console.error("Не удалось скопировать:", e instanceof Error ? e.message.split("\n").pop() : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prod.$disconnect();
    await local.$disconnect();
  });
