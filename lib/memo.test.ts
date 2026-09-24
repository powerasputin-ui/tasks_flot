import { describe, expect, it } from "vitest";
import { OTHER_SECTION_ID, splitTitleDate, acceptSource, buildDraft, manualBullet, memoTitle, mergeBullets, notIncluded, parseMemoDoc, refreshDraft, resolveTitle, resyncSections, setIncluded, sourceText, stripSectionHead, syncWithSources, visibleSections, type SectionDef, type SourceItem } from "@/lib/memo";

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

  it("снятая подача убирает пункт из файла, но текст следует «Виду справки», пока строка на месте", async () => {
    const { hideMissingSources } = await import("@/lib/memo");
    const doc = buildDraft([item("a", { comment: "Было" })], defs);
    // строку сняли с подачи и заодно поменяли комментарий
    const items = [item("a", { operFlag: false, comment: "Стало" })];
    const r = syncWithSources(doc, items);
    expect(r.doc.sections[0].bullets[0].text).toBe("Стало"); // текст не застревает
    const veiled = hideMissingSources(r.doc, r.flags);
    expect(veiled.hidden).toBe(1);
    expect(veiled.doc.sections[0].bullets[0].hidden).toBe(true); // в файл не пойдёт
    expect(visibleSections(veiled.doc)).toHaveLength(0);
  });

  it("строку, которую директор положил в справку сам, автоматика не убирает даже без подачи", async () => {
    const { hideMissingSources, setIncluded } = await import("@/lib/memo");
    const notSubmitted = item("a", { operFlag: false, comment: "Не подана, но нужна в справке" });
    const doc = setIncluded({ sections: [] }, notSubmitted, true, defs, [notSubmitted]);
    expect(doc.sections[0].bullets[0].pinned).toBe(true);
    const r = syncWithSources(doc, [notSubmitted]);
    expect(r.flags.get(doc.sections[0].bullets[0].id)?.sourceMissing).toBe("unsubmitted");
    const veiled = hideMissingSources(r.doc, r.flags);
    expect(veiled.hidden).toBe(0); // решение человека сильнее автоматики
    expect(visibleSections(veiled.doc)).toHaveLength(1);
  });

  it("hideMissingSources не трогает пункты с живыми источниками и уже скрытые", async () => {
    const { hideMissingSources } = await import("@/lib/memo");
    const doc = buildDraft([item("a"), item("bb")], defs);
    const r = syncWithSources(doc, [item("a"), item("bb")]);
    const veiled = hideMissingSources(r.doc, r.flags);
    expect(veiled.hidden).toBe(0);
    expect(veiled.doc).toBe(r.doc);
  });

  it("отозванная подача и архивная строка помечаются разными причинами, пункт остаётся", () => {
    const doc = buildDraft([item("a"), item("bb")], defs);
    const r = syncWithSources(doc, [item("a", { operFlag: false })]);
    const [b1, b2] = r.doc.sections[0].bullets;
    expect(r.flags.get(b1.id)?.sourceMissing).toBe("unsubmitted"); // источник на месте, но «Отправить» снято
    expect(r.flags.get(b2.id)?.sourceMissing).toBe("archived"); // строки bb нет в выборке — архивные не приходят, безвозвратного удаления в системе нет
    expect(r.doc.sections[0].bullets).toHaveLength(2);
  });

  it("ручные пункты без источников не помечаются", () => {
    const doc = { sections: [{ id: "s1", title: "Р", kind: "section" as const, bullets: [manualBullet("Текст")] }] };
    expect(syncWithSources(doc, []).flags.size).toBe(0);
  });

  it("смена «вида справки» (другой item.text при том же комментарии) не помечает отредактированный пункт «источник изменился»", () => {
    const doc = buildDraft([item("a", { comment: "Комментарий" })], defs);
    doc.sections[0].bullets[0] = { ...doc.sections[0].bullets[0], text: "Моя версия", edited: true };
    // комментарий тот же — просто в «виде справки» отметили ещё столбцы, item.text теперь другой
    const r = syncWithSources(doc, [item("a", { comment: "Комментарий", text: "Сегмент / Трек: Комментарий" })]);
    expect(r.flags.get(doc.sections[0].bullets[0].id)).toEqual({ sourceChanged: false, sourceMissing: false });
  });

  it("непоправленный пункт с одним источником подхватывает новый «вид справки», даже если сырые данные не менялись", () => {
    const doc = buildDraft([item("a", { comment: "Комментарий" })], defs);
    const r = syncWithSources(doc, [item("a", { comment: "Комментарий", text: "Сегмент / Трек: Комментарий" })]);
    expect(r.autoUpdated).toBe(1);
    expect(r.doc.sections[0].bullets[0].text).toBe("Сегмент / Трек: Комментарий");
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

describe("вид справки: отмеченные галочки определяют и структуру, и текст пункта", () => {
  const src = { title: "Финализация КП", comment: "Получены индикативы.", segmentName: "Строительный флот", trackName: "Баржа", ownerName: "Сухов В.А.", deadline: "2026-09-07T00:00:00Z", statusName: "В работе" };

  it("по умолчанию — комментарий; нет комментария — название задачи", async () => {
    const { composeText } = await import("@/lib/memo");
    expect(composeText(src, ["comment"])).toBe("Получены индикативы.");
    expect(composeText({ ...src, comment: null }, ["comment"])).toBe("Финализация КП");
  });

  it("Сегмент и Трек — обычные столбцы: можно отметить любые вместе, они добавляются в начало текста", async () => {
    const { composeText } = await import("@/lib/memo");
    expect(composeText(src, ["task", "comment"])).toBe("Финализация КП: Получены индикативы.");
    expect(composeText(src, ["segment", "track", "comment"])).toBe("Строительный флот / Баржа: Получены индикативы.");
    expect(composeText(src, ["track", "comment"])).toBe("Баржа: Получены индикативы.");
    expect(composeText(src, ["comment", "owner", "deadline", "status"])).toBe("Получены индикативы. (Сухов В.А.; срок 07.09.2026; В работе)");
    // пустые поля пропускаются
    expect(composeText({ ...src, ownerName: null, deadline: null }, ["comment", "owner", "deadline", "status"])).toBe("Получены индикативы. (В работе)");
  });

  it("настройка — только список столбцов; разбирается устойчиво: мусор → значения по умолчанию, повторы убираются", async () => {
    const { parseMemoConfig } = await import("@/lib/memo");
    expect(parseMemoConfig(null)).toEqual({ fields: ["track", "comment"] }); // из коробки: разделы по трекам + комментарий
    expect(parseMemoConfig({ fields: ["task", "task", "нет", "comment"] })).toEqual({ fields: ["task", "comment"] });
    expect(parseMemoConfig({ fields: [] })).toEqual({ fields: ["track", "comment"] });
  });

  it("в текст попадает только отмеченное: без «Задачи» и «Комментария» текста нет вовсе", async () => {
    const { composeText } = await import("@/lib/memo");
    // раньше здесь «на всякий случай» подставлялось название задачи — из-за этого справка показывала неотмеченное
    expect(composeText(src, ["track"])).toBe("Баржа"); // без текста двоеточие не висит
    expect(composeText(src, ["cost"])).toBe("");
    expect(composeText({ ...src, comment: null }, ["task"])).toBe("Финализация КП");
  });

  it("разделы: строка без трека и без сегмента попадает в «Прочие направления»", async () => {
    const { tracksToSections } = await import("@/lib/memo");
    const bySections = tracksToSections([{ id: "t1", name: "Баржа" }, { id: "t2", name: "Буксиры" }]);
    expect(bySections.map((d) => d.title)).toEqual(["Баржа", "Буксиры"]);
    const items = [item("a", { trackId: "t2" }), item("bb", { trackId: null })];
    expect(buildDraft(items, bySections).sections.map((s) => s.title)).toEqual(["Буксиры", "Прочие направления"]);
  });

  it("разделы: строка без трека, но с сегментом — попадает в раздел по сегменту, а не в «Прочие направления»", async () => {
    const { segmentsToSections, tracksToSections } = await import("@/lib/memo");
    const bySections = [...tracksToSections([{ id: "t1", name: "Баржа" }]), ...segmentsToSections([{ id: "seg1", name: "Флот" }, { id: "seg2", name: "Коммерция" }])];
    const items = [
      item("a", { trackId: "t1", segmentId: "seg2" }), // есть трек — раздел по треку, сегмент не важен
      item("b", { trackId: null, segmentId: "seg2" }), // трека нет — по сегменту
      item("c", { trackId: "zzz", segmentId: "seg1" }), // трек не из структуры — тоже по сегменту
      item("d", { trackId: null, segmentId: null }), // нет ни того, ни другого — «Прочие»
    ];
    const doc = buildDraft(items, bySections);
    expect(doc.sections.map((s) => s.title)).toEqual(["Баржа", "Флот", "Коммерция", "Прочие направления"]);
    expect(doc.sections[0].bullets.map((b) => b.itemIds)).toEqual([["a"]]);
    expect(doc.sections[1].bullets.map((b) => b.itemIds)).toEqual([["c"]]);
    expect(doc.sections[2].bullets.map((b) => b.itemIds)).toEqual([["b"]]);
    expect(doc.sections[3].bullets.map((b) => b.itemIds)).toEqual([["d"]]);
  });

  it("stripSectionHead: убирает из трека/сегмента строки тот, что стал жирным заголовком её раздела", async () => {
    const { segmentsToSections, tracksToSections } = await import("@/lib/memo");
    const bySections = [...tracksToSections([{ id: "t1", name: "Полупогружное судно" }]), ...segmentsToSections([{ id: "seg1", name: "Крупнотоннажные перевозки" }])];
    // раздел по треку — трек убираем, сегмент остаётся (не дублирование, а уточнение)
    expect(stripSectionHead({ trackId: "t1", segmentId: "seg1", trackName: "Полупогружное судно", segmentName: "Крупнотоннажные перевозки" }, bySections)).toEqual({
      trackName: null,
      segmentName: "Крупнотоннажные перевозки",
    });
    // трека нет, раздел — по сегменту — сегмент убираем
    expect(stripSectionHead({ trackId: null, segmentId: "seg1", trackName: null, segmentName: "Крупнотоннажные перевозки" }, bySections)).toEqual({
      trackName: null,
      segmentName: null,
    });
    // трек есть, но не из структуры (осиротевший) — раздел фактически по сегменту, трек не дублирует заголовок и остаётся
    expect(stripSectionHead({ trackId: "zzz", segmentId: "seg1", trackName: "Устаревший трек", segmentName: "Крупнотоннажные перевозки" }, bySections)).toEqual({
      trackName: "Устаревший трек",
      segmentName: null,
    });
    // ни трека, ни сегмента в структуре — «Прочие», ничего не убирается (там и убирать нечего)
    expect(stripSectionHead({ trackId: null, segmentId: null, trackName: null, segmentName: null }, bySections)).toEqual({ trackName: null, segmentName: null });
  });

  it("resyncSections: пункт, застрявший в «Прочие направления», переезжает в свой раздел, когда у строки появился трек", async () => {
    const { tracksToSections } = await import("@/lib/memo");
    const bySections = tracksToSections([{ id: "t1", name: "Полупогружное судно" }]);
    // на момент сборки трека не было — пункт ушёл в «Прочие»; потом строке проставили трек t1
    const doc = buildDraft([item("a", { trackId: null })], []);
    expect(doc.sections.map((s) => s.id)).toEqual([OTHER_SECTION_ID]);
    const withTrack = [item("a", { trackId: "t1" })];
    const { doc: resynced, moved } = resyncSections(doc, withTrack, bySections);
    expect(moved).toBe(1);
    // опустевший «Прочие» убирается — на листе не должно оставаться пустых заголовков
    expect(resynced.sections.map((s) => s.title)).toEqual(["Полупогружное судно"]);
    expect(resynced.sections[0].bullets.map((b) => b.itemIds)).toEqual([["a"]]);
  });

  it("resyncSections: место пункта следует структуре (даже у отредактированного), а склеенные и без источника остаются", () => {
    const bySections: SectionDef[] = [{ id: "track:t1", title: "Раздел", trackIds: ["t1"] }];
    const items = [item("a", { trackId: "t1" }), item("b", { trackId: "t1" })];
    const own = manualBullet("Мой пункт без источника"); // ничей — остаётся там, куда его положили
    const editedAuto = { ...buildDraft([items[0]], []).sections[0].bullets[0], text: "Моя версия", edited: true };
    const merged = { ...buildDraft([items[0]], []).sections[0].bullets[0], itemIds: ["a", "b"] };
    const doc = { sections: [{ id: OTHER_SECTION_ID, title: "Прочие направления", kind: "other" as const, bullets: [own, editedAuto, merged] }] };
    const { doc: resynced, moved } = resyncSections(doc, items, bySections);
    expect(moved).toBe(1); // переехал только отредактированный пункт с одним источником
    const byTitle = Object.fromEntries(resynced.sections.map((s) => [s.title, s.bullets.map((b) => b.text)]));
    expect(byTitle["Раздел"]).toEqual(["Моя версия"]); // место поменялось, текст правки сохранён
    expect(byTitle["Прочие направления"]).toHaveLength(2);
  });

  it("resyncSections: «pinned» защищает только от автоскрытия — место в структуре пункт всё равно занимает верное", () => {
    // так и застряла реальная строка в «Прочие направления»: pinned блокировал переезд, хотя трек у неё указан верно
    const bySections: SectionDef[] = [{ id: "track:t1", title: "Трек", trackIds: ["t1"] }];
    const items = [item("a", { trackId: "t1" })];
    const bullet = { ...buildDraft(items, []).sections[0].bullets[0], pinned: true }; // добавлен вручную, когда структуры ещё не было
    const doc = { sections: [{ id: OTHER_SECTION_ID, title: "Прочие направления", kind: "other" as const, bullets: [bullet] }] };
    const { doc: resynced, moved } = resyncSections(doc, items, bySections);
    expect(moved).toBe(1);
    expect(resynced.sections.map((s) => s.title)).toEqual(["Трек"]);
  });

  it("resyncSections: сняли «Трек» — разделы по трекам расформировываются, заголовки с листа пропадают", () => {
    const withTrack: SectionDef[] = [{ id: "track:t1", title: "Полупогружное судно", trackIds: ["t1"] }];
    const items = [item("a", { trackId: "t1" })];
    const doc = buildDraft(items, withTrack);
    expect(doc.sections.map((s) => s.title)).toEqual(["Полупогружное судно"]);
    // структура пустая — ни трек, ни сегмент не отмечены: остаётся один раздел без названия
    const { doc: flat } = resyncSections(doc, items, []);
    expect(flat.sections).toHaveLength(1);
    expect(flat.sections[0].title).toBe("");
    expect(flat.sections[0].bullets.map((b) => b.itemIds)).toEqual([["a"]]);
  });

  it("без структуры справка собирается одним разделом без названия", () => {
    const doc = buildDraft([item("a", { trackId: "t1" }), item("bb", { trackId: "t2" })], []);
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].title).toBe("");
    expect(doc.sections[0].bullets).toHaveLength(2);
  });

  it("готовый текст (по виду справки) используется как заготовка пункта", () => {
    const doc = buildDraft([{ ...item("a", { comment: "Комментарий" }), text: "Задача: Комментарий (Сухов)" }], defs);
    expect(doc.sections[0].bullets[0].text).toBe("Задача: Комментарий (Сухов)");
  });
});

