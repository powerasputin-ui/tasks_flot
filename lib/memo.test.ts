import { describe, expect, it } from "vitest";
import { OTHER_SECTION_ID, acceptSource, buildDraft, manualBullet, memoTitle, mergeBullets, notIncluded, parseMemoDoc, refreshDraft, sourceText, syncWithSources, visibleSections, type SectionDef, type SourceItem } from "@/lib/memo";

const item = (id: string, o: Partial<SourceItem> = {}): SourceItem => ({ id, title: `Задача ${id}`, comment: null, operFlag: true, archived: false, trackId: "t1", createdAt: `2026-09-0${id.length}T10:00:00Z`, ...o });
const defs: SectionDef[] = [
  { id: "s1", title: "Кабелеукладочное направление", trackIds: ["t1"] },
  { id: "s2", title: "Буксиры и терминал", trackIds: ["t2", "t3"] },
];

describe("сборка черновика", () => {
  it("раскладывает поданные строки по разделам структуры, «Прочие» — в конце; неподанные и архивные не входят", () => {
    const items = [
      item("a", { trackId: "t2", comment: "Направлены ТТХ буксиров" }),
      item("b", { trackId: "t1" }),
      item("c", { trackId: null }),
      item("d", { trackId: "t1", operFlag: false }),
      item("e", { trackId: "t1", archived: true }),
      item("f", { trackId: "zzz" }), // трек, которого нет в структуре
    ];
    const doc = buildDraft(items, defs);
    expect(doc.sections.map((s) => s.id)).toEqual(["s1", "s2", OTHER_SECTION_ID]);
    expect(doc.sections[0].bullets.map((b) => b.itemIds)).toEqual([["b"]]);
    expect(doc.sections[1].bullets[0].text).toBe("Направлены ТТХ буксиров");
    expect(doc.sections[2].bullets.map((b) => b.itemIds[0]).sort()).toEqual(["c", "f"]);
  });

  it("заготовка пункта — комментарий; если пуст — название задачи; пробелы схлопываются", () => {
    expect(sourceText({ title: "Задача", comment: "  Получены\n  индикативы  " })).toBe("Получены индикативы");
    expect(sourceText({ title: "Задача", comment: "  " })).toBe("Задача");
  });

  it("порядок строк внутри раздела — по времени создания (как в таблице сверху вниз)", () => {
    const doc = buildDraft([item("bbb", { createdAt: "2026-09-05T00:00:00Z" }), item("a", { createdAt: "2026-09-01T00:00:00Z" })], defs);
    expect(doc.sections[0].bullets.map((b) => b.itemIds[0])).toEqual(["a", "bbb"]);
  });
});

