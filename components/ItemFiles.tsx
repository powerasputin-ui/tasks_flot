"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, ExternalLink, FolderCog, Info, Paperclip, Plus, Trash2 } from "lucide-react";
import { fileBadge, MAX_FILES, parseFilePath, type ItemFile } from "@/lib/item-files";
import { clearRoot, fsSupported, guessRootPath, loadRoot, pickDocuments, pickRootFolder, saveRoot, type RootInfo } from "@/lib/fs-access";

/** Значок формата вместо превью: сайт не видит ваш диск, поэтому показываем тип файла цветом и подписью. */
function Badge({ ext, kind }: { ext: string; kind?: string }) {
  const b = fileBadge(ext, kind);
  return (
    <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md text-[10px] font-extrabold tracking-wide text-white" style={{ background: b.color }} aria-hidden>
      <Paperclip size={11} className="mb-0.5 opacity-70" />
      {b.label}
    </span>
  );
}

function describe(path: string) {
  const p = parseFilePath(path);
  return p.ok ? p : null;
}

/**
 * Блок «Файлы» в карточке позиции. Файлы НЕ загружаются: хранится только путь на общем диске.
 * «Добавить документ» открывает окно выбора файла Windows (после разовой настройки папки общего диска);
 * путь можно и вставить вручную. Открывается файл скачиванием ярлыка .url (двойной щелчок по нему открывает файл
 * у того, у кого есть доступ к диску); запасной вариант — «Копировать путь».
 */
