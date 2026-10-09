/**
 * Локальная модель ИИ — работает прямо в браузере этого компьютера (llama.cpp на WebAssembly, библиотека wllama),
 * ничего не устанавливается. Файл модели (.gguf) человек выбирает с флешки или общего диска; есть видеокарта — считает она
 * (WebGPU), нет — процессор. Сервер готовит запрос (права, текст справок), ответ считает ПК: справки не уходят в облако.
 *
 * Только для браузера: доступ к файлу (File System Access API) храним в IndexedDB, название модели — в localStorage.
 */
import { cleanVariant, newNumbers } from "@/lib/memo-assist";

export type LocalModelMeta = { name: string; size: number; files: number };
export type LocalPrompt = {
  /** «text» — готовый ответ сервера без модели (мгновенный разбор на процессоре, lib/local-quick.ts). */
  kind: "stream" | "rewrite" | "text";
  text?: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  trimmed?: false | "compact" | "cut";
  original?: string; // для «rewrite»: исходный пункт — проверить, не появились ли новые цифры
  sampling?: { temp: number; top_p: number; min_p: number; penalty_repeat: number; penalty_last_n: number };
  /** Документы пунктов: метки [Д1]… в ответе чат превращает в ссылки (lib/ai-docs.ts). */
  docs?: Array<{ n: number; i: string; f: string; t: string }>;
  /** Позиции таблицы: метки [Т7]… в ответе чат превращает в ссылки (lib/ai-table.ts). */
  items?: Array<{ l: string; i: string; t: string }>;
};

const META_KEY = "operativka.localModel.v1";
const ENGINE_KEY = "ai-engine"; // тот же ключ, что у выбора модели (components/AiModelPicker.tsx)
const DB = "operativka-local-ai";
const STORE = "handles";
/** Окно модели в токенах. 8 тыс. хватает на сжатую справку + вопрос + ответ и не съедает память слабого ПК. */
export const LOCAL_CTX = 8192;

/**
 * Окно под размер модели: веса + кэш внимания должны уместиться в 4 ГБ памяти страницы. Кэш у 4B-модели на 8 тыс.
 * токенов ≈ 1,1 ГБ — с весами 2,3 ГБ это на грани, поэтому для крупных моделей окно меньше (сервер ужимает справку так же).
 */
export function ctxForSize(bytes: number): number {
  if (bytes > 2.5 * 1024 ** 3) return 4096;
  if (bytes > 1.8 * 1024 ** 3) return 6144;
  return LOCAL_CTX;
}
/** Больше ~3 ГБ в память страницы браузера не помещается (у WebAssembly потолок 4 ГБ на всё). */
export const LOCAL_MAX_BYTES = 3.3 * 1024 ** 3;
const CHANGE = "local-model-change";

// ---------- что выбрано ----------

export function localModelMeta(): LocalModelMeta | null {
  try {
    const v = JSON.parse(localStorage.getItem(META_KEY) ?? "null");
    return v && typeof v.name === "string" ? (v as LocalModelMeta) : null;
  } catch {
    return null;
  }
}

/** Выбрана ли в этом браузере локальная модель как модель ИИ. */
export function localEngineActive(): boolean {
  try {
    return localStorage.getItem(ENGINE_KEY) === "local" && !!localModelMeta();
  } catch {
    return false;
  }
}

export function onLocalModelChange(fn: () => void): () => void {
  window.addEventListener(CHANGE, fn);
  return () => window.removeEventListener(CHANGE, fn);
}
const changed = () => window.dispatchEvent(new Event(CHANGE));

/** Можно ли запомнить выбранный файл между входами (Edge, Chrome). В остальных браузерах — выбор на один сеанс. */
export const canRememberFile = () => typeof window !== "undefined" && "showOpenFilePicker" in window;

function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

type Handle = FileSystemFileHandle & { queryPermission?: (o: { mode: "read" }) => Promise<PermissionState>; requestPermission?: (o: { mode: "read" }) => Promise<PermissionState> };
let sessionFiles: File[] | null = null; // выбранные в этом сеансе (и единственный способ без File System Access API)

/** Части большой модели («-00001-of-00003.gguf») — по порядку; первая обязана быть первой. */
export function orderParts<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}

