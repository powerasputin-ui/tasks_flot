/**
 * Выбор файла с общего диска через окно выбора файла Windows (File System Access API: Chrome, Edge, Яндекс Браузер).
 *
 * Браузер никогда не отдаёт полный путь выбранного файла. Поэтому один раз на компьютере человек выбирает «корневую»
 * папку общего диска и называет её настоящий путь в Windows (например \\10.10.51.51\флот). Дальше окно выбора файла
 * открывается сразу в этой папке, а полный путь собирается как «путь корня + положение файла внутри корня»
 * (FileSystemDirectoryHandle.resolve). Сами файлы не читаются и никуда не отправляются.
 *
 * Только для клиента: функции вызываются из обработчиков кликов.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any;
type FileHandle = any;

export type RootInfo = { handle: DirHandle; path: string };

const DB_NAME = "gshp-files";
const STORE = "roots";
const KEY = "shared-disk";

/** Работает ли выбор файла из окна Windows в этом браузере (нужен HTTPS и браузер на Chromium). */
export function fsSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "showOpenFilePicker" in window && "showDirectoryPicker" in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => resolve((r.result as T) ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      if (value === null) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export const loadRoot = () => idbGet<RootInfo>(KEY);
export const saveRoot = (r: RootInfo) => idbSet(KEY, r);
export const clearRoot = () => idbSet(KEY, null);

/** Окно выбора папки: «корень» общего диска. null — человек закрыл окно. */
export async function pickRootFolder(): Promise<DirHandle | null> {
  try {
    return await (window as any).showDirectoryPicker({ id: "gshp-disk", mode: "read" });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return null;
    throw e;
  }
}

/** Если выбрана папка-диск («Z:\»), её путь известен сразу; для сетевых папок человек впишет путь сам. */
export function guessRootPath(folderName: string): string {
  return /^[A-Za-z]:\\?$/.test(folderName) ? `${folderName[0].toUpperCase()}:\\` : "";
}

/** «Путь корня» + положение файла внутри корня → путь Windows. */
export function joinWinPath(base: string, rel: string[]): string {
  const root = base.trim().replace(/[\\/]+$/, "");
  return [root, ...rel].join("\\");
}

export type PickResult = { ok: true; paths: string[] } | { ok: false; cancelled?: boolean; error?: string };

/** Окно выбора файлов (можно несколько) — открывается сразу в корневой папке; результат — полные пути. */
export async function pickDocuments(root: RootInfo): Promise<PickResult> {
  try {
    // права на сохранённую папку после перезапуска браузера «спят» — просим заново (одно нажатие «Разрешить»)
    if (root.handle.queryPermission && (await root.handle.queryPermission({ mode: "read" })) !== "granted") {
      await root.handle.requestPermission?.({ mode: "read" });
    }
    const handles: FileHandle[] = await (window as any).showOpenFilePicker({ id: "gshp-docs", startIn: root.handle, multiple: true });
    const paths: string[] = [];
    const outside: string[] = [];
    for (const h of handles) {
      const rel: string[] | null = await root.handle.resolve(h);
      if (!rel) outside.push(h.name);
      else paths.push(joinWinPath(root.path, rel));
    }
    if (outside.length && paths.length === 0) {
      return { ok: false, error: `Файл «${outside[0]}» лежит не внутри выбранной папки диска. Выберите файл из неё или смените папку диска.` };
    }
    return { ok: true, paths };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { ok: false, cancelled: true };
    return { ok: false, error: "Не удалось открыть окно выбора файла. Можно вставить путь вручную." };
  }
}