export function ItemFiles({
  files,
  onChange,
  itemId,
  disabled,
}: {
  files: ItemFile[];
  onChange: (next: ItemFile[]) => void;
  /** Нет у ещё не созданной позиции — ярлык скачать нельзя, только скопировать путь. */
  itemId: string | null;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // выбор из окна Windows
  const [supported, setSupported] = useState(false);
  const [root, setRoot] = useState<RootInfo | null>(null);
  const [setup, setSetup] = useState<{ handle: RootInfo["handle"]; name: string; path: string } | null>(null);
  // ручной ввод
  const [manual, setManual] = useState(false);
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const ok = fsSupported();
    setSupported(ok);
    if (!ok) setManual(true);
    else void loadRoot().then(setRoot);
  }, []);

  const full = files.length >= MAX_FILES;
  const parsed = useMemo(() => (text.trim() ? parseFilePath(text) : null), [text]);
  const duplicate = parsed?.ok && files.some((f) => f.path.toLowerCase() === parsed.path.toLowerCase());

  /** Добавляет пути (из окна Windows или вставленный): повторы пропускаются, лимит и ошибки — простыми словами. */
  function addPaths(paths: string[]): boolean {
    let next = [...files];
    const problems: string[] = [];
    for (const raw of paths) {
      const p = parseFilePath(raw);
      if (!p.ok) {
        problems.push(p.error);
        continue;
      }
      if (next.some((f) => f.path.toLowerCase() === p.path.toLowerCase())) {
        problems.push(`«${p.name}» уже добавлен.`);
        continue;
      }
      if (next.length >= MAX_FILES) {
        problems.push(`Можно прикрепить не больше ${MAX_FILES} файлов.`);
        break;
      }
      next = [...next, { id: `new-${Math.random().toString(36).slice(2, 10)}`, path: p.path, name: p.name }];
    }
    if (next.length !== files.length) onChange(next);
    setMessage(problems.length ? problems[0] : null);
    return problems.length === 0;
  }

  async function choose(from: RootInfo) {
    setMessage(null);
    const r = await pickDocuments(from);
    if (r.ok) addPaths(r.paths);
    else if (!r.cancelled) setMessage(r.error ?? "Не получилось выбрать файл.");
  }

  async function onAddDocument() {
    setMessage(null);
    if (full) return setMessage(`Можно прикрепить не больше ${MAX_FILES} файлов.`);
    if (root) return void choose(root);
    await startSetup();
  }

  async function startSetup() {
    try {
      const handle = await pickRootFolder();
      if (handle) setSetup({ handle, name: handle.name, path: guessRootPath(handle.name) });
    } catch {
      setMessage("Не удалось открыть выбор папки. Можно вставить путь вручную.");
      setManual(true);
    }
  }

  async function finishSetup() {
    if (!setup) return;
    const probe = parseFilePath(`${setup.path.trim().replace(/[\\/]+$/, "")}\\проверка.txt`);
    if (!probe.ok) return setMessage("Впишите путь этой папки в Windows, например \\\\сервер\\папка или Z:\\Отдел.");
    const info: RootInfo = { handle: setup.handle, path: setup.path.trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "") };
    await saveRoot(info);
    setRoot(info);
    setSetup(null);
    setMessage(null);
    await choose(info);
  }

  async function copy(f: ItemFile) {
    try {
      await navigator.clipboard.writeText(f.path);
      setCopied(f.id);
      setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1800);
    } catch {
      window.prompt("Скопируйте путь (Ctrl+C):", f.path);
    }
  }

  function addManual() {
    setTouched(true);
    if (!parsed || !parsed.ok || duplicate || full) return;
    if (addPaths([text])) {
      setText("");
      setTouched(false);
    }
  }
  const manualError = touched && parsed && !parsed.ok ? parsed.error : duplicate ? "Этот файл уже добавлен." : null;

  return (
    <div className="space-y-2.5">
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => {
            const d = describe(f.path);
            const web = d?.kind === "web";
            const saved = !!itemId && !f.id.startsWith("new-");
            return (
              <li key={f.id} className="flex items-center gap-3 rounded-lg border border-outline-variant bg-surface p-2.5 shadow-sm">
                <Badge ext={d?.ext ?? ""} kind={d?.kind} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-on-surface" title={f.name}>{f.name}</p>
                  <p className="truncate text-[11px] text-on-surface-variant" title={f.path}>{d?.folder || f.path}</p>
                  {!saved && !web && <p className="text-[11px] text-outline">Откроется после сохранения позиции</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  {web ? (
                    <a href={f.path} target="_blank" rel="noopener noreferrer" className="btn-icon h-9 w-9" title="Открыть ссылку" aria-label="Открыть ссылку">
                      <ExternalLink size={16} />
                    </a>
                  ) : (
                    saved && (
                      <a
                        href={`/api/items/${itemId}/files/${f.id}/shortcut`}
                        className="btn-icon h-9 w-9"
                        title="Открыть: скачается ярлык — откройте его двойным щелчком (нужен доступ к этому диску)"
                        aria-label="Открыть файл"
                      >
                        <Download size={16} />
                      </a>
                    )
                  )}
                  <button type="button" onClick={() => void copy(f)} className="btn-icon h-9 w-9" title="Копировать путь" aria-label="Копировать путь">
                    {copied === f.id ? <Check size={16} className="text-status-emerald" /> : <Copy size={16} />}
                  </button>
                  {!disabled && (
                    <button type="button" onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="btn-icon h-9 w-9 text-status-red" title="Убрать из позиции (сам файл не удаляется)" aria-label="Убрать файл">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {files.length === 0 && disabled && <p className="text-[13px] text-outline">Файлов нет.</p>}

      {!disabled && (
        <div className="space-y-2">
          {supported && !setup && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void onAddDocument()} disabled={full} className="btn-primary h-9">
                <Plus size={14} /> Добавить документ
              </button>
              {root && (
                <button
                  type="button"
                  onClick={() => void startSetup()}
                  className="flex h-9 items-center gap-1 text-[12px] font-semibold text-on-surface-variant hover:text-primary"
                  title={`Сейчас: ${root.path}`}
                >
                  <FolderCog size={14} /> Сменить папку диска
                </button>
              )}
              {root && (
                <button
                  type="button"
                  onClick={() => void clearRoot().then(() => setRoot(null))}
                  className="h-9 text-[12px] text-outline hover:text-status-red"
                  title="Забыть сохранённую папку диска на этом компьютере"
                >
                  Забыть
                </button>
              )}
            </div>
          )}

          {setup && (
            <div className="space-y-2.5 rounded-lg border border-outline-variant bg-surface-low p-3">
              <p className="text-[13px] font-semibold text-on-surface">Один раз настроим общий диск</p>
              <p className="text-[12px] leading-snug text-on-surface-variant">
                Вы выбрали папку «{setup.name}». Браузер не показывает сайту, где она лежит в Windows, поэтому впишите её путь:
                откройте эту папку в проводнике, нажмите на адресную строку и скопируйте (Ctrl+C).
              </p>
              <input
                autoFocus
                value={setup.path}
                onChange={(e) => setSetup({ ...setup, path: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void finishSetup();
                  }
                }}
                placeholder="\\сервер\папка\отдел"
                className="input h-9 w-full"
                aria-label="Путь папки диска в Windows"
              />
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void finishSetup()} disabled={!setup.path.trim()} className="btn-primary h-9 flex-1">
                  Сохранить и выбрать документ
                </button>
                <button type="button" onClick={() => setSetup(null)} className="btn-ghost h-9">Отмена</button>
              </div>
            </div>
          )}

          {message && <p className="text-[12px] text-status-red">{message}</p>}

          {supported && !manual && (
            <button type="button" onClick={() => setManual(true)} className="text-[12px] font-semibold text-primary">
              Вставить путь вручную
            </button>
          )}

          {manual && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setTouched(false);
                  }}
                  onBlur={() => text.trim() && setTouched(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManual();
                    }
                  }}
                  placeholder="Вставьте путь, например \\сервер\папка\отчёт.xlsx"
                  className="input h-9 min-w-0 flex-1"
                  aria-label="Путь к файлу"
                />
                <button type="button" onClick={addManual} disabled={!parsed || !parsed.ok || !!duplicate || full} className="btn-primary h-9 shrink-0">
                  <Plus size={14} /> Добавить
                </button>
              </div>
              {parsed?.ok && !duplicate && (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-primary/50 bg-primary-soft/40 p-2.5">
                  <Badge ext={parsed.ext} kind={parsed.kind} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-on-surface">{parsed.name}</p>
                    <p className="truncate text-[11px] text-on-surface-variant">{parsed.folder}</p>
                  </div>
                </div>
              )}
              {manualError && <p className="text-[12px] text-status-red">{manualError}</p>}
              <p className="text-[11px] leading-snug text-on-surface-variant">В проводнике: Shift + правая кнопка по файлу → «Копировать как путь», затем вставьте сюда.</p>
            </div>
          )}

          <p className="flex gap-1.5 text-[11px] leading-snug text-on-surface-variant">
            <Info size={13} className="mt-px shrink-0" />
            <span>
              Файл на сайт не загружается — хранится только путь. Открыть файл смогут те, у кого есть доступ к этому диску; без доступа Windows сама сообщит об этом.
              {!supported && " Окно выбора файла работает в Chrome, Edge и Яндекс Браузере (по адресу https)."}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
