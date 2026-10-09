import { describe, expect, it } from "vitest";
import { applyQuery, cardLine, journalBlock, labelItems, parseTableQuestion, summaryBlock, tableAnswer, tableContext, wantsJournal, type FactEvent, type FactItem } from "@/lib/ai-table";
import { guardStream, looksGarbage } from "@/lib/ai-guard";

const TODAY = Date.UTC(2026, 9, 9); // 09.10.2026
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
let k = 0;
const item = (o: Partial<FactItem>): FactItem => ({
  id: `i${++k}`, title: "Задача", comment: null, segment: null, track: null, owner: null, author: "Майков Т.Г.", editor: null, status: null, attention: null, cost: null,
  deadline: null, submitted: true, archived: false, files: [], createdAt: new Date(Date.UTC(2026, 9, 1, k)), updatedAt: new Date(Date.UTC(2026, 9, 9)), ...o,
});
const items = [
  item({ title: "Консолидация: запросы в БКК", segment: "Газпром флот", track: "Консолидация деятельности Газпром флот", owner: "Майков Т.Г.", status: "В работе", deadline: d("2026-10-14") }),
  item({ title: "Материалы ГПФ актуализированы", segment: "Газпром флот", track: "Консолидация деятельности Газпром флот", owner: "Майков Т.Г.", status: "Завершено", deadline: d("2026-10-06"), files: [{ name: "a.pptx", path: "\\\\s\\a.pptx" }] }),
  item({ title: "Hai Qiang 18: ТКП ожидается", segment: "Строительный флот", track: "Кабелеукладчик", owner: "Козлов А.С.", status: "В работе", deadline: d("2026-10-07") }),
  item({ title: "Командировка 18–24 октября", segment: "Строительный флот", track: "Кабелеукладчик", owner: "Сухов В.А.", status: "В работе", deadline: d("2026-10-24"), submitted: false }),
  item({ title: "ШК типов А и В — риски", segment: "Строительный флот", track: "Кабелеукладчик", owner: "Сухов В.А.", status: null }),
  item({ title: "тест", owner: "Майков Т.Г.", archived: true }),
];
const dict = { owners: ["Майков Т.Г.", "Сухов В.А.", "Козлов А.С."], segments: ["Газпром флот", "Строительный флот"], tracks: ["Консолидация деятельности Газпром флот", "Кабелеукладчик"], statuses: ["В работе", "Завершено", "Не актуально"] };
const ask = (q: string) => applyQuery(items, parseTableQuestion(q, dict), TODAY).map((i) => i.title);

describe("движок фактов: что спросили → точная выборка по всей таблице", () => {
  it("человек = ответственный, в любом падеже; удалённые не попадают", () => {
    expect(ask("Какие задачи у Майкова?")).toEqual(["Консолидация: запросы в БКК", "Материалы ГПФ актуализированы"]);
    expect(ask("что у Сухова")).toEqual(["Командировка 18–24 октября", "ШК типов А и В — риски"]);
  });
  it("сегмент, трек (трек точнее сегмента), статус, без статуса", () => {
    expect(ask("Что в сегменте «Строительный флот»?")).toHaveLength(3);
    const q = parseTableQuestion("что по треку Консолидация деятельности Газпром флот", dict);
    expect(q.track).toBe("Консолидация деятельности Газпром флот");
    expect(q.segment).toBeUndefined();
    expect(ask("Какие позиции в статусе «В работе»?")).toHaveLength(3);
    expect(ask("У каких позиций не указан статус?")).toEqual(["ШК типов А и В — риски"]);
  });
  it("просрочено — по сроку позиции и не закрытые; ближайшие 7 дней; без срока; не поданы; удалённые", () => {
    expect(ask("Что просрочено на сегодня?")).toEqual(["Hai Qiang 18: ТКП ожидается"]);
    expect(ask("У каких задач срок в ближайшие 7 дней?")).toEqual(["Консолидация: запросы в БКК"]);
    expect(ask("Какие задачи без срока?")).toEqual(["ШК типов А и В — риски"]);
    expect(ask("Какие позиции ещё не поданы в справку?")).toEqual(["Командировка 18–24 октября"]);
    expect(ask("Какие позиции удалены?")).toEqual(["тест"]);
    expect(ask("Есть ли позиции без ответственного?")).toEqual([]);
  });
  it("нет условий — нет выборки (общий вопрос)", () => {
    expect(Object.keys(parseTableQuestion("Что горит?", dict))).toEqual([]);
  });
});

