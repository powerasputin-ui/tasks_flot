"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, ExternalLink, Paperclip, Plus, Trash2 } from "lucide-react";
import { askText } from "@/components/ui/Dialog";
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
 * Блок «Файлы» в карточке позиции. Файлы НЕ загружаются: хранится путь именно к документу на общем диске.
 * Браузер не отдаёт сайту путь выбранного файла, поэтому путь копируют из проводника (Shift + правая кнопка → «Копировать как путь»).
 * Открывается файл скачиванием ярлыка .url (двойной щелчок по нему открывает файл у того, у кого есть доступ к диску);
 * запасной вариант — «Копировать путь».
 */
export function ItemFiles({
  files,
  onChange,
  itemId,
  disabled,
  busy = false,
  status = null,
}: {
  files: ItemFile[];
  onChange: (next: ItemFile[]) => void;
  /** Нет у ещё не созданной позиции — ярлык скачать нельзя, только скопировать путь. */
  itemId: string | null;
  disabled?: boolean;
  /** Идёт сохранение (у существующей позиции документы сохраняются сразу). */
  busy?: boolean;
  /** Итог сохранения для существующей позиции; null — новая позиция (документы сохранятся вместе с «Создать»). */
  status?: { state: "idle" | "saving" | "saved" | "error"; text?: string } | null;
}) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseFilePath(text) : null), [text]);
  const duplicate = parsed?.ok && files.some((f) => f.path.toLowerCase() === parsed.path.toLowerCase());
  const full = files.length >= MAX_FILES;
  const canAdd = !!parsed && parsed.ok && !duplicate && !full;

  /** Добавляет путь из строки: пустое/некорректное/повтор — ничего не делает (ошибку покажет подсказка под полем). */
  function addFrom(raw: string): boolean {
    const p = raw.trim() ? parseFilePath(raw) : null;
    if (busy || !p || !p.ok || full || files.some((f) => f.path.toLowerCase() === p.path.toLowerCase())) return false;
    onChange([...files, { id: `new-${Math.random().toString(36).slice(2, 10)}`, path: p.path, name: p.name }]);
    setText("");
    setTouched(false);
    return true;
  }

  function add() {
    setTouched(true);
    addFrom(text);
  }

  async function copy(f: ItemFile) {
    try {
      await navigator.clipboard.writeText(f.path);
      setCopied(f.id);
      setTimeout(() => setCopied((c) => (c === f.id ? null : c)), 1800);
    } catch {
      // буфер обмена недоступен (старый браузер, нет HTTPS) — показываем путь выделенным, чтобы скопировать Ctrl+C
      await askText({ title: "Скопируйте путь", message: "Путь уже выделен — нажмите Ctrl+C.", defaultValue: f.path, okLabel: "Готово" });
    }
  }

  const error = touched && parsed && !parsed.ok ? parsed.error : duplicate ? "Этот документ уже добавлен." : full ? `Можно прикрепить не больше ${MAX_FILES} документов.` : null;

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
                    <button type="button" disabled={busy} onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="btn-icon h-9 w-9 text-status-red" title="Убрать из позиции (сам файл не удаляется)" aria-label="Убрать файл">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {files.length === 0 && disabled && <p className="text-[13px] text-outline">Документов нет.</p>}

      {!disabled && (
        <div className="space-y-2.5">
          <ol className="list-decimal space-y-0.5 rounded-lg bg-surface-low py-2.5 pl-8 pr-3 text-[12px] leading-snug text-on-surface-variant">
            <li>В проводнике найдите сам документ (не папку).</li>
            <li>Удерживая <b>Shift</b>, нажмите на нём правой кнопкой → <b>«Копировать как путь»</b>.</li>
            <li>Вставьте путь в поле ниже (Ctrl+V): документ добавится сразу, название и тип определятся сами.</li>
          </ol>

          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setTouched(false);
              }}
              // вставили путь — документ добавляется сразу; ушли из поля с готовым путём — тоже (иначе его легко потерять при «Сохранить»)
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (parseFilePath(pasted).ok) {
                  e.preventDefault();
                  addFrom(pasted);
                }
              }}
              onBlur={() => {
                if (text.trim() && !addFrom(text)) setTouched(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Вставьте путь к документу"
              className="input h-9 min-w-0 flex-1"
              aria-label="Путь к документу"
            />
            <button type="button" onClick={add} disabled={!canAdd || busy} className="btn-primary h-9 shrink-0">
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
          {status === null && files.length > 0 && <p className="text-[12px] font-semibold text-status-amber">Документы сохранятся вместе с позицией — нажмите «Создать» внизу.</p>}
          {status?.state === "saving" && <p className="text-[12px] text-on-surface-variant">Сохраняю…</p>}
          {status?.state === "saved" && <p className="flex items-center gap-1 text-[12px] font-semibold text-status-emerald"><Check size={14} /> {status.text}</p>}
          {status?.state === "error" && <p className="text-[12px] font-semibold text-status-red">{status.text}</p>}

          <p className="text-[11px] leading-snug text-on-surface-variant">
            Документ на сайт не загружается — хранится только путь к нему. Открыть его смогут те, у кого есть доступ к этому диску; без доступа Windows сама сообщит об этом.
          </p>
        </div>
      )}
    </div>
  );
}

