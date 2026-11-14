import { describe, expect, it } from "vitest";
import { addTrackLabel, allLabel, DEFAULT_TERMS, noneLabel, normalizeTerms, noTrackLabel, segmentsCount, TERM_MAX, termsKey, trackColumnLabel, tracksCount, withoutTermLabels, withTermLabels } from "@/lib/terms";

describe("названия разделов таблицы у дирекции", () => {
  it("ничего не настроено или запись испорчена — «Сегмент / Сегменты» и «Трек / Треки»", () => {
    for (const v of [null, undefined, "Проект", 5, {}, { one: "", many: "   " }]) expect(normalizeTerms(v)).toEqual(DEFAULT_TERMS);
  });
  it("свои названия: пробелы убраны, длина ограничена, пустое поле — по умолчанию; сегменты и треки независимы", () => {
    expect(normalizeTerms({ one: "  Проект ", many: "Проекты" })).toEqual({ ...DEFAULT_TERMS, one: "Проект", many: "Проекты" });
    expect(normalizeTerms({ one: "", many: "Суда" })).toMatchObject({ one: "Сегмент", many: "Суда" });
    expect(normalizeTerms({ one: "я".repeat(100), many: "Суда" }).one).toHaveLength(TERM_MAX);
    expect(normalizeTerms({ trackOne: "Судно", trackMany: "Суда" })).toEqual({ ...DEFAULT_TERMS, trackOne: "Судно", trackMany: "Суда" });
  });
  it("подписи: по умолчанию — как было; со своим названием — без угадывания падежа", () => {
    expect([allLabel(DEFAULT_TERMS), noneLabel(DEFAULT_TERMS), segmentsCount(DEFAULT_TERMS, 2)]).toEqual(["Все сегменты", "Без сегмента", "Сегментов: 2"]);
    expect([noTrackLabel(DEFAULT_TERMS), tracksCount(DEFAULT_TERMS, 3), addTrackLabel(DEFAULT_TERMS)]).toEqual(["Без трека", "треков: 3", "Добавить трек"]);
    const t = { one: "Проект", many: "Проекты", trackOne: "Судно", trackMany: "Суда" };
    expect([allLabel(t), noneLabel(t), segmentsCount(t, 2)]).toEqual(["Проекты: все", "Проект: не указано", "Проекты: 2"]);
    expect([noTrackLabel(t), tracksCount(t, 3), addTrackLabel(t)]).toEqual(["Судно: не указано", "суда: 3", "Добавить: судно"]);
    // аббревиатуру в середине фразы не «опускаем»
    expect(tracksCount({ ...t, trackMany: "ТОФ" }, 1)).toBe("ТОФ: 1");
  });
  it("колонка «Трек»: своя подпись колонки важнее названия дирекции; название дирекции не сохраняется как подпись", () => {
    const t = { ...DEFAULT_TERMS, trackOne: "Судно", trackMany: "Суда" };
    expect(trackColumnLabel("Трек", t)).toBe("Судно");
    expect(trackColumnLabel("  ", t)).toBe("Судно");
    expect(trackColumnLabel("Объект", t)).toBe("Объект");
    const cols = [{ key: "track", label: "Трек" }, { key: "name", label: "Задача" }];
    const shown = withTermLabels(cols, t);
    expect(shown.map((c) => c.label)).toEqual(["Судно", "Задача"]);
    expect(withoutTermLabels(shown, t)).toEqual(cols);
    // своя подпись колонки проходит туда и обратно без изменений
    const own = [{ key: "track", label: "Объект" }];
    expect(withoutTermLabels(withTermLabels(own, t), t)).toEqual(own);
  });
  it("у каждой дирекции свой ключ настройки", () => {
    expect(termsKey("a")).not.toBe(termsKey("b"));
  });
});