/** Проверка выбора: только .gguf, части одной модели, общий размер — в пределах памяти браузера. */
export function checkModelFiles(files: Array<{ name: string; size: number }>): string | null {
  if (files.length === 0) return "Файл не выбран.";
  if (files.some((f) => !/\.gguf$/i.test(f.name))) return "Нужен файл модели в формате .gguf.";
  const parts = files.filter((f) => /-\d{5}-of-\d{5}\.gguf$/i.test(f.name));
  if (files.length > 1 && parts.length !== files.length) return "Можно выбрать один файл .gguf или все части одной модели («…-00001-of-00003.gguf» и т. д.).";
  if (parts.length) {
    const total = Number(/-of-(\d{5})\.gguf$/i.exec(parts[0].name)![1]);
    if (parts.length !== total) return `Выбрано ${parts.length} из ${total} частей модели — выберите все части сразу.`;
  }
  const size = files.reduce((s, f) => s + f.size, 0);
  if (size > LOCAL_MAX_BYTES) return `Модель ${(size / 1024 ** 3).toFixed(1)} ГБ не поместится в память браузера (до ~3 ГБ). Возьмите модель меньше — например, Qwen3-4B Q4_K_M.`;
  return null;
}

/** Выбрать модель (кнопка в настройках ИИ). Возвращает текст ошибки или null. */
export async function pickLocalModel(): Promise<string | null> {
  let files: File[];
  let handles: FileSystemFileHandle[] | null = null;
  try {
    if (canRememberFile()) {
      const w = window as unknown as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> };
      handles = await w.showOpenFilePicker({ multiple: true, id: "local-model", types: [{ description: "Модель ИИ (.gguf)", accept: { "application/octet-stream": [".gguf"] } }], excludeAcceptAllOption: false });
      files = await Promise.all(handles.map((h) => h.getFile()));
    } else {
      files = await pickWithInput();
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return ""; // передумал — молча
    return "Не удалось открыть файл.";
  }
  if (files.length === 0) return "";
  const err = checkModelFiles(files);
  if (err) return err;
  files = orderParts(files);
  if (handles) {
    const byName = new Map(handles.map((h) => [h.name, h]));
    try {
      await idb("readwrite", (s) => s.put(files.map((f) => byName.get(f.name)!), "model"));
    } catch {
      /* не запомнится между входами — работает в этом сеансе */
    }
  }
  await setModelFiles(files);
  return null;
}

/** Сделать выбранные файлы текущей моделью (без запоминания доступа — это делает pickLocalModel). */
export async function setModelFiles(files: File[]): Promise<void> {
  sessionFiles = orderParts(files);
  await unloadLocalModel();
  const name = sessionFiles[0].name.replace(/(-\d{5}-of-\d{5})?\.gguf$/i, "");
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ name, size: files.reduce((s, f) => s + f.size, 0), files: files.length } satisfies LocalModelMeta));
  } catch {
    /* хранилище закрыто — модель работает до перезагрузки */
  }
  changed();
}

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gguf";
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export async function forgetLocalModel(): Promise<void> {
  sessionFiles = null;
  await unloadLocalModel();
  try {
    localStorage.removeItem(META_KEY);
    if (localStorage.getItem(ENGINE_KEY) === "local") localStorage.setItem(ENGINE_KEY, "auto");
    await idb("readwrite", (s) => s.delete("model"));
  } catch {
    /* нечего чистить */
  }
  window.dispatchEvent(new CustomEvent("ai-engine-change", { detail: "auto" }));
  changed();
}

/** Файлы модели: из этого сеанса или по запомненному доступу (браузер может спросить «Разрешить» — нужен клик человека). */
async function modelFiles(): Promise<File[]> {
  if (sessionFiles) return sessionFiles;
  let handles: Handle[] | undefined;
  try {
    handles = await idb<Handle[] | undefined>("readonly", (s) => s.get("model") as IDBRequest<Handle[] | undefined>);
  } catch {
    /* нет IndexedDB */
  }
  if (!handles?.length) throw new LocalAiError("Файл модели нужно выбрать заново: шестерёнка в окне чата → «Локальная модель» → «Выбрать другую».");
  for (const h of handles) {
    let p = (await h.queryPermission?.({ mode: "read" })) ?? "granted";
    if (p !== "granted") p = (await h.requestPermission?.({ mode: "read" })) ?? "denied";
    if (p !== "granted") throw new LocalAiError("Нет доступа к файлу модели — нажмите «Разрешить», когда браузер спросит.");
  }
  try {
    sessionFiles = await Promise.all(handles.map((h) => h.getFile()));
  } catch {
    throw new LocalAiError("Файл модели не найден — флешка вынута или файл перенесён. Подключите её или выберите файл заново (шестерёнка в окне чата).");
  }
  return sessionFiles;
}

