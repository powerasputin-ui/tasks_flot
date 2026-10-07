import { describe, expect, it } from "vitest";
import { checkTrackName, findTrackMatches, trackKey } from "@/lib/track-name";

describe("checkTrackName", () => {
  it("убирает лишние пробелы и кавычки, первая буква заглавная", () => {
    expect(checkTrackName("  «нефть   и газ» ")).toEqual({ ok: true, name: "Нефть и газ" });
  });
  it("мусор отклоняет", () => {
    for (const bad of ["", " ", "а", "123", "!!!", "ааааа", "ыыыыы", "ввввв привет"]) expect(checkTrackName(bad).ok, bad).toBe(false);
    expect(checkTrackName("x".repeat(81)).ok).toBe(false);
  });
});

describe("trackKey", () => {
  it("регистр, е/ё, пробелы и дефисы не важны", () => {
    expect(trackKey("Нефть-Газ")).toBe(trackKey("нефть  газ"));
    expect(trackKey("Объём")).toBe(trackKey("объем"));
  });
});

describe("findTrackMatches", () => {
  const tracks = [{ name: "Нефтехимия" }, { name: "Газ и СПГ" }, { name: "Металлургия" }, { name: "Уголь" }];
  it("по буквам: начало названия и слова", () => {
    expect(findTrackMatches("неф", tracks).map((m) => m.track.name)).toEqual(["Нефтехимия"]);
    expect(findTrackMatches("спг", tracks)[0].track.name).toBe("Газ и СПГ");
  });
  it("точный повтор (с другим регистром и ё/е) помечается exact", () => {
    expect(findTrackMatches("УГОЛЬ", tracks)[0]).toMatchObject({ kind: "exact" });
  });
  it("опечатка — похожий трек", () => {
    expect(findTrackMatches("Металургия", tracks)[0]).toMatchObject({ kind: "similar", track: { name: "Металлургия" } });
  });
  it("совсем другое — ничего не предлагаем", () => {
    expect(findTrackMatches("Рыбалка", tracks)).toEqual([]);
  });
});

describe("findTrackMatches: опечатка в длинном названии", () => {
  it("«газавозы» находит «Газовозы (приобретение для РХА)»", () => {
    const m = findTrackMatches("газавозы", [{ name: "Газовозы (приобретение для РХА)" }, { name: "Буксиры СЭ" }]);
    expect(m.map((x) => x.track.name)).toEqual(["Газовозы (приобретение для РХА)"]);
  });
});
