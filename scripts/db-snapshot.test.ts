import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { describeDatabase, diffRows, insertOrder, isLocalDatabase, readBackup, type BackupMeta } from "./db-snapshot";

describe("insertOrder: родители раньше детей", () => {
  it("ставит таблицы по внешним ключам, внутри слоя — по алфавиту", () => {
    const order = insertOrder([
      { name: "items", parents: ["tracks", "users"] },
      { name: "tracks", parents: ["sections"] },
      { name: "users", parents: [] },
      { name: "sections", parents: [] },
      { name: "audit", parents: [] },
    ]);
    expect(order).toEqual(["audit", "sections", "users", "tracks", "items"]);
  });

  it("ссылки на таблицы вне набора (журнал Prisma) и на себя порядок не держат", () => {
    expect(insertOrder([{ name: "a", parents: ["a", "_prisma_migrations"] }, { name: "b", parents: ["a"] }])).toEqual(["a", "b"]);
  });

  it("круговая связь — ошибка, а не молчаливый неверный порядок", () => {
    expect(() => insertOrder([{ name: "a", parents: ["b"] }, { name: "b", parents: ["a"] }])).toThrow(/Круговая связь/);
  });
});

describe("diffRows: сверка загруженного с файлом копии", () => {
  const a = { id: "1", title: "один", json: { x: 1, y: [1, 2] } };
  const b = { id: "2", title: "два", json: null };

  it("порядок строк и порядок ключей не важны", () => {
    const same = diffRows(["id"], [a, b], [{ json: null, title: "два", id: "2" }, { json: { y: [1, 2], x: 1 }, title: "один", id: "1" }]);
    expect(same).toEqual({ onlyInBackup: 0, onlyInDb: 0, example: null });
  });

  it("недостающая и лишняя строки находятся, в примере — только ключ без содержимого", () => {
    const d = diffRows(["id"], [a, b], [b, { id: "3", title: "секрет", json: null }]);
    expect(d.onlyInBackup).toBe(1);
    expect(d.onlyInDb).toBe(1);
    expect(d.example).toBe("3");
    expect(JSON.stringify(d)).not.toContain("секрет");
  });

  it("изменённое значение — расхождение с обеих сторон", () => {
    const d = diffRows(["id"], [a], [{ ...a, title: "иначе" }]);
    expect(d).toMatchObject({ onlyInBackup: 1, onlyInDb: 1 });
  });

  it("повторяющиеся строки считаются: две в файле и одна в базе — не одно и то же", () => {
    expect(diffRows(["id"], [a, a], [a]).onlyInBackup).toBe(1);
  });

  it("составной ключ склеивается через «/»", () => {
    expect(diffRows(["threadId", "userId"], [], [{ threadId: "t", userId: "u" }]).example).toBe("t/u");
  });
});

describe("адрес базы", () => {
  it("описание не содержит логина и пароля", () => {
    const d = describeDatabase("postgresql://user:s3cret@ep-cool-123.neon.tech/neondb?sslmode=require");
    expect(d).toEqual({ host: "ep-cool-123.neon.tech", name: "neondb" });
    expect(JSON.stringify(d)).not.toContain("s3cret");
  });

  it("мусор и пустое значение — null, а не исключение", () => {
    expect(describeDatabase("не адрес")).toBeNull();
    expect(describeDatabase(undefined)).toBeNull();
  });

  it("локальной считается только база на этом компьютере", () => {
    expect(isLocalDatabase("postgresql://postgres:postgres@localhost:54329/tasksflot")).toBe(true);
    expect(isLocalDatabase("postgresql://postgres:postgres@127.0.0.1:5432/x")).toBe(true);
    expect(isLocalDatabase("postgresql://postgres:postgres@[::1]:5432/x")).toBe(true);
    expect(isLocalDatabase("postgresql://u:p@ep-cool-123.neon.tech/neondb")).toBe(false);
    // обходы защиты: «localhost» в имени хоста или в части с логином не делают базу локальной
    expect(isLocalDatabase("postgresql://u:p@localhost.evil.example/x")).toBe(false);
    expect(isLocalDatabase("postgresql://localhost@evil.example/x")).toBe(false);
    expect(isLocalDatabase(undefined)).toBe(false);
  });
});

describe("readBackup: копия читается только целой", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function makeCopy(meta: Partial<BackupMeta> = {}, files: Record<string, unknown> = { users: [{ id: "1" }, { id: "2" }], notes: [] }): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
    dirs.push(dir);
    const tables = Object.fromEntries(Object.entries(files).map(([n, rows]) => [n, Array.isArray(rows) ? rows.length : 0]));
    fs.writeFileSync(path.join(dir, "_meta.json"), JSON.stringify({ format: 2, createdAt: "2026-11-01T00:00:00.000Z", gitSha: null, database: null, migrations: [], tables, ...meta }));
    for (const [n, rows] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${n}.json`), JSON.stringify(rows));
    return dir;
  }

  it("целая копия читается", () => {
    const b = readBackup(makeCopy());
    expect([...b.rows.keys()]).toEqual(["users", "notes"]);
    expect(b.rows.get("users")).toHaveLength(2);
  });

  it("строк меньше, чем записано при снятии, — файл повреждён", () => {
    const dir = makeCopy();
    fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify([{ id: "1" }]));
    expect(() => readBackup(dir)).toThrow(/users\.json: 1 строк, а при снятии копии было 2/);
  });

  it("нет _meta.json (копия старого формата) — отказ", () => {
    const dir = makeCopy();
    fs.rmSync(path.join(dir, "_meta.json"));
    expect(() => readBackup(dir)).toThrow(/нет _meta\.json/);
  });

  it("нет файла таблицы — отказ", () => {
    const dir = makeCopy();
    fs.rmSync(path.join(dir, "notes.json"));
    expect(() => readBackup(dir)).toThrow(/нет файла notes\.json/);
  });

  it("чужая версия формата — отказ", () => {
    expect(() => readBackup(makeCopy({ format: 1 as unknown as 2 }))).toThrow(/Формат копии 1/);
  });

  it("имя таблицы с путём в _meta.json не уведёт за пределы папки копии", () => {
    expect(() => readBackup(makeCopy({ tables: { "../users": 0 } }))).toThrow(/Недопустимое имя таблицы/);
  });
});