// ---------- запуск модели ----------

export class LocalAiError extends Error {}

type Wllama = import("@wllama/wllama/esm/index.js").Wllama;
let engine: Wllama | null = null;
let loading: Promise<Wllama> | null = null;
let device: "gpu" | "cpu" | null = null;

export function localDevice(): "gpu" | "cpu" | null {
  return device;
}

/** На чём считать: «auto» — видеокарта, только если она отдельная; иначе процессор. */
export type DevicePref = "auto" | "gpu" | "cpu";
const DEVICE_KEY = "operativka.localModel.device.v1";
export function devicePref(): DevicePref {
  try {
    const v = localStorage.getItem(DEVICE_KEY);
    return v === "gpu" || v === "cpu" ? v : "auto";
  } catch {
    return "auto";
  }
}
export async function setDevicePref(p: DevicePref): Promise<void> {
  try {
    localStorage.setItem(DEVICE_KEY, p);
  } catch {
    /* не запомнится */
  }
  await unloadLocalModel(); // следующий вопрос загрузит модель уже на выбранное устройство
  changed();
}

/**
 * Стоит ли считать на видеокарте. Встроенная графика Intel (Iris Xe, UHD) в браузере считает медленнее процессора —
 * замерено на ноутбуке: 2 против 18 токенов/с. Отдельные NVIDIA/AMD (игровые ноутбуки) — быстрее процессора в разы.
 */
let gpuVerdict: Promise<boolean> | null = null;
function gpuWorthIt(): Promise<boolean> {
  return (gpuVerdict ??= detectGpu());
}
async function detectGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: (o: object) => Promise<{ info?: { vendor?: string; architecture?: string; isFallbackAdapter?: boolean } } | null> } }).gpu;
  if (!gpu) return false;
  const a = await gpu.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
  if (!a || a.info?.isFallbackAdapter) return false;
  const vendor = (a.info?.vendor ?? "").toLowerCase();
  const arch = (a.info?.architecture ?? "").toLowerCase();
  if (vendor === "intel") return /hpg|xe2|alchemist|battlemage/.test(arch); // только отдельные Intel Arc
  return vendor === "nvidia" || vendor === "amd";
}

export async function unloadLocalModel(): Promise<void> {
  const e = engine;
  engine = null;
  loading = null;
  device = null;
  await e?.exit().catch(() => undefined);
}

