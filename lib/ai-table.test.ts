import { describe, expect, it } from "vitest";
import { applyQuery, cardLine, directAnswer, isListQuestion, itemRefs, journalBlock, labelItems, parseTableQuestion, summaryBlock, tableAnswer, tableContext, wantsJournal, type FactEvent, type FactItem } from "@/lib/ai-table";
import { memoAssistContext } from "@/lib/memo-assist";
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
    // «справку» содержит «правк» — это не вопрос про правки
    expect(wantsJournal("Какие позиции ещё не поданы в справку?")).toBe(false);
    expect(wantsJournal("Кто правил пункт?")).toBe(true);
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
    expect(a).toMatch(/^Точная выборка по таблице \(ответственный Сухов В\.А\.\): 2 из 5 действующих позиций\./);
    expect(tableAnswer({ items, events: [], question: "Перепиши пункт 2", dict, memoItemIds: [], budget: 0, today: TODAY })).toBeNull();
  });
});

describe("прямые ответы программы (облако тоже)", () => {
  const base = { items, events: [] as FactEvent[], dict, memoItemIds: [], budget: 0, today: TODAY };
  it("вопрос-список с условиями — точный список с пунктом справки; «на подумать» — модели", () => {
    const a = directAnswer({ ...base, question: "Какие позиции сейчас в статусе «В работе»?", memoBullets: new Map([[items[2].id, [3]]]) })!;
    expect(a).toContain("3 из 5 действующих позиций");
    expect(a).toContain("«Hai Qiang 18: ТКП ожидается» — Козлов А.С.; В работе; срок 07.10.2026 (просрочен на 2 дн.); подана; в справке: пункт [3]");
    expect(directAnswer({ ...base, question: "Сколько позиций в треке «Кабелеукладчик» и кто по ним ответственный?" })).toContain("По ответственным: Сухов В.А. — 2; Козлов А.С. — 1");
    expect(directAnswer({ ...base, question: "Что горит и где нужно вмешательство?" })).toBeNull();
    expect(directAnswer({ ...base, question: "Перепиши пункт про Hai Qiang короче" })).toBeNull();
    expect(isListQuestion("Что у нас в сегменте «Строительный флот»?")).toBe(true);
    expect(isListQuestion("Почему сорван срок?")).toBe(false);
    expect(isListQuestion("Сколько стоит покупка Tidebon 801?")).toBe(false); // стоимость — не список (экзамен, N1)
  });
  it("«кто отвечает за …» — по предмету в названиях, сначала где предмет в начале", () => {
    const extra = [...items, item({ title: "Командировка: осмотр Hai Qiang 18 и деккеров", owner: "Сухов В.А.", status: "В работе" })];
    const a = directAnswer({ ...base, items: extra, question: "Кто отвечает за позицию по судну Hai Qiang 18?" })!;
    expect(a).toMatch(/^Позиции, где упоминается предмет вопроса \(2\):\n\[Т\d+\] «Hai Qiang 18: ТКП ожидается» — ответственный: Козлов А\.С\./);
    expect(directAnswer({ ...base, question: "Кто отвечает за дирижабль?" })).toBeNull();
  });
  it("журнал: «кто сегодня подавал» — по людям, без повторов; период и человек", () => {
    const now = new Date(Date.UTC(2026, 9, 9, 12));
    const ev = (itemId: string, h: number, who: string, action: string, after: string | null = null): FactEvent => ({ itemId, at: new Date(Date.UTC(2026, 9, 9, h)), who, action, field: null, before: null, after });
    const events = [
      ev(items[0].id, 6, "Майков Т.Г.", "OPER_FLAG_CHANGE", "true"),
      ev(items[1].id, 6, "Майков Т.Г.", "OPER_FLAG_CHANGE", "true"),
      ev(items[0].id, 7, "Майков Т.Г.", "OPER_FLAG_CHANGE", "true"),
      ev(items[3].id, 8, "Сухов В.А.", "OPER_FLAG_CHANGE", "true"),
      { ...ev(items[2].id, 9, "Майков Т.Г.", "CREATE"), at: new Date(Date.UTC(2026, 9, 1)) },
    ];
    const a = directAnswer({ ...base, events, question: "Кто сегодня подавал позиции в справку?", now })!;
    expect(a).toMatch(/^По журналу правок сегодня \(подал в справку\):/);
    expect(a).toContain("Майков Т.Г.:\n  подал в справку — 2:");
    expect(a).toContain("Сухов В.А.:\n  подал в справку — 1:");
    expect(directAnswer({ ...base, events, question: "Что создал Майков за неделю?", now })).toMatch(/изменений нет|никто не/);
    expect(directAnswer({ ...base, events, question: "Что изменилось за последнюю неделю?", now })).toContain("По журналу правок за 7 дней:");
  });
});

describe("ссылки [Т…] и итоги по справке", () => {
  it("метки для ссылок — сначала выборка по вопросу, коротко", () => {
    const refs = itemRefs({ items, events: [], question: "Что просрочено?", dict, memoItemIds: [], today: TODAY }, 3);
    expect(refs).toHaveLength(3);
    expect(refs[0].t).toBe("Hai Qiang 18: ТКП ожидае"); // 24 знака
    expect(refs[0].l).toMatch(/^Т\d+$/);
  });
  it("справка: число пунктов, новые подачи и кто правил — считает программа; пункт ← позиция", () => {
    const b = (id: string, text: string, extra: object = {}) => ({ id, text, itemIds: [id], origin: "auto" as const, edited: false, hidden: false, sourceHash: "", ...extra });
    const ctx = memoAssistContext({ sections: [{ id: "s", title: "Раздел", kind: "section", bullets: [b("i1", "Первый", { fresh: true }), b("i2", "Второй", { changedBy: "Сухов В.А." }), b("i3", "Скрытый", { hidden: true })] }] }, "Справка", {}, [], (id) => ({ i1: "Т1", i2: "Т2" })[id]);
    expect(ctx.text).toContain("пунктов 2 в 1 разделах («Раздел» — 2); новые подачи (добавлены автоматически) — 1: [1]; текст пункта правили вручную — [2] — Сухов В.А.");
    expect(ctx.text).toContain("[2] Второй ← [Т2] {текст пункта в справке правил: Сухов В.А.}");
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