describe("вид справки: любые столбцы таблицы, включая свои", () => {
  it("оценка, привлекательность и значения своих колонок идут в скобках с подписями", async () => {
    const { composeText, parseMemoConfig } = await import("@/lib/memo");
    const src = { title: "Задача", comment: "Комментарий.", cost: "2 млн.$", attractivenessName: "P70", custom: { abc: "Срочно", zzz: "" } };
    const labels = { "custom:abc": "Приоритет", "custom:zzz": "Пусто" };
    expect(composeText(src, ["comment", "cost", "attractiveness", "custom:abc", "custom:zzz"], labels)).toBe("Комментарий. (оценка 2 млн.$; привлекательность P70; Приоритет: Срочно)");
    expect(parseMemoConfig({ fields: ["comment", "custom:abc", "custom:", "что-то"] }).fields).toEqual(["comment", "custom:abc"]);
  });
});

describe("заголовок, вписанный директором вручную", () => {
  const items = [item("a", { comment: "Первое." }), item("bb", { comment: "Второе." })];
  const dir = { name: "Дирекция по развитию флота", shortName: "РФ и КЭ" };

  it("resolveTitle: пусто/не задано — заголовок собирается сам; иначе — вписанный текст", () => {
    expect(resolveTitle({ title: undefined }, dir, "2026-09-14")).toBe("Статус текущих задач по дирекции РФ и КЭ к ОС 14.09.2026");
    expect(resolveTitle({ title: "   " }, dir, "2026-09-14")).toBe("Статус текущих задач по дирекции РФ и КЭ к ОС 14.09.2026");
    expect(resolveTitle({ title: "Особая справка для совещания" }, dir, "2026-09-14")).toBe("Особая справка для совещания");
  });

  it("сохранённый заголовок переживает объединение, слияние источников, «обновить из данных» и решение «в справку»", () => {
    const raw = { ...buildDraft(items, defs), title: "Мой заголовок" };
    expect(refreshDraft(raw, items, defs).doc.title).toBe("Мой заголовок");
    expect(syncWithSources(raw, items).doc.title).toBe("Мой заголовок");
    const [a, b] = raw.sections[0].bullets;
    expect(mergeBullets(raw, "s1", a.id, b.id, items).title).toBe("Мой заголовок");
    expect(acceptSource(raw, a.id, items).title).toBe("Мой заголовок");
    expect(setIncluded(raw, items[0], false, defs, items).title).toBe("Мой заголовок");
    expect(setIncluded(raw, item("ccc", { trackId: "t2" }), true, defs, items).title).toBe("Мой заголовок");
  });

  it("разбор из базы: пустая строка не считается вписанным заголовком, обычный текст — считается", () => {
    expect(parseMemoDoc({ sections: [], title: "   " })?.title).toBeUndefined();
    expect(parseMemoDoc({ sections: [], title: "Особая справка" })?.title).toBe("Особая справка");
    expect(parseMemoDoc({ sections: [] })?.title).toBeUndefined();
  });
});

describe("splitTitleDate: дата совещания — отдельной строкой", () => {
  it("делит заголовок на название и дату (без «к ОС»)", () => {
    expect(splitTitleDate("Статус текущих задач — Дирекция по развитию флота к ОС 17.09.2026")).toEqual({ main: "Статус текущих задач — Дирекция по развитию флота", date: "17.09.2026" });
    expect(splitTitleDate("Статус задач, к ОС 01.10.2026 ")).toEqual({ main: "Статус задач", date: "01.10.2026" });
  });
  it("без даты или с датой не в конце — заголовок целиком", () => {
    expect(splitTitleDate("Справка по флоту")).toEqual({ main: "Справка по флоту", date: "" });
    expect(splitTitleDate("к ОС 17.09.2026 итоги")).toEqual({ main: "к ОС 17.09.2026 итоги", date: "" });
  });
});