async function getEngine(onStatus?: (s: string | null) => void): Promise<Wllama> {
  if (engine) return engine;
  if (!loading) {
    loading = (async () => {
      const files = await modelFiles();
      onStatus?.("Загружаю модель в память… (только при первом вопросе)");
      const { Wllama } = await import("@wllama/wllama/esm/index.js");
      const create = () => new Wllama({ default: "/wllama/wllama.wasm" }, { suppressNativeLog: true });
      let w = create();
      const pref = devicePref();
      const useGpu = pref === "gpu" || (pref === "auto" && (await gpuWorthIt()));
      const base = { n_ctx: ctxForSize(files.reduce((s, f) => s + f.size, 0)), default_template_kwargs: { enable_thinking: false }, reasoning: false };
      try {
        await w.loadModel(files, useGpu ? base : { ...base, n_gpu_layers: 0 });
      } catch (e) {
        if (!useGpu) {
          await w.exit().catch(() => undefined);
          throw new LocalAiError(`Модель не запустилась: ${(e as Error).message || "не хватает памяти"}. Закройте лишние вкладки или возьмите модель меньше.`);
        }
        // видеокарта не справилась (мало видеопамяти, старый драйвер) — пробуем на процессоре
        await w.exit().catch(() => undefined);
        w = create();
        try {
          await w.loadModel(files, { ...base, n_gpu_layers: 0 });
        } catch {
          throw new LocalAiError(`Модель не запустилась: ${(e as Error).message || "не хватает памяти"}. Закройте лишние вкладки или возьмите модель меньше.`);
        }
        device = "cpu";
        return (engine = w);
      }
      device = useGpu && w.isSupportWebGPU() ? "gpu" : "cpu";
      return (engine = w);
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

const enc = new TextEncoder();

/** Иероглифы, кана, хангыль — маленькие Qwen иногда вставляют их посреди русского текста. */
const CJK = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/g;

// проверки «по-русски» и «по кругу» — общие с облаком (lib/ai-guard.ts)
export { isLooping, looksRussian } from "@/lib/ai-guard";
import { isLooping, looksRussian } from "@/lib/ai-guard";

const NUM = /\d+(?:[.,]\d+)*/g;
/** Числа ответа, которых нет в запросе (справке): номера пунктов [n] и нумерацию списка не считаем. */
export function unknownNumbers(answer: string, prompt: string): string[] {
  const norm = (x: string) => x.replace(",", ".");
  const known = new Set((prompt.match(NUM) ?? []).map(norm));
  const clean = answer.replace(/\[\d+\]/g, " ").replace(/^\s*\d+[.)]\s/gm, " ");
  return [...new Set((clean.match(NUM) ?? []).map(norm))].filter((n) => n.replace(/\D/g, "").length >= 2 && !known.has(n));
}

/**
 * Сгенерировать ответ по готовому запросу сервера; текст идёт потоком. Страховки для маленькой модели:
 * начало ответа (80 знаков) придерживаем — если оно не по-русски, переспрашиваем один раз с напоминанием;
 * иероглифы вырезаем; повтор одной фразы останавливает ответ; числа, которых нет в справке, — пометкой в конце.
 */
export async function localStream(p: LocalPrompt, signal: AbortSignal | undefined, onStatus?: (s: string | null) => void): Promise<ReadableStream<Uint8Array>> {
  const w = await getEngine(onStatus);
  onStatus?.(null);
  const base = [{ role: "system" as const, content: p.system }, ...p.messages];
  const promptText = base.map((m) => m.content).join("\n");
  const sampling = p.sampling ?? { temp: 0.35, top_p: 0.9, min_p: 0.05, penalty_repeat: 1.1, penalty_last_n: 128 };
  return new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let answer = "";
      const run = async (attempt: number): Promise<"ok" | "retry"> => {
        const stop = new AbortController();
        const onOuter = () => stop.abort();
        signal?.addEventListener("abort", onOuter);
        let think = false; // модели с рассуждениями: «<think>…</think>» человеку не показываем
        let head = "";
        let open = false; // начало уже показали
        let verdict: "ok" | "retry" = "ok";
        const messages = attempt === 0 ? base : [...base.slice(0, -1), { ...base[base.length - 1], content: `${base[base.length - 1].content}\n\nВажно: пиши ответ только на русском языке.` }];
        try {
          await w.createChatCompletion({
            messages,
            max_tokens: p.maxTokens,
            ...sampling,
            temperature: attempt === 0 ? sampling.temp : 0.15,
            stream: true,
            abortSignal: stop.signal,
            chat_template_kwargs: { enable_thinking: false },
            onData: (chunk) => {
              let t = chunk.choices[0]?.delta?.content ?? "";
              if (!t || stop.signal.aborted) return;
              if (think || t.includes("<think>")) {
                think = !t.includes("</think>");
                t = think ? "" : t.slice(t.indexOf("</think>") + 8);
              }
              t = t.replace(CJK, "");
              if (!t) return;
              if (!open) {
                head += t;
                if (head.length < 80) return;
                if (attempt === 0 && !looksRussian(head)) {
                  verdict = "retry";
                  stop.abort();
                  return;
                }
                open = true;
                answer += head;
                ctrl.enqueue(enc.encode(head));
                return;
              }
              answer += t;
              ctrl.enqueue(enc.encode(t));
              if (isLooping(answer)) stop.abort();
            },
          });
        } catch (e) {
          if (!stop.signal.aborted) throw e;
        } finally {
          signal?.removeEventListener("abort", onOuter);
        }
        if (signal?.aborted) return "ok";
        if (!open && head) {
          if (attempt === 0 && !looksRussian(head)) return "retry";
          answer += head;
          ctrl.enqueue(enc.encode(head));
        }
        return verdict;
      };
      try {
        if ((await run(0)) === "retry" && !signal?.aborted) await run(1);
        const odd = p.kind === "stream" ? unknownNumbers(answer, promptText) : [];
        if (odd.length && !signal?.aborted) ctrl.enqueue(enc.encode(`\n\nПроверьте: ${odd.slice(0, 5).join(", ")} — этих чисел нет в справке, модель могла ошибиться.`));
        ctrl.close();
      } catch (e) {
        if ((e as Error).name === "AbortError" || signal?.aborted) ctrl.close();
        else ctrl.error(e);
      }
    },
  });
}

