import { describe, expect, it } from "vitest";
import { buildDraft, type SectionDef, type SourceItem } from "@/lib/memo";
import { effectiveDate, matchBullets, memoSearchText, versionMatches, type VersionSource } from "@/lib/memo-archive";

const it1: SourceItem = { id: "a", title: "Финализация КП на комплект оборудования", comment: "Получены индикативы. Ёлка.", operFlag: true, archived: false, trackId: "t1" };
const defs: SectionDef[] = [{ id: "s1", title: "Кабелеукладочное направление", trackIds: ["t1"] }];
const sources: VersionSource[] = [{ id: "a", title: it1.title, comment: it1.comment, ownerName: "Сухов В.А.", statusName: "В работе", deadline: null, trackName: "Баржа", segmentName: null }];
const doc = buildDraft([it1], defs);
const title = "Статус текущих задач по дирекции РФ и КЭ к ОС 14.09.2026";

describe("поиск по архиву справок", () => {
  const text = memoSearchText(title, doc, sources);

  it("ищет по тексту пункта, разделу, заголовку и названию задачи; регистр и ё/е не важны, слова в любом порядке", () => {
    for (const q of ["индикативы", "ЕЛКА", "кабелеукладочное", "14.09.2026", "комплект оборудования", "оборудования КП"]) expect(versionMatches(text, q)).toBe(true);
    expect(versionMatches(text, "танкер")).toBe(false);
    expect(versionMatches(text, "   ")).toBe(true); // пустой запрос — всё подходит
  });

  it("пункты-совпадения для подсветки: по тексту пункта и по названию его задачи", () => {
    expect(matchBullets(doc, sources, "индикативы")).toEqual([{ section: "Кабелеукладочное направление", text: "Получены индикативы. Ёлка." }]);
    expect(matchBullets(doc, sources, "финализация")).toHaveLength(1); // нашли по названию задачи-источника
    expect(matchBullets(doc, sources, "танкер")).toEqual([]);
  });

  it("скрытые пункты в поиск не попадают", () => {
    const hidden = { sections: doc.sections.map((s) => ({ ...s, bullets: s.bullets.map((b) => ({ ...b, hidden: true })) })) };
    expect(matchBullets(hidden, sources, "индикативы")).toEqual([]);
    expect(versionMatches(memoSearchText(title, hidden, sources), "индикативы")).toBe(false);
  });

  it("дата оперативки: дата совещания, а если её нет — дата отправки", () => {
    expect(effectiveDate({ meetingDate: "2026-09-14T00:00:00Z", sentAt: "2026-09-20T00:00:00Z" }).toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(effectiveDate({ meetingDate: null, sentAt: "2026-09-20T00:00:00Z" }).toISOString().slice(0, 10)).toBe("2026-09-20");
  });
});
