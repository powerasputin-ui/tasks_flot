"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, ExternalLink, Info, Paperclip, Plus, Trash2 } from "lucide-react";
import { fileBadge, MAX_FILES, parseFilePath, type ItemFile } from "@/lib/item-files";

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
 * Открывается скачиванием ярлыка .url (двойной щелчок по нему открывает файл у того, у кого есть доступ к диску);
 * запасной вариант — «Копировать путь».
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
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseFilePath(text) : null), [text]);
  const duplicate = parsed?.ok && files.some((f) => f.path.toLowerCase() === parsed.path.toLowerCase());
  const full = files.length >= MAX_FILES;

  function add() {
    if (!parsed) return;
    setTouched(true);
    if (!parsed.ok || duplicate || full) return;
    onChange([...files, { id: `new-${Math.random().toString(36).slice(2, 10)}`, path: parsed.path, name: parsed.name }]);
    setText("");
    setTouched(false);
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

  const error = touched && parsed && !parsed.ok ? parsed.error : duplicate ? "Этот файл уже добавлен." : full ? `Можно прикрепить не больше ${MAX_FILES} файлов.` : null;

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
                  add();
                }
              }}
              placeholder="Вставьте путь, например \\сервер\папка\отчёт.xlsx"
              className="input h-9 min-w-0 flex-1"
              aria-label="Путь к файлу"
            />
            <button type="button" onClick={add} disabled={!parsed || !parsed.ok || !!duplicate || full} className="btn-primary h-9 shrink-0">
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
          {error && <p className="text-[12px] text-status-red">{error}</p>}

          <p className="flex gap-1.5 text-[11px] leading-snug text-on-surface-variant">
            <Info size={13} className="mt-px shrink-0" />
            <span>
              Файл на сайт не загружается — хранится только путь. В проводнике: Shift + правая кнопка по файлу → «Копировать как путь», затем вставьте сюда.
              Открыть файл смогут те, у кого есть доступ к этому диску; без доступа Windows сама сообщит об этом.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