const HOVER_W = 340;

/**
 * Скрепка с числом документов в таблице. Наведение — список документов (тип, название, папка);
 * клик по документу — скачивается ярлык (веб-ссылка открывается в новой вкладке). Клики не открывают позицию.
 * На телефоне список открывается касанием по скрепке.
 */
export type FileEntry = { itemId: string; file: ItemFile };

/** Документы позиции → записи для FilesHover. */
export const fileEntries = (itemId: string, files: ItemFile[] | undefined): FileEntry[] => (files ?? []).map((file) => ({ itemId, file }));

export function FilesHover({ entries, className = "", title = "Документы" }: { entries: FileEntry[]; className?: string; title?: string }) {
  const files = entries.map((e) => e.file);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const open = () => {
    if (timer.current) clearTimeout(timer.current);
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const h = Math.min(64 + files.length * 52, 360);
    const above = r.bottom + h + 8 > window.innerHeight && r.top > h;
    setPos({ left: Math.max(8, Math.min(r.left - 12, window.innerWidth - HOVER_W - 8)), top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const close = (delay = 180) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPos(null), delay);
  };

  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`Документы: ${files.length}`}
        onMouseEnter={open}
        onMouseLeave={() => close()}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) close(0);
          else open();
        }}
        onContextMenu={(e) => e.stopPropagation()}
        className={`inline-flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold text-on-surface-variant hover:bg-primary-soft hover:text-primary ${className}`}
      >
        <Paperclip size={13} />
        {files.length}
      </span>
      {pos &&
        createPortal(
          <div
            onMouseEnter={() => timer.current && clearTimeout(timer.current)}
            onMouseLeave={() => close()}
            onClick={(e) => e.stopPropagation()}
            className="animate-fade-in fixed z-50 overflow-hidden rounded-lg border border-outline-variant bg-surface text-left shadow-xl"
            style={{ left: pos.left, top: pos.top, width: HOVER_W, maxWidth: "calc(100vw - 16px)", transform: pos.above ? "translateY(-100%)" : undefined }}
          >
            <p className="label-caps border-b border-outline-variant px-3 py-2">{title} · {files.length}</p>
            <ul className="max-h-80 overflow-y-auto py-1">
              {entries.map(({ itemId, file: f }) => {
                const d = describe(f.path);
                const web = d?.kind === "web";
                return (
                  <li key={`${itemId}:${f.id}`}>
                    <a
                      href={web ? f.path : `/api/items/${itemId}/files/${f.id}/shortcut`}
                      {...(web ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      onClick={() => close(0)}
                      className="flex items-center gap-2.5 px-3 py-2 hover:bg-primary-soft"
                      title={web ? "Открыть ссылку" : "Скачать ярлык — откройте его двойным щелчком (нужен доступ к диску)"}
                    >
                      <Badge ext={d?.ext ?? ""} kind={d?.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-on-surface">{f.name}</span>
                        <span className="block truncate text-[11px] text-on-surface-variant">{d?.folder || f.path}</span>
                      </span>
                      {web ? <ExternalLink size={15} className="shrink-0 text-outline" /> : <Download size={15} className="shrink-0 text-outline" />}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
