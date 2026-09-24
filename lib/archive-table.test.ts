import { describe, expect, it } from "vitest";
import { archiveLayout, archiveTableSections, buildArchiveRows, diffArchiveTables, filterArchiveRows, legacyArchiveTable, type ArchiveTable } from "@/lib/archive-table";
import type { ColumnConfig } from "@/lib/table-columns";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  segmentId: "s1",
  segmentName: "Танкерный флот",
  trackName: "Трек",
  name: `Задача ${id}`,
  cost: null,
  attractivenessName: "P70",
  attractivenessColor: null,
  ownerName: "Иванов И.И.",
  ownerRole: "HEAD",
  deadline: new Date("2026-09-25T00:00:00.000Z"),
  deadlineWeek: 39,
  statusName: "В работе",
  statusColor: null,
  comment: "позвонил",
  operFlag: false,
  customValues: {},
  ...over,
});

const segments = [
  { id: "s1", name: "Танкерный флот", color: null },
  { id: "s2", name: "Портовый флот", color: null },
];

describe("archiveLayout", () => {
  it("берёт только видимые столбцы, без «Оперативки» и «В справку», с типом своих столбцов", () => {
    const cols: ColumnConfig[] = [
      { key: "name", label: "Задача", visible: true, width: 200 },
      { key: "operFlag", label: "Оперативка", visible: true, width: 100 },
      { key: "memo", label: "В справку", visible: true, width: 100 },
      { key: "cost", label: "Оценка", visible: false, width: 100 },
      { key: "comment", label: "Комм.", visible: true, width: 100, removed: true },
      { key: "custom:c1", label: "Порт", visible: true, width: 100 },
    ];
    const layout = archiveLayout(cols, [{ id: "c1", name: "Порт", type: "DATE", options: [] }], segments);
    expect(layout.columns).toEqual([
      { key: "name", label: "Задача" },
      { key: "custom:c1", label: "Порт", type: "DATE" },
    ]);
    expect(layout.segments).toBe(segments);
  });
});

describe("buildArchiveRows", () => {
  it("вся таблица: пометки «подано» и «в справке», даты строкой, порядок сегментов как в справочнике", () => {
    const rows = buildArchiveRows(
      [row("a", { segmentId: null, segmentName: null }), row("b", { segmentId: "s2" }), row("c", { operFlag: true }), row("d")],
      ["c"],
      segments
    );
    expect(rows.map((r) => r.id)).toEqual(["c", "d", "b", "a"]);
    expect(rows[0]).toMatchObject({ submitted: true, inMemo: true, deadline: "2026-09-25T00:00:00.000Z" });
    expect(rows[1]).toMatchObject({ submitted: false, inMemo: false });
  });
});

describe("legacyArchiveTable", () => {
  it("старый снимок: только поданные строки, свои столбцы по сохранённому названию", () => {
    const snap = [
      { ...row("x", { operFlag: true, deadline: "2026-09-25T00:00:00.000Z" }), customFields: [{ name: "Порт", type: "TEXT", value: "Мурманск" }] },
      { ...row("y", { operFlag: true }), customFields: [{ name: "Порт", type: "TEXT", value: null }] },
    ];
    const t = legacyArchiveTable(snap, ["x"], "2026-09-20T10:00:00.000Z");
    expect(t.mode).toBe("submitted");
    expect(t.columns.at(-1)).toEqual({ key: "custom:legacy0", label: "Порт", type: "TEXT" });
    expect(t.rows.map((r) => [r.id, r.submitted, r.inMemo, r.customValues])).toEqual([
      ["x", true, true, { legacy0: "Мурманск" }],
      ["y", true, false, {}],
    ]);
  });

  it("не массив — пустая таблица, без падения", () => {
    expect(legacyArchiveTable(null, [], "2026-09-20T10:00:00.000Z").rows).toEqual([]);
  });
});

