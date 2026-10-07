/**
 * Файлы позиции — это ССЫЛКИ на файлы на общем диске (или веб-ссылки), сами файлы на сайт не грузятся.
 * Чистые функции без базы: используются и на сервере (проверка, ярлык .url), и в форме (разбор вставленного пути).
 */
export type ItemFile = { id: string; path: string; name: string };

export const MAX_FILES = 10;
export const MAX_PATH = 500;

/** Файлы, которые нельзя прикрепить: по ярлыку их можно случайно запустить, а не открыть. */
const BLOCKED_EXT = new Set([
  "exe", "com", "bat", "cmd", "scr", "msi", "msp", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "lnk", "url", "reg", "dll", "jar", "cpl", "gadget", "inf", "sct", "scf",
]);

export type ParsedPath =
  | { ok: true; path: string; name: string; ext: string; folder: string; kind: "unc" | "drive" | "web" | "folder" }
  | { ok: false; error: string };

/** Что вставил человек → аккуратный путь: убираем кавычки/пробелы, `file://` превращаем в обычный путь. */
function clean(raw: string): string {
  let s = raw.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  while (/^["'«»“”`]/.test(s) && /["'«»“”`]$/.test(s) && s.length > 1) s = s.slice(1, -1).trim();
  s = s.replace(/^["'«»“”`]+|["'«»“”`]+$/g, "").trim();
  const m = /^file:\/\/(\/?)(.*)$/i.exec(s);
  if (m) {
    const rest = safeDecode(m[2]).replace(/\//g, "\\");
    s = m[1] ? rest : `\\\\${rest}`; // file:///C:/x → C:\x ; file://srv/x → \\srv\x
  }
  return s;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseFilePath(raw: string): ParsedPath {
  const path = clean(raw);
  if (!path) return { ok: false, error: "Вставьте путь к файлу." };
  if (path.length > MAX_PATH) return { ok: false, error: `Путь слишком длинный — максимум ${MAX_PATH} символов.` };

  if (/^https?:\/\//i.test(path)) {
    let u: URL;
    try {
      u = new URL(path);
    } catch {
      return { ok: false, error: "Не получилось разобрать ссылку — проверьте, что она скопирована полностью." };
    }
    if (u.username || u.password) return { ok: false, error: "В ссылке не должно быть логина и пароля." };
    const last = safeDecode(u.pathname.split("/").filter(Boolean).pop() ?? "") || u.hostname;
    const ext = extOf(last);
    if (BLOCKED_EXT.has(ext)) return { ok: false, error: blockedMessage(ext) };
    return { ok: true, path: u.toString(), name: last, ext, folder: u.hostname, kind: "web" };
  }

  const unc = /^\\\\[^\\/]+\\[^\\/]+/.test(path);
  const drive = /^[a-zA-Z]:[\\/]/.test(path);
  if (!unc && !drive) {
    return { ok: false, error: "Это не путь к файлу. Нужен путь вида \\\\сервер\\папка\\файл.xlsx, D:\\папка\\файл.docx или ссылка https://…" };
  }
  if (/[<>"|?*]/.test(path)) return { ok: false, error: "В пути есть недопустимые для Windows символы (< > \" | ? *)." };

  const normalized = path.replace(/\//g, "\\");
  const isFolderEnd = normalized.endsWith("\\");
  const parts = normalized.split("\\").filter(Boolean);
  const name = parts[parts.length - 1] ?? "";
  if (!name || (drive && parts.length === 1)) return { ok: false, error: "Укажите путь до файла или папки, а не только диск." };
  const ext = isFolderEnd ? "" : extOf(name);
  if (BLOCKED_EXT.has(ext)) return { ok: false, error: blockedMessage(ext) };
  const folder = normalized.slice(0, normalized.length - name.length - (isFolderEnd ? 1 : 0)).replace(/\\+$/, "");
  return { ok: true, path: isFolderEnd ? normalized.slice(0, -1) : normalized, name, ext, folder, kind: ext === "" && isFolderEnd ? "folder" : unc ? "unc" : "drive" };
}

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})\s*$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function blockedMessage(ext: string): string {
  return `Файлы типа .${ext} прикреплять нельзя: по ярлыку их могут случайно запустить. Положите такой файл в архив или укажите папку.`;
}

/** Проверка списка целиком: каждый путь, без повторов, не больше MAX_FILES; у новых файлов id делает вызывающий (makeId). */
export function normalizeFiles(
  input: Array<{ id?: string; path: string }>,
  existing: ItemFile[],
  makeId: () => string
): { ok: true; files: ItemFile[] } | { ok: false; error: string } {
  if (input.length > MAX_FILES) return { ok: false, error: `Можно прикрепить не больше ${MAX_FILES} файлов.` };
  const seen = new Set<string>();
  const out: ItemFile[] = [];
  for (const f of input) {
    const p = parseFilePath(f.path);
    if (!p.ok) return { ok: false, error: p.error };
    const key = p.path.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Файл «${p.name}» добавлен дважды.` };
    seen.add(key);
    const prev = f.id ? existing.find((e) => e.id === f.id) : undefined;
    out.push({ id: prev ? prev.id : makeId(), path: p.path, name: p.name });
  }
  return { ok: true, files: out };
}

/** Из JSON базы → список файлов (мусор и старые строки без пути отбрасываем). */
export function readFiles(value: unknown): ItemFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    const o = v as Partial<ItemFile> | null;
    return o && typeof o.id === "string" && typeof o.path === "string" && typeof o.name === "string" ? [{ id: o.id, path: o.path, name: o.name }] : [];
  });
}

/** Для журнала правок: список имён через «; ». */
export function filesText(value: unknown): string | null {
  const names = readFiles(value).map((f) => f.name);
  return names.length ? names.join("; ") : null;
}

/** Значок формата вместо превью (содержимое сетевого диска сайт не видит). */
export function fileBadge(ext: string, kind?: string): { label: string; color: string } {
  if (kind === "web") return { label: "WEB", color: "#0EA5E9" };
  if (kind === "folder" || (!ext && kind !== "web")) return { label: "ПАПКА", color: "#64748B" };
  const by: Array<[string[], string, string]> = [
    [["ppt", "pptx", "pps", "ppsx", "odp"], "PPT", "#D24726"],
    [["xls", "xlsx", "xlsm", "xlsb", "csv", "ods"], "XLS", "#1D6F42"],
    [["doc", "docx", "docm", "rtf", "odt", "txt"], "DOC", "#2B579A"],
    [["pdf"], "PDF", "#E2231A"],
    [["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "svg", "webp"], "IMG", "#7C3AED"],
    [["zip", "rar", "7z", "gz", "tar"], "ZIP", "#A16207"],
    [["dwg", "dxf", "dgn"], "CAD", "#0E7490"],
    [["msg", "eml"], "MAIL", "#0369A1"],
    [["mp4", "avi", "mov", "mkv", "mp3", "wav"], "MEDIA", "#BE185D"],
    [["vsd", "vsdx"], "VSD", "#3955A3"],
    [["mpp"], "MPP", "#31752F"],
  ];
  const hit = by.find(([exts]) => exts.includes(ext));
  if (hit) return { label: hit[1], color: hit[2] };
  return { label: ext ? ext.toUpperCase().slice(0, 5) : "ФАЙЛ", color: "#64748B" };
}

/**
 * Текст ярлыка Windows (.url): двойной щелчок открывает файл в программе по умолчанию.
 * Путь пишем «как есть» (кириллица, пробелы): проводник не раскодирует %-коды кириллицы, поэтому файл отдаётся в UTF-16
 * (см. shortcutBytes). Проверено на Windows: так открываются и пути с кириллицей, пробелами, скобками и «#».
 */
export function buildShortcut(path: string): string {
  let url = path;
  if (!/^https?:\/\//i.test(path)) {
    const parts = path.split("\\").filter(Boolean);
    url = /^[a-zA-Z]:/.test(path) ? `file:///${parts.join("/")}` : `file://${parts.join("/")}`;
  }
  return `[InternetShortcut]\r\nURL=${url}\r\n`;
}

/** Файл ярлыка целиком: UTF-16 LE с BOM — единственная кодировка .url, в которой кириллица в пути открывается надёжно. */
export function shortcutBytes(path: string): Uint8Array {
  const text = Buffer.from(buildShortcut(path), "utf16le");
  return Buffer.concat([Buffer.from([0xff, 0xfe]), text]);
}