describe("движок фактов: что видит модель", () => {
  const labels = labelItems(items);
  it("карточка со всеми полями; просрочка посчитана", () => {
    const c = cardLine(items[2], labels.get(items[2].id)!, TODAY);
    expect(c).toContain("ответственный: Козлов А.С.");
    expect(c).toContain("срок: 07.10.2026 — просрочен на 2 дн.");
    expect(c).toContain("подана в справку: да");
    expect(c).toContain("создал: Майков Т.Г.");
    expect(cardLine(items[5], labels.get(items[5].id)!, TODAY)).toMatch(/^\[Т\d+\] УДАЛЕНА — /);
  });
  it("итоги — числа и списки готовыми", () => {
    const s = summaryBlock(items, labels, TODAY);
    expect(s).toContain("Действующих позиций: 5; удалённых: 1");
    expect(s).toContain("По статусам: В работе — 3; Завершено — 1; не указан — 1");
    expect(s).toContain("По ответственным: Майков Т.Г. — 2; Сухов В.А. — 2; Козлов А.С. — 1");
    expect(s).toContain(`Просрочено (срок прошёл, статус не «Завершено»/«Не актуально»): [${labels.get(items[2].id)}]`);
    expect(s).toContain("Без ответственного: нет");
  });
  it("журнал — по-человечески, статусы именами; нужен только когда спросили", () => {
    const ev: FactEvent[] = [
      { itemId: items[3].id, at: new Date(Date.UTC(2026, 9, 9, 6, 3)), who: "Майков Т.Г.", action: "OPER_FLAG_CHANGE", field: "operFlag", before: "false", after: "true" },
      { itemId: items[0].id, at: new Date(Date.UTC(2026, 9, 8, 10)), who: "Сухов В.А.", action: "STATUS_CHANGE", field: "statusId", before: "Новая", after: "В работе" },
    ];
    const j = journalBlock(ev, labels);
    expect(j).toContain("09.10, 09:03 Майков Т.Г. — подал в справку");
    expect(j).toContain("Сухов В.А. — сменил статус: Новая → В работе");
    expect(wantsJournal("Что изменилось за последнюю неделю?")).toBe(true);
    expect(wantsJournal("Кто сегодня подавал позиции?")).toBe(true);
    expect(wantsJournal("Какие задачи у Майкова?")).toBe(false);
  });
  it("в окне: сначала выборка и позиции справки; не влезло — сказано, что учтено в итогах", () => {
    const t = tableContext({ items, events: [], question: "Что просрочено?", dict, memoItemIds: [], budget: 100000, today: TODAY });
    expect(t.text).toContain("ВЫБОРКА ПО ВОПРОСУ");
    expect(t.text).toContain("найдено 1");
    const small = tableContext({ items, events: [], question: "Что просрочено?", dict, memoItemIds: [], budget: 1800, today: TODAY });
    expect(small.text).toContain("Hai Qiang 18");
    expect(small.text).toMatch(/не показаны \d+ позиций — они учтены в ИТОГАХ/);
  });
  it("без модели (процессор): точный список выборки", () => {
    const a = tableAnswer({ items, events: [], question: "Какие задачи у Сухова?", dict, memoItemIds: [], budget: 0, today: TODAY })!;
    expect(a).toMatch(/^По таблице \(ответственный Сухов В\.А\.\) — 2:/);
    expect(tableAnswer({ items, events: [], question: "Перепиши пункт 2", dict, memoItemIds: [], budget: 0, today: TODAY })).toBeNull();
  });
});

describe("защита от мусорного ответа", () => {
  it("ловит «personas, personas…», не трогает нормальный русский", () => {
    expect(looksGarbage("10 personas, 10-20-30 personas, 30-40-50 personas, 40-50-60 personas, 50-60-70 personas, 60-70-80 personas")).toBe(true);
    expect(looksGarbage("В справке 11 пунктов: по Tidebon 801 / 803 — два, по кабелеукладчику — три, по крановому судну — один.")).toBe(false);
  });
  const streamOf = (s: string) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } });
  it("мусор — берём повторный ответ; хороший — отдаём как есть", async () => {
    const bad = await guardStream(streamOf("personas, personas, personas, personas, personas, personas, personas, personas, personas, personas, personas, personas"), async () => streamOf("Нормальный ответ."));
    expect(await new Response(bad).text()).toBe("Нормальный ответ.");
    const good = await guardStream(streamOf("Всего 11 пунктов в пяти разделах."), async () => streamOf("не должен"));
    expect(await new Response(good).text()).toBe("Всего 11 пунктов в пяти разделах.");
  });
});
