import { describe, expect, it } from "vitest";
import { highlightRegex, matchesTokens, normalizeText, tokenize } from "@/lib/search";
import { applyTableFilters, searchHaystack, type TableRow } from "@/lib/table-view";

function row(o: Partial<TableRow>): TableRow {
  return {
    id: "1",
    segmentId: "s1",
    segmentName: "Танкерный флот",
    trackId: "t1",
    trackName: "Бункеровщики",
    name: "Покупка судна",
    cost: "2 млн.$",
    attractivenessId: null,
    attractivenessName: null,
    attractivenessColor: null,
    ownerId: null,
    ownerName: "Сухов В.А.",
    ownerRole: null,
    deadline: null,
    deadlineWeek: null,
    statusId: null,
    statusName: "В работе",
    statusColor: null,
    operFlag: false,
    comment: null,
    version: 1,
    createdById: "u",
    changedAfterSubmission: false,
    customValues: {},
    createdByName: "Иванов",
    updatedAt: new Date("2026-01-01"),
    staleWeeks: 0,
    archived: false,
    ...o,
  };
}

const ids = (rows: TableRow[]) => rows.map((r) => r.id);

describe("нормализация и слова запроса", () => {
  it("регистр, ё/е и лишние пробелы не важны", () => {
    expect(normalizeText("  БерЁзов   ПЁТР ")).toBe("березов петр");
    expect(normalizeText("а б")).toBe("а б");
  });

  it("слова без повторов, пустой запрос — пусто, длина ограничена", () => {
    expect(tokenize("Сухов сухов  танкер")).toEqual(["сухов", "танкер"]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("a b c d e f g h i j")).toHaveLength(8);
    expect(tokenize("x".repeat(500))[0]).toHaveLength(200);
  });

  it("matchesTokens требует все слова", () => {
    expect(matchesTokens("покупка судна сухов", ["сухов", "судна"])).toBe(true);
    expect(matchesTokens("покупка судна", ["сухов", "судна"])).toBe(false);
  });
});

describe("подсветка", () => {
  it("находит слова независимо от регистра и ё/е, спецсимволы экранируются", () => {
    const re = highlightRegex("береза (тест)")!;
    expect("Берёза (ТЕСТ) и берёзы".match(re)).toEqual(["Берёза", "(ТЕСТ)"]);
    expect(highlightRegex("  ")).toBeNull();
  });
});

describe("поиск по строкам таблицы", () => {
  it("несколько слов ищутся в разных полях и в любом порядке", () => {
    const rows = [row({ id: "1" }), row({ id: "2", ownerName: "Давыдов Д.М.", trackName: "Танкеры" })];
    expect(ids(applyTableFilters(rows, { q: "сухов бункеровщики" }))).toEqual(["1"]);
    expect(ids(applyTableFilters(rows, { q: "бункеровщики сухов" }))).toEqual(["1"]);
    expect(ids(applyTableFilters(rows, { q: "сухов танкеры" }))).toEqual([]);
  });

  it("ё и е равны, регистр не важен", () => {
    const rows = [row({ id: "1", name: "Переговоры с Берёзовым" })];
    expect(ids(applyTableFilters(rows, { q: "БЕРЕЗОВЫМ" }))).toEqual(["1"]);
  });

  it("ищет по статусу, привлекательности (код и пояснение), сумме и сегменту", () => {
    const rows = [row({ id: "1", attractivenessName: "P70" })];
    for (const q of ["в работе", "p70", "выше среднего", "млн", "танкерный"]) {
      expect(ids(applyTableFilters(rows, { q }))).toEqual(["1"]);
    }
    expect(ids(applyTableFilters(rows, { q: "высокая" }))).toEqual([]);
  });

  it("ищет по дедлайну в двух записях: 20.09.2026 и 2026-09-20", () => {
    const rows = [row({ id: "1", deadline: new Date("2026-09-20T00:00:00Z") })];
    expect(ids(applyTableFilters(rows, { q: "2026-09-20" }))).toEqual(["1"]);
    expect(ids(applyTableFilters(rows, { q: "20.09.2026" }))).toEqual(["1"]);
  });

  it("ищет по значениям своих колонок", () => {
    const rows = [row({ id: "1", customValues: { a: "Срочно" } }), row({ id: "2" })];
    expect(ids(applyTableFilters(rows, { q: "срочно" }))).toEqual(["1"]);
  });

  it("пустой запрос и запрос из пробелов не фильтруют; спецсимволы не ломают", () => {
    const rows = [row({ id: "1" }), row({ id: "2", name: "Другое" })];
    expect(applyTableFilters(rows, { q: "   " })).toHaveLength(2);
    expect(() => applyTableFilters(rows, { q: "(*[\\" })).not.toThrow();
    expect(applyTableFilters(rows, { q: "(*[" })).toHaveLength(0);
  });

  it("поисковый текст не содержит пустых значений", () => {
    expect(searchHaystack(row({ comment: null, cost: null }))).not.toContain("null");
  });
});
