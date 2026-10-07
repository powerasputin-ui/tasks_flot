"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

/**
 * Диалоги в стиле приложения вместо системных window.prompt / window.confirm (те выглядят чужеродно и встают сверху окна).
 * Окно по центру экрана, затемнённый фон, Esc — отмена, Enter — ОК (в многострочном поле — Ctrl+Enter).
 * Вызов: `const text = await askText({...})` → строка или null (отмена); `await askConfirm({...})` → true/false.
 * Один <DialogHost /> подключён в app/layout.tsx.
 */

type TextOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  /** Поле в несколько строк (комментарий). */
  multiline?: boolean;
  /** ОК недоступна, пока поле пустое. */
  required?: boolean;
  maxLength?: number;
};
type ConfirmOptions = { title: string; message?: string; okLabel?: string; cancelLabel?: string; danger?: boolean };

type Request =
  | ({ kind: "text"; resolve: (v: string | null) => void } & TextOptions)
  | ({ kind: "confirm"; resolve: (v: boolean) => void } & ConfirmOptions);

let show: ((r: Request) => void) | null = null;

/** Спросить текст. null — человек нажал «Отмена» или Esc. */
export function askText(opts: TextOptions): Promise<string | null> {
  if (!show) return Promise.resolve(window.prompt(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title, opts.defaultValue ?? ""));
  return new Promise((resolve) => show!({ kind: "text", ...opts, resolve }));
}

/** Подтверждение действия. */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (!show) return Promise.resolve(window.confirm(opts.message ? `${opts.title}\n\n${opts.message}` : opts.title));
  return new Promise((resolve) => show!({ kind: "confirm", ...opts, resolve }));
}

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    show = (r) => {
      setValue(r.kind === "text" ? r.defaultValue ?? "" : "");
      setReq(r);
    };
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    const t = setTimeout(() => {
      if (req.kind === "text") {
        fieldRef.current?.focus();
        fieldRef.current?.select();
      } else okRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [req]);

  if (!req) return null;

  const close = (ok: boolean) => {
    if (req.kind === "text") req.resolve(ok ? value : null);
    else req.resolve(ok);
    setReq(null);
  };
  const canOk = req.kind === "confirm" || !req.required || value.trim().length > 0;
  const danger = req.kind === "confirm" && req.danger;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close(false);
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" className="w-full max-w-md rounded-xl border border-outline-variant bg-surface shadow-2xl">
        <div className="flex items-start gap-3 px-5 pb-2 pt-5">
          {danger && (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-status-red/10 text-status-red">
              <AlertTriangle size={17} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="app-dialog-title" className="text-[16px] font-semibold leading-snug text-on-surface">{req.title}</h2>
            {req.message && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-on-surface-variant [overflow-wrap:anywhere]">{req.message}</p>}
          </div>
          <button onClick={() => close(false)} className="btn-icon -mr-2 -mt-1 h-8 w-8 shrink-0" aria-label="Закрыть">
            <X size={17} />
          </button>
        </div>

        {req.kind === "text" && (
          <div className="px-5 pt-2">
            {req.multiline ? (
              <textarea
                ref={fieldRef}
                value={value}
                maxLength={req.maxLength}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canOk) {
                    e.preventDefault();
                    close(true);
                  }
                }}
                placeholder={req.placeholder}
                rows={4}
                className="input min-h-[96px] w-full resize-y py-2"
              />
            ) : (
              <input
                ref={fieldRef}
                value={value}
                maxLength={req.maxLength}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canOk) {
                    e.preventDefault();
                    close(true);
                  }
                }}
                placeholder={req.placeholder}
                className="input h-10 w-full"
              />
            )}
            {req.multiline && <p className="mt-1 text-[11px] text-outline">Ctrl+Enter — отправить</p>}
          </div>
        )}

        <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
          <button onClick={() => close(false)} className="btn-ghost">{(req.kind === "confirm" && req.cancelLabel) || "Отмена"}</button>
          <button ref={okRef} onClick={() => close(true)} disabled={!canOk} className={danger ? "btn-danger" : "btn-primary"}>
            {req.okLabel ?? "ОК"}
          </button>
        </div>
      </div>
    </div>
  );
}