/** На чём будет считать модель (до загрузки) — сервер ужимает справку для процессора. */
export async function plannedDevice(): Promise<"gpu" | "cpu"> {
  if (device) return device;
  const pref = devicePref();
  return pref === "gpu" || (pref === "auto" && (await gpuWorthIt())) ? "gpu" : "cpu";
}

/** Короткая проверка из настроек: загрузить модель и ответить одной фразой; возвращает скорость. */
export async function testLocalModel(onStatus: (s: string | null) => void): Promise<{ text: string; wordsPerSec: number; device: "gpu" | "cpu" }> {
  const stream = await localStream({ kind: "stream", system: "Отвечай по-русски, двумя-тремя предложениями.", messages: [{ role: "user", content: "Расскажи, чем ты можешь помочь с оперативкой." }], maxTokens: 120 }, undefined, onStatus);
  // скорость — от первого слова (без подготовки запроса)
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = "";
  let first = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!first) first = performance.now();
    text += dec.decode(value, { stream: true });
  }
  const secs = Math.max(0.1, (performance.now() - (first || performance.now())) / 1000);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { text: text.trim(), wordsPerSec: Math.round((words / secs) * 10) / 10, device: device ?? "cpu" };
}

// ---------- запросы чатов ----------

/**
 * Запрос к ИИ-маршруту: облако как раньше, а при локальной модели — сервер отдаёт готовый запрос (права и текст справок
 * проверены там же), ответ считает браузер. Возвращает такой же Response, как облачный маршрут, — чатам ничего менять не нужно.
 */
export async function aiRequest(url: string, body: Record<string, unknown>, opts: { signal?: AbortSignal; onStatus?: (s: string | null) => void; cloud: () => Promise<Response> }): Promise<Response> {
  if (!localEngineActive()) return opts.cloud();
  // доступ к файлу спрашиваем сразу, пока действует клик человека
  try {
    await modelFiles();
  } catch (e) {
    return errorResponse((e as Error).message);
  }
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, engine: "local", localDevice: await plannedDevice(), localCtx: ctxForSize(localModelMeta()?.size ?? 0) }), signal: opts.signal });
  if (!r.ok) return r;
  const d = (await r.json().catch(() => null)) as { local?: LocalPrompt } | null;
  if (!d?.local) return errorResponse("Сервер не подготовил запрос для локальной модели.");
  const p = d.local;
  const docsHeader: Record<string, string> = {
    ...(p.docs?.length ? { "X-AI-Docs": encodeURIComponent(JSON.stringify(p.docs)) } : {}),
    ...(p.items?.length ? { "X-AI-Items": encodeURIComponent(JSON.stringify(p.items)) } : {}),
  };
  if (p.kind === "text") return new Response(p.text ?? "", { headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI-Model": encodeURIComponent("Мгновенный разбор по данным таблицы"), ...docsHeader } });
  const label = encodeURIComponent(`Локальная · ${localModelMeta()?.name ?? "модель"}`);
  try {
    const stream = await localStream(p, opts.signal, opts.onStatus);
    if (p.kind === "rewrite") {
      const variant = cleanVariant(await new Response(stream).text()).slice(0, 6000);
      if (!variant) return errorResponse("Модель вернула пустой ответ.");
      return Response.json({ text: variant, newNumbers: newNumbers(p.original ?? "", variant) }, { headers: { "X-AI-Model": label } });
    }
    const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", "X-AI-Model": label, ...docsHeader };
    if (p.trimmed) headers["X-AI-Context"] = p.trimmed;
    return new Response(stream, { headers });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    opts.onStatus?.(null);
    return errorResponse(e instanceof LocalAiError ? e.message : `Локальная модель не ответила: ${(e as Error).message}`);
  }
}

function errorResponse(message: string): Response {
  return Response.json({ error: "LOCAL_AI", message }, { status: 400 });
}
