import { visibleSections, type MemoDoc } from "@/lib/memo";

/**
 * Документы пунктов справки для ИИ-помощников. К позиции прикрепляют ссылки на файлы общего диска (lib/item-files.ts);
 * сайт сами файлы не видит, поэтому модель знает только название и путь — и на вопросы «где документ», «что приложено»
 * отвечает ими, ставя метку [Д1]. Чат превращает метку в ссылку-ярлык (как скрепка в справке), содержимое не пересказывается.
 * Права — как в интерфейсе: документы видят те, кому доступна таблица (директор, админ, составитель), не ЗГД.
 */

export type DocFile = { id: string; name: string; path: string };
export type AiDoc = { n: number; itemId: string; fileId: string; name: string; path: string; itemTitle: string };
/** Для чата (заголовок X-AI-Docs): коротко, без путей — путь модель и так пишет в ответе. */
export type AiDocRef = { n: number; i: string; f: string; t: string };

/** Документы по порядку пунктов справки (метки [Д1], [Д2]… одинаковые для блока и для пометок у пунктов). */
export function collectDocs(docs: MemoDoc[], filesByItem: Map<string, { title: string; files: DocFile[] }>, limit = 30): AiDoc[] {
  const out: AiDoc[] = [];
  const seen = new Set<string>();
  for (const doc of docs)
    for (const s of visibleSections(doc))
      for (const b of s.bullets)
        for (const itemId of b.itemIds) {
          const src = filesByItem.get(itemId);
          for (const f of src?.files ?? []) {
            const key = `${itemId}:${f.id}`;
            if (seen.has(key) || out.length >= limit) continue;
            seen.add(key);
            out.push({ n: out.length + 1, itemId, fileId: f.id, name: f.name, path: f.path, itemTitle: src!.title });
          }
        }
  return out;
}

/** Пометка у пункта: «документы: [Д1] «Презентация.pptx», [Д2] …». */
export function docMarks(itemIds: string[], docs: AiDoc[]): string {
  const mine = docs.filter((d) => itemIds.includes(d.itemId));
  return mine.length ? `документы: ${mine.map((d) => `[Д${d.n}] «${d.name}»`).join(", ")}` : "";
}

/** Блок «ДОКУМЕНТЫ» — название, путь и к какой позиции относится. */
export function docsBlock(docs: AiDoc[], maxChars = 4000): string {
  if (!docs.length) return "";
  const lines = ["ДОКУМЕНТЫ, прикреплённые к пунктам (ссылки на файлы общего диска; содержимое файлов тебе не видно):"];
  let used = lines[0].length;
  for (const d of docs) {
    const line = `[Д${d.n}] «${d.name}» — путь: ${d.path} — позиция «${d.itemTitle.length > 90 ? `${d.itemTitle.slice(0, 90)}…` : d.itemTitle}»`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export const DOCS_RULE =
  "Если у пункта есть документы (блок «ДОКУМЕНТЫ», метки [Д1]…): на вопросы, где посмотреть подробности, что приложено, где лежит файл — " +
  "называй документ, его путь и метку [Д1] (в чате метка станет ссылкой, по которой файл откроется). Содержимое файлов тебе не видно — не пересказывай и не додумывай его, предложи открыть документ.";

/** Вопрос про документы («какие документы приложены», «где презентация», «есть ли файл по …»). */
export function isDocsQuestion(question: string): boolean {
  return /(документ|файл|презентац|приложен|прикреплен|прикреплён|вложен|ссылк|где лежит|где посмотреть)/i.test(question);
}

/** Ответ без модели (процессор): документы справки, а если в вопросе есть слова из названия — сначала подходящие. */
export function docsAnswer(question: string, docs: AiDoc[]): string {
  if (!docs.length) return "К пунктам этой справки документы не прикреплены.";
  const words = (question.toLowerCase().match(/[а-яёa-z0-9]{4,}/g) ?? []).map((w) => w.slice(0, 5));
  const fits = (d: AiDoc) => words.some((w) => `${d.name} ${d.itemTitle}`.toLowerCase().includes(w));
  const ordered = [...docs.filter(fits), ...docs.filter((d) => !fits(d))];
  return `Документы к пунктам справки (нажмите на название, чтобы открыть):\n${ordered.map((d) => `[Д${d.n}] «${d.name}» — позиция «${d.itemTitle}»\n   путь: ${d.path}`).join("\n")}`;
}

export const docRefs =(docs: AiDoc[]): AiDocRef[] => docs.map((d) => ({ n: d.n, i: d.itemId, f: d.fileId, t: d.name.slice(0, 120) }));

/** Ссылка, по которой браузер скачает ярлык на файл (тот же маршрут, что у скрепки в справке и таблице). */
export const docHref = (r: Pick<AiDocRef, "i" | "f">) => `/api/items/${r.i}/files/${r.f}/shortcut`;
