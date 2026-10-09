/**
 * Страховки ответа ИИ — общие для облака (сервер) и локальной модели (браузер, lib/local-ai.ts).
 * Экзамен поймал у облачной модели ответ-мусор («10 personas, 10-20-30 personas…» за 43 с): начало ответа проверяем,
 * мусор отбрасываем и спрашиваем ещё раз (у облака — запасную модель).
 */

/** Русский ли текст: среди букв ≥ 60 % кириллицы (латиница бывает в названиях судов и аббревиатурах). */
export function looksRussian(text: string): boolean {
  const letters = text.match(/[A-Za-zА-Яа-яЁё]/g) ?? [];
  if (letters.length < 12) return true;
  return letters.filter((c) => /[А-Яа-яЁё]/.test(c)).length / letters.length >= 0.6;
}

/** Модель пошла по кругу: одна и та же фраза (от 20 знаков) уже трижды. */
export function isLooping(text: string): boolean {
  const seen = new Map<string, number>();
  for (const raw of text.split(/[.!?\n]+/)) {
    const k = raw.trim().toLowerCase();
    if (k.length < 20) continue;
    const c = (seen.get(k) ?? 0) + 1;
    if (c >= 3) return true;
    seen.set(k, c);
  }
  return false;
}

/** Мусор в начале ответа: не по-русски, по кругу, или одно слово повторяется через запятую («personas, personas…»). */
export function looksGarbage(head: string): boolean {
  if (!looksRussian(head) || isLooping(head)) return true;
  const counts = new Map<string, number>();
  for (const w of head.toLowerCase().match(/[a-zа-яё]{5,}/g) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  const words = [...counts.values()].reduce((s, v) => s + v, 0);
  return words >= 12 && Math.max(0, ...counts.values()) / words > 0.4;
}

/** Неразрывные и узкие пробелы → обычные. Модель ставит их внутри путей к файлам (экзамен, D1) — скопированный путь не открывается. */
export const PLAIN_SPACES = /[    ]/g;
export const plainText = (s: string) => s.replace(PLAIN_SPACES, " ");

function plainSpaces(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  return stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream<string, string>({ transform: (chunk, ctrl) => ctrl.enqueue(plainText(chunk)) }))
    .pipeThrough(new TextEncoderStream());
}

/**
 * Поток ответа с проверкой начала: копим первые headChars знаков; мусор — отменяем и берём поток из retry().
 * Хорошее начало отдаётся сразу целиком, дальше поток идёт как есть.
 */
export async function guardStream(stream: ReadableStream<Uint8Array>, retry: () => Promise<ReadableStream<Uint8Array>>, headChars = 240): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let head = "";
  let done = false;
  while (head.length < headChars) {
    const r = await reader.read();
    if (r.done) {
      done = true;
      break;
    }
    chunks.push(r.value);
    head += dec.decode(r.value, { stream: true });
  }
  if (head.trim() && looksGarbage(head)) {
    await reader.cancel().catch(() => undefined);
    return plainSpaces(await retry());
  }
  return plainSpaces(new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(c);
      if (done) ctrl.close();
    },
    async pull(ctrl) {
      if (done) return;
      const r = await reader.read();
      if (r.done) {
        done = true;
        ctrl.close();
      } else ctrl.enqueue(r.value);
    },
    cancel() {
      return reader.cancel();
    },
  }));
}
