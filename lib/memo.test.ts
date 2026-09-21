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

describe("решение «в справку» из таблицы", () => {
  it("включить: добавляется пунктом в раздел трека; уже есть — просто показывается; скрытый возвращается", async () => {
    const { setIncluded } = await import("@/lib/memo");
    const items = [item("a"), item("bb", { trackId: "t2", operFlag: false })];
    const doc = buildDraft(items, defs);
    expect(doc.sections).toHaveLength(1); // неподанный не входит
    const added = setIncluded(doc, items[1], true, defs, items);
    expect(added.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(added.sections[1].bullets[0].itemIds).toEqual(["bb"]);
    // повторное включение не плодит пункты
    expect(setIncluded(added, items[1], true, defs, items).sections[1].bullets).toHaveLength(1);
    // скрытый возвращается
    const hidden = setIncluded(added, items[1], false, defs, items);
    expect(hidden.sections[1].bullets[0].hidden).toBe(true);
    expect(setIncluded(hidden, items[1], true, defs, items).sections[1].bullets[0].hidden).toBe(false);
  });

  it("исключить: пункт с одной строкой скрывается (не вернётся при «Обновить из данных»); у объединённого строка убирается из источников", async () => {
    const { setIncluded } = await import("@/lib/memo");
    const items = [item("a", { comment: "Первое." }), item("bb", { comment: "Второе." })];
    let doc = buildDraft(items, defs);
    const single = setIncluded(doc, items[0], false, defs, items);
    expect(single.sections[0].bullets[0].hidden).toBe(true);
    expect(refreshDraft(single, items, defs).added).toBe(0);
    doc = mergeBullets(doc, "s1", doc.sections[0].bullets[0].id, doc.sections[0].bullets[1].id, items);
    const cut = setIncluded(doc, items[1], false, defs, items);
    expect(cut.sections[0].bullets[0].itemIds).toEqual(["a"]);
    expect(cut.sections[0].bullets[0].hidden).toBe(false);
  });

  it("«ждут решения»: поданные строки, которых ещё нет ни в одном пункте (даже скрытом)", async () => {
    const { undecided } = await import("@/lib/memo");
    const items = [item("a"), item("bb"), item("ccc", { operFlag: false })];
    const doc = buildDraft([items[0]], defs);
    expect(undecided(doc, items).map((i) => i.id)).toEqual(["bb"]);
  });
});

describe("вид справки: поля таблицы и автоматические разделы", () => {
  const src = { title: "Финализация КП", comment: "Получены индикативы.", segmentName: "Строительный флот", trackName: "Баржа", ownerName: "Сухов В.А.", deadline: "2026-09-07T00:00:00Z", statusName: "В работе" };

  it("по умолчанию — комментарий; нет комментария — название задачи", async () => {
    const { composeText } = await import("@/lib/memo");
    expect(composeText(src, ["comment"])).toBe("Получены индикативы.");
    expect(composeText({ ...src, comment: null }, ["comment"])).toBe("Финализация КП");
  });

  it("выбранные поля собираются в порядке: сегмент / трек: задача: комментарий (ответственный; срок; статус)", async () => {
    const { composeText } = await import("@/lib/memo");
    expect(composeText(src, ["task", "comment"])).toBe("Финализация КП: Получены индикативы.");
    expect(composeText(src, ["segment", "track", "comment"])).toBe("Строительный флот / Баржа: Получены индикативы.");
    expect(composeText(src, ["comment", "owner", "deadline", "status"])).toBe("Получены индикативы. (Сухов В.А.; срок 07.09.2026; В работе)");
    // пустые поля пропускаются
    expect(composeText({ ...src, ownerName: null, deadline: null }, ["comment", "owner", "deadline", "status"])).toBe("Получены индикативы. (В работе)");
  });

  it("настройка разбирается устойчиво: мусор → значения по умолчанию, повторы убираются", async () => {
    const { parseMemoConfig } = await import("@/lib/memo");
    expect(parseMemoConfig(null)).toEqual({ groupBy: null, fields: ["comment"] });
    expect(parseMemoConfig({ groupBy: "segment", fields: ["task", "task", "нет", "comment"] })).toEqual({ groupBy: "segment", fields: ["task", "comment"] });
    expect(parseMemoConfig({ groupBy: "мусор", fields: [] })).toEqual({ groupBy: null, fields: ["comment"] });
  });

  it("разделы автоматом: по трекам или по сегментам; строка попадает в раздел своего трека/сегмента", async () => {
    const { autoDefs } = await import("@/lib/memo");
    const byTrack = autoDefs("track", [{ id: "t1", name: "Баржа" }, { id: "t2", name: "Буксиры" }], []);
    expect(byTrack.map((d) => d.title)).toEqual(["Баржа", "Буксиры"]);
    const items = [item("a", { trackId: "t2" }), item("bb", { trackId: null })];
    expect(buildDraft(items, byTrack).sections.map((s) => s.title)).toEqual(["Буксиры", "Прочие направления"]);
    const bySegment = autoDefs("segment", [], [{ id: "g1", name: "Строительный флот" }]);
    const doc = buildDraft([{ ...item("a", { trackId: "t9" }), segmentId: "g1" }], bySegment);
    expect(doc.sections.map((s) => s.title)).toEqual(["Строительный флот"]); // трек не в справочнике разделов, но сегмент подошёл
  });

  it("готовый текст (по виду справки) используется как заготовка пункта", () => {
    const doc = buildDraft([{ ...item("a", { comment: "Комментарий" }), text: "Задача: Комментарий (Сухов)" }], defs);
    expect(doc.sections[0].bullets[0].text).toBe("Задача: Комментарий (Сухов)");
  });
});