describe("«Обновить из данных»", () => {
  it("добавляет только новые поданные строки, отредактированные и скрытые пункты не трогает", () => {
    const first = buildDraft([item("a"), item("bb")], defs);
    first.sections[0].bullets[0] = { ...first.sections[0].bullets[0], text: "Мой текст", edited: true };
    first.sections[0].bullets[1] = { ...first.sections[0].bullets[1], hidden: true };
    const { doc, added } = refreshDraft(first, [item("a"), item("bb"), item("ccc", { trackId: "t2" })], defs);
    expect(added).toBe(1);
    expect(doc.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(doc.sections[0].bullets[0].text).toBe("Мой текст");
    expect(doc.sections[0].bullets[1].hidden).toBe(true); // скрытый не воскресает как «новый»
    expect(refreshDraft(doc, [item("a"), item("bb"), item("ccc", { trackId: "t2" })], defs).added).toBe(0);
  });
});

describe("связь с источниками", () => {
  it("неправленный пункт с одним источником обновляется сам", () => {
    const doc = buildDraft([item("a", { comment: "Было" })], defs);
    const r = syncWithSources(doc, [item("a", { comment: "Стало" })]);
    expect(r.autoUpdated).toBe(1);
    expect(r.doc.sections[0].bullets[0].text).toBe("Стало");
  });

  it("отредактированный пункт не перезаписывается, а помечается «источник изменился»; принять — снимает пометку", () => {
    let doc = buildDraft([item("a", { comment: "Было" })], defs);
    doc.sections[0].bullets[0] = { ...doc.sections[0].bullets[0], text: "Моя версия", edited: true };
    const r = syncWithSources(doc, [item("a", { comment: "Стало" })]);
    expect(r.doc.sections[0].bullets[0].text).toBe("Моя версия");
    const id = r.doc.sections[0].bullets[0].id;
    expect(r.flags.get(id)).toEqual({ sourceChanged: true, sourceMissing: false });
    doc = acceptSource(r.doc, id, [item("a", { comment: "Стало" })]);
    expect(syncWithSources(doc, [item("a", { comment: "Стало" })]).flags.get(id)?.sourceChanged).toBe(false);
  });

  it("снятая с подачи или удалённая строка помечается «источник пропал», пункт остаётся", () => {
    const doc = buildDraft([item("a"), item("bb")], defs);
    const r = syncWithSources(doc, [item("a", { operFlag: false })]);
    const [b1, b2] = r.doc.sections[0].bullets;
    expect(r.flags.get(b1.id)?.sourceMissing).toBe(true);
    expect(r.flags.get(b2.id)?.sourceMissing).toBe(true); // строки bb нет в данных вообще
    expect(r.doc.sections[0].bullets).toHaveLength(2);
  });

  it("ручные пункты без источников не помечаются", () => {
    const doc = { sections: [{ id: "s1", title: "Р", kind: "section" as const, bullets: [manualBullet("Текст")] }] };
    expect(syncWithSources(doc, []).flags.size).toBe(0);
  });
});

describe("правка структуры", () => {
  it("объединение склеивает тексты и источники, помечает пункт отредактированным", () => {
    const items = [item("a", { comment: "Первое." }), item("bb", { comment: "Второе." })];
    const doc = buildDraft(items, defs);
    const [a, b] = doc.sections[0].bullets;
    const merged = mergeBullets(doc, "s1", a.id, b.id, items);
    expect(merged.sections[0].bullets).toHaveLength(1);
    expect(merged.sections[0].bullets[0].text).toBe("Первое. Второе.");
    expect(merged.sections[0].bullets[0].itemIds).toEqual(["a", "bb"]);
    expect(merged.sections[0].bullets[0].edited).toBe(true);
    // после слияния пометки «источник изменился» нет
    expect(syncWithSources(merged, items).flags.get(a.id)?.sourceChanged).toBe(false);
  });

  it("строки, не вошедшие в справку: неподанные, а также подавшие, но скрытые", () => {
    const items = [item("a"), item("bb"), item("ccc", { operFlag: false })];
    const doc = buildDraft(items, defs);
    doc.sections[0].bullets[1] = { ...doc.sections[0].bullets[1], hidden: true };
    expect(notIncluded(doc, items).map((i) => i.id).sort()).toEqual(["bb", "ccc"]);
  });

  it("видимые разделы: скрытые и пустые пункты и пустые разделы не идут в файл", () => {
    const doc = buildDraft([item("a"), item("bb", { trackId: "t2" })], defs);
    doc.sections[1].bullets[0] = { ...doc.sections[1].bullets[0], hidden: true };
    doc.sections[0].bullets.push(manualBullet("   "));
    const v = visibleSections(doc);
    expect(v.map((s) => s.id)).toEqual(["s1"]);
    expect(v[0].bullets).toHaveLength(1);
  });
});

describe("заголовок и разбор", () => {
  it("«Статус текущих задач по дирекции РФ и КЭ к ОС 14.09.2026»", () => {
    expect(memoTitle({ name: "Дирекция по развитию флота", shortName: "РФ и КЭ" }, "2026-09-14T09:00:00")).toBe("Статус текущих задач по дирекции РФ и КЭ к ОС 14.09.2026");
    expect(memoTitle({ name: "Дирекция по развитию флота", shortName: null }, null)).toBe("Статус текущих задач — Дирекция по развитию флота");
  });

  it("мусор из базы превращается в null, неполный документ — в полный", () => {
    expect(parseMemoDoc(null)).toBeNull();
    expect(parseMemoDoc({ x: 1 })).toBeNull();
    const d = parseMemoDoc({ sections: [{ id: 1, bullets: [{ id: 2, text: "т" }] }] });
    expect(d?.sections[0].bullets[0]).toMatchObject({ id: "2", text: "т", itemIds: [], origin: "auto", edited: false, hidden: false });
  });
});
