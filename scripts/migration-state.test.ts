import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyMigrations, localMigrations, type JournalRow } from "./migration-state";

const LOCAL = ["20260917000000_init", "20260918000000_second", "20260919000000_third"];
const done = (name: string): JournalRow => ({ migration_name: name, finished_at: new Date("2026-10-01"), rolled_back_at: null });

describe("classifyMigrations: что делать с боевой базой", () => {
  it("всё применено — делать нечего", () => {
    const s = classifyMigrations(LOCAL, LOCAL.map(done));
    expect(s.pending).toEqual([]);
    expect(s.problems).toEqual([]);
    expect(s.applied).toEqual(LOCAL);
  });

  it("недостающие миграции — к применению, в порядке применения", () => {
    const s = classifyMigrations(LOCAL, [done(LOCAL[0])]);
    expect(s.pending).toEqual([LOCAL[1], LOCAL[2]]);
    expect(s.problems).toEqual([]);
  });

  it("журнал есть, но пуст — к применению всё", () => {
    expect(classifyMigrations(LOCAL, []).pending).toEqual(LOCAL);
  });

  it("журнала нет совсем — стоп: это не та база", () => {
    const s = classifyMigrations(LOCAL, null);
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toMatch(/нет журнала миграций/);
  });

  it("миграция начата и не завершена — стоп, автоматически не продолжаем", () => {
    const s = classifyMigrations(LOCAL, [done(LOCAL[0]), { migration_name: LOCAL[1], finished_at: null, rolled_back_at: null }]);
    expect(s.problems.join(" ")).toMatch(/не завершена: 20260918000000_second/);
  });

  it("миграция, помеченная откаченной (migrate resolve --rolled-back), снова считается неприменённой и не мешает", () => {
    const s = classifyMigrations(LOCAL, [done(LOCAL[0]), { migration_name: LOCAL[1], finished_at: null, rolled_back_at: new Date("2026-10-02") }]);
    expect(s.problems).toEqual([]);
    expect(s.pending).toEqual([LOCAL[1], LOCAL[2]]);
  });

  it("откаченная и затем применённая заново — применена", () => {
    const s = classifyMigrations(LOCAL, [
      ...LOCAL.map(done),
      { migration_name: LOCAL[1], finished_at: null, rolled_back_at: new Date("2026-09-30") },
    ]);
    expect(s.pending).toEqual([]);
    expect(s.problems).toEqual([]);
  });

  it("в базе есть миграция, которой нет в проекте — стоп: не та база или устаревший код", () => {
    const s = classifyMigrations(LOCAL, [...LOCAL.map(done), done("20270101000000_from_the_future")]);
    expect(s.problems.join(" ")).toMatch(/нет в проекте: 20270101000000_from_the_future/);
  });
});

describe("localMigrations: папки проекта", () => {
  it("имена по шаблону «время_название» и в порядке применения", () => {
    const names = localMigrations(fileURLToPath(new URL("../prisma/migrations", import.meta.url)));
    expect(names.length).toBeGreaterThan(30);
    for (const n of names) expect(n).toMatch(/^\d{14}_[a-z0-9_]+$/);
    expect(names).toEqual([...names].sort());
  });
});
