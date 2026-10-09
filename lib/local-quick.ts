import { analyzeMemos, mskToday, routeTask, type Audience, type BulletFacts, type LocalMemo } from "@/lib/local-ai-prompt";

/**
 * Мгновенный разбор справки без модели — для локального ИИ на процессоре (офисные ноутбуки).
 * Замер на Core i7-1260P / 16 ГБ / встроенная графика: модель 1,5 млрд читает запрос ~8 токенов/с, т. е. разбор всей
 * справки — 4–9 минут до первого слова, а 0,5 млрд на такой задаче отвечает бессмысленно. Типовые вопросы (быстрые кнопки)
 * при этом сводятся к фактам, которые код и так считает точно: сроки, пустые формулировки, зависимости, дубли.
 * Поэтому на процессоре ответ на них собирается из разбора (lib/local-ai-prompt.ts) за доли секунды, а модель
 * остаётся для переписывания пункта и свободных вопросов. На видеокарте те же факты получает модель и формулирует сама.
 */

const MAX = 8;
const short = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n).trimEnd()}…` : t);
const quote = (f: BulletFacts) => `[${f.n}] «${short(f.text)}»`;

/** Что не так с пунктом — человеческими словами. */
function problems(f: BulletFacts): string[] {
  const p: string[] = [];
  if (f.overdue) p.push(`срок ${f.overdue.date} просрочен на ${f.overdue.days} дн.`);
  if (f.vague) p.push("нет результата — описан только процесс");
  if (f.depends) p.push(`зависит от внешнего: «${f.depends}»`);
  if (f.noOwner) p.push("не указан ответственный");
  if (f.noDeadline && !f.overdue) p.push("нет срока");
  if (f.similarTo) p.push(`повторяет пункт [${f.similarTo}]`);
  return p;
}

/** Что уточнить у дирекции по пункту. */
function asks(f: BulletFacts): string[] {
  const a: string[] = [];
  if (f.overdue) a.push("причину сдвига и новый срок");
  if (f.vague) a.push("что фактически сделано и какой результат");
  if (f.depends) a.push(`когда ожидается «${f.depends}» и кто это ускоряет`);
  if (f.noOwner) a.push("кто отвечает");
  if (f.noDeadline && !f.overdue) a.push("срок");
  if (f.similarTo) a.push(`не дублирует ли пункт [${f.similarTo}]`);
  return a;
}

const riskScore = (f: BulletFacts) => (f.overdue ? 4 + Math.min(3, Math.floor(f.overdue.days / 7)) : 0) + (f.depends ? 2 : 0) + (f.vague ? 2 : 0) + (f.noOwner ? 1 : 0) + (f.similarTo ? 1 : 0) + (f.attention ? 1 : 0) + (f.noDeadline ? 1 : 0);
const byRisk = (facts: BulletFacts[]) => facts.filter((f) => riskScore(f) > 0).sort((a, b) => riskScore(b) - riskScore(a) || a.n - b.n);
const owner = (f: BulletFacts) => (f.owner ? ` (отв. ${f.owner})` : "");
const more = (list: unknown[], shown: number) => (list.length > shown ? `\n…и ещё ${list.length - shown}.` : "");
const done = (f: BulletFacts) => f.status === "Завершено" || (!f.vague && /(выполнен|заверш|подписан|получен|утвержд|сдан|оплачен|поставлен|запущен|принят|заключ[её]н|введ[её]н)/i.test(f.text));

/** Сокращения, которых нет в словаре справок, — руководству может быть непонятно. */
const KNOWN = new Set(["ГД", "ЗГД", "ОС", "ТЗ", "РФ", "ООО", "АО", "ПАО", "НДС", "СМП"]);
// \b в JS не работает с кириллицей — границы слова через просмотр «не буква»
const acronyms = (t: string) => [...new Set(t.match(/(?<![А-ЯЁа-яё])[А-ЯЁ]{2,6}(?![А-ЯЁа-яё])/g) ?? [])].filter((x) => !KNOWN.has(x));

function deadlines(facts: BulletFacts[]): string {
  const late = facts.filter((f) => f.overdue).sort((a, b) => b.overdue!.days - a.overdue!.days);
  const soon = facts.filter((f) => f.soon).sort((a, b) => a.soon!.days - b.soon!.days);
  const none = facts.filter((f) => f.noDeadline);
  const block = (title: string, list: BulletFacts[], line: (f: BulletFacts) => string) =>
    `${title}${list.length ? "\n" + list.slice(0, MAX).map((f, i) => `${i + 1}. ${line(f)}`).join("\n") + more(list, MAX) : " нет."}`;
  return [
    block("Просрочено:", late, (f) => `${quote(f)} — срок ${f.overdue!.date}, просрочен на ${f.overdue!.days} дн.${owner(f)}`),
    block("Скоро срок (7 дней):", soon, (f) => `${quote(f)} — ${f.soon!.days === 0 ? "сегодня" : `через ${f.soon!.days} дн.`}, ${f.soon!.date}${owner(f)}`),
    block("Без срока:", none, (f) => `${quote(f)}${owner(f)}`),
  ].join("\n\n");
}

function risks(facts: BulletFacts[]): string {
  const list = byRisk(facts);
  if (!list.length) return "Слабых мест по данным таблицы не видно: сроки соблюдены, у пунктов есть результат и ответственные.";
  return "Слабые места (сначала самое серьёзное):\n" + list.slice(0, MAX).map((f, i) => `${i + 1}. ${quote(f)} — ${problems(f).join("; ")}. Уточнить: ${asks(f).join(", ")}.`).join("\n") + more(list, MAX);
}

function intervene(facts: BulletFacts[]): string {
  const list = facts
    .filter((f) => (f.overdue && (f.overdue.days >= 7 || f.depends || f.vague)) || (f.depends && (f.vague || f.soon)) || (f.attention && (f.overdue || f.vague || f.noDeadline)))
    .sort((a, b) => riskScore(b) - riskScore(a));
  if (!list.length) return "Явных поводов вмешаться по данным таблицы нет: серьёзных просрочек и зависших зависимостей не видно.";
  const action = (f: BulletFacts) =>
    f.depends && /(решени|гд|руководств|финансир|бюджет)/i.test(f.depends) ? `ускорить решение («${f.depends}»)` : f.depends ? `поторопить «${f.depends}» через руководство` : f.overdue ? `запросить у ответственного новый срок и план` : "запросить результат";
  return "Где стоит вмешаться:\n" + list.slice(0, 6).map((f, i) => `${i + 1}. ${quote(f)} — ${problems(f).join("; ")}. Что сделать: ${action(f)}${owner(f)}.`).join("\n") + more(list, 6);
}

function questions(facts: BulletFacts[], lead?: "director"): string {
  const ranked = byRisk(facts);
  // дубль уже спрошенного пункта не повторяем
  const list = ranked.filter((f) => !f.similarTo || !ranked.some((o) => o.n === f.similarTo)).slice(0, 7);
  if (!list.length) return "Острых вопросов по данным таблицы нет. Можно уточнить планы на следующую неделю.";
  const q = (f: BulletFacts) => {
    const t = `«${short(f.text, 60)}»`;
    if (f.overdue) return `Почему сорван срок ${f.overdue.date} по ${t} и какой новый срок?`;
    if (f.depends) return `Когда ожидается «${f.depends}» по ${t} и что делается, чтобы ускорить?`;
    if (f.vague) return `Что конкретно сделано по ${t} и какой результат?`;
    if (f.noOwner) return `Кто отвечает за ${t}?`;
    if (f.noDeadline) return `Какой срок по ${t}?`;
    return `Не дублирует ли ${t} пункт [${f.similarTo}]?`;
  };
  return (lead === "director" ? "Что могут спросить по справке (подготовьте ответы):\n" : "Вопросы директору:\n") + list.map((f, i) => `${i + 1}. [${f.n}] ${q(f)}`).join("\n");
}

function summary(facts: BulletFacts[], memos: LocalMemo[]): string {
  const finished = facts.filter(done);
  const risky = byRisk(facts).slice(0, 5);
  const sections = [...new Set(facts.map((f) => f.section))];
  const lines = [
    `${memos.length > 1 ? `${memos.length} справки, ` : ""}${facts.length} пунктов в ${sections.length} разделах: ${sections.join(", ")}.`,
    `Просрочено: ${facts.filter((f) => f.overdue).length}, скоро срок: ${facts.filter((f) => f.soon).length}, без срока: ${facts.filter((f) => f.noDeadline).length}, без результата: ${facts.filter((f) => f.vague).length}.`,
    "",
    finished.length ? "Сделано:\n" + finished.slice(0, 6).map((f, i) => `${i + 1}. ${quote(f)}`).join("\n") + more(finished, 6) : "Завершённых пунктов нет.",
    "",
    risky.length ? "На что обратить внимание:\n" + risky.map((f, i) => `${i + 1}. ${quote(f)} — ${problems(f).join("; ")}.`).join("\n") : "Поводов для беспокойства по данным таблицы нет.",
  ];
  return lines.join("\n");
}

function weak(facts: BulletFacts[]): string {
  const list = facts.filter((f) => f.vague || f.long || f.short || f.noDeadline || f.similarTo);
  if (!list.length) return "Формулировки в порядке: у пунктов есть результат и срок, повторов и слишком длинных пунктов нет.";
  const fix = (f: BulletFacts) => {
    const x: string[] = [];
    if (f.vague) x.push("пустая формулировка → напишите, что сделано и какой результат");
    if (f.noDeadline) x.push("нет срока → укажите срок");
    if (f.long) x.push(`длинный (${f.text.length} знаков) → сократите до 1–2 предложений: что сделано → результат → срок`);
    if (f.short) x.push("слишком короткий → добавьте статус и следующий шаг");
    if (f.similarTo) x.push(`повторяет [${f.similarTo}] → объедините`);
    return x.join("; ");
  };
  return "Что поправить в формулировках:\n" + list.slice(0, MAX).map((f, i) => `${i + 1}. ${quote(f)} — ${fix(f)}.`).join("\n") + more(list, MAX) + "\n\nГотовый вариант текста: наведите на пункт и нажмите «Переписать» (искры) — модель предложит формулировку.";
}

function leaders(facts: BulletFacts[]): string {
  const items = facts
    .map((f) => {
      const x: string[] = [];
      const ac = acronyms(f.text);
      if (ac.length) x.push(`сокращения без расшифровки: ${ac.join(", ")}`);
      if (f.vague) x.push("непонятно, что сделано и какой результат");
      if (f.long) x.push("слишком длинно");
      if (f.noDeadline) x.push("не ясно, когда будет готово");
      return { f, x };
    })
    .filter((r) => r.x.length);
  if (!items.length) return "Руководству всё должно быть понятно: сокращения известные, у пунктов есть результат и сроки.";
  return "Что может быть непонятно руководству:\n" + items.slice(0, MAX).map((r, i) => `${i + 1}. ${quote(r.f)} — ${r.x.join("; ")}.`).join("\n") + more(items, MAX);
}

/**
 * Готовый ответ без модели, если вопрос — из типовых. null — вопрос свободный (или про конкретный пункт / стиль): нужен ИИ.
 */
export function quickAnswer(opts: { audience: Audience; memos: LocalMemo[]; question: string; today?: number; lead?: "director" }): string | null {
  const { task } = routeTask(opts.question, opts.audience);
  const facts = analyzeMemos(opts.memos, opts.today ?? mskToday());
  if (!facts.length) return "В справке пока нет пунктов.";
  switch (task) {
    case "deadlines":
      return deadlines(facts);
    case "risks":
      return risks(facts);
    case "intervene":
      return intervene(facts);
    case "questions":
      return questions(facts, opts.lead);
    case "summary":
      return summary(facts, opts.memos);
    case "weak":
      return weak(facts);
    case "leaders":
      return leaders(facts);
    default:
      return null;
  }
}