describe("filterArchiveRows", () => {
  const rows = buildArchiveRows([row("a", { operFlag: true }), row("b", { operFlag: true, segmentId: "s2", comment: "ледокол" }), row("c", { segmentId: null })], ["a"], segments);

  it("вид: все / поданные / в справке", () => {
    expect(filterArchiveRows(rows, { view: "all" })).toHaveLength(3);
    expect(filterArchiveRows(rows, { view: "submitted" }).map((r) => r.id)).toEqual(["a", "b"]);
    expect(filterArchiveRows(rows, { view: "memo" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("сегмент (в т.ч. «без сегмента») и поиск по тексту", () => {
    expect(filterArchiveRows(rows, { view: "all", segmentId: "none" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterArchiveRows(rows, { view: "all", q: "ЛЕДОКОЛ" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterArchiveRows(rows, { view: "all", q: "25.09.2026" })).toHaveLength(3);
  });
});

describe("archiveTableSections", () => {
  it("выгрузка: сегмент, столбцы снимка, пометки", () => {
    const layout = { columns: [{ key: "name", label: "Задача" }, { key: "deadline", label: "Дедлайн" }], segments };
    const rows = buildArchiveRows([row("a", { operFlag: true })], ["a"], segments);
    const [s] = archiveTableSections(layout, rows);
    expect(s.headers).toEqual(["Сегмент", "Задача", "Дедлайн", "Подано директору", "В справке"]);
    expect(s.rows[0]).toEqual(["Танкерный флот", "Задача a", new Date("2026-09-25T00:00:00.000Z").toLocaleDateString("ru-RU"), "да", "да"]);
  });
});

describe("diffArchiveTables: что изменилось с прошлой недели", () => {
  const cols = [{ key: "name", label: "Задача" }, { key: "status", label: "Статус" }, { key: "comment", label: "Комментарий" }, { key: "deadline", label: "Дедлайн" }];
  const table = (rows: ReturnType<typeof buildArchiveRows>, mode: ArchiveTable["mode"] = "full"): ArchiveTable => ({ mode, takenAt: "2026-09-24T10:00:00.000Z", columns: cols, segments, rows });
  const week1 = table(buildArchiveRows([row("a"), row("b"), row("c")], [], segments));

  it("новые, изменённые (с прежним значением) и убранные строки", () => {
    const week2 = table(buildArchiveRows([row("a"), row("b", { statusName: "Завершено", comment: "готово" }), row("d")], [], segments));
    const d = diffArchiveTables(week1, week2)!;
    expect(d.summary).toEqual({ new: 1, changed: 1, removed: 1 });
    expect(d.rows.a).toBeUndefined();
    expect(d.rows.d).toEqual({ kind: "new" });
    expect(d.rows.b).toEqual({ kind: "changed", fields: [{ key: "status", label: "Статус", before: "В работе" }, { key: "comment", label: "Комментарий", before: "позвонил" }] });
    expect(d.removed.map((r) => r.id)).toEqual(["c"]);
  });

  it("сегмент и срок: смена сегмента видна отдельным полем; пустое и отсутствующее значение равны", () => {
    const week2 = table(buildArchiveRows([row("a", { segmentId: "s2", segmentName: "Портовый флот", deadline: new Date("2026-10-01T00:00:00.000Z") }), row("b", { comment: "" }), row("c", { comment: null })], [], segments));
    const d = diffArchiveTables(week1, week2)!;
    expect(d.rows.a).toMatchObject({ kind: "changed" });
    expect((d.rows.a as { fields: Array<{ key: string }> }).fields.map((f) => f.key)).toEqual(["segment", "deadline"]);
    expect(d.rows.b).toMatchObject({ kind: "changed" }); // комментарий «позвонил» → пусто
    expect(d.rows.c).toMatchObject({ kind: "changed" });
  });

  it("одинаковые недели — без изменений; неполные снимки (старые версии) не сравниваются", () => {
    expect(diffArchiveTables(week1, week1)!.summary).toEqual({ new: 0, changed: 0, removed: 0 });
    expect(diffArchiveTables(table(week1.rows, "submitted"), week1)).toBeNull();
    expect(diffArchiveTables(week1, table(week1.rows, "none"))).toBeNull();
  });
});
