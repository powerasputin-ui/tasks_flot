"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { clearBootstrap } from "@/lib/client-bootstrap";
import { checkTrackName, findTrackMatches, TRACK_NAME_MAX } from "@/lib/track-name";

export type TrackOption = { id: string; name: string; segmentId: string | null };

/**
 * Выбор трека + «Добавить трек» прямо в карточке. Пока человек печатает, показываем похожие существующие треки
 * (кликом выбираются), точный повтор создать нельзя, на «почти такое же» — предупреждение. Созданный трек
 * сразу попадает в общий справочник — как будто его завёл куратор.
 */
export function TrackPicker({
  value,
  onChange,
  tracks,
  segmentId,
  segmentName,
  disabled,
  onCreated,
}: {
  value: string;
  onChange: (id: string) => void;
  tracks: TrackOption[];
  segmentId: string | null;
  segmentName: string | null;
  disabled?: boolean;
  onCreated: (t: TrackOption) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSimilar, setConfirmSimilar] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => findTrackMatches(text, tracks), [text, tracks]);
  const exact = matches.find((m) => m.kind === "exact");
  const similar = matches.filter((m) => m.kind === "similar");
  const check = useMemo(() => (text.trim() ? checkTrackName(text) : null), [text]);
  const invalid = check && !check.ok ? check.error : null;

  function close() {
    setAdding(false);
    setText("");
    setError(null);
    setConfirmSimilar(false);
  }

  function pick(id: string) {
    onChange(id);
    close();
  }

  async function create() {
    if (!check || !check.ok || exact || busy) return;
    if (similar.length > 0 && !confirmSimilar) {
      setConfirmSimilar(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tracks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: check.name, segmentId }) });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.track) {
        clearBootstrap();
        onCreated({ id: d.track.id, name: d.track.name, segmentId: d.track.segmentId ?? null });
        pick(d.track.id);
      } else if (res.status === 409 && d?.existing) {
        // кто-то уже добавил такой же трек — просто выбираем его
        if (d.existing.isActive === false) setError(`Трек «${d.existing.name}» уже есть, но отключён куратором.`);
        else {
          onCreated({ id: d.existing.id, name: d.existing.name, segmentId: d.existing.segmentId ?? null });
          pick(d.existing.id);
        }
      } else setError(d?.message ?? "Не удалось добавить трек. Попробуйте ещё раз.");
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="select w-full">
        <option value="">—</option>
        {tracks.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>

      {!disabled && !adding && (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="mt-1.5 flex h-8 items-center gap-1 text-[12px] font-semibold text-primary"
        >
          <Plus size={14} /> Добавить трек
        </button>
      )}

      {!disabled && adding && (
        <div className="mt-2 space-y-2 rounded-md border border-outline-variant bg-surface-low p-2.5">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={text}
              maxLength={TRACK_NAME_MAX + 20}
              onChange={(e) => {
                setText(e.target.value);
                setConfirmSimilar(false);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void create();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  close();
                }
              }}
              placeholder="Название нового трека"
              className="input h-9 min-w-0 flex-1"
              aria-label="Название нового трека"
            />
            <button type="button" onClick={close} className="btn-icon h-9 w-9" aria-label="Отмена" title="Отмена">
              <X size={16} />
            </button>
          </div>

          {matches.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-on-surface-variant">{exact ? "Такой трек уже есть:" : "Уже есть похожие — выберите, чтобы не создавать повтор:"}</p>
              <ul className="space-y-1">
                {matches.map((m) => (
                  <li key={m.track.id}>
                    <button type="button" onClick={() => pick(m.track.id)} className="flex min-h-9 w-full items-center gap-2 rounded-md border border-outline-variant bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-high">
                      <Check size={14} className="shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{m.track.name}</span>
                      <span className="shrink-0 text-[11px] font-semibold text-primary">Выбрать</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {invalid && <p className="text-[12px] text-status-red">{invalid}</p>}
          {error && <p className="text-[12px] text-status-red">{error}</p>}
          {confirmSimilar && !exact && <p className="text-[12px] text-status-amber">Есть похожие треки (см. выше). Если это точно другой трек — нажмите кнопку ещё раз.</p>}

          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-on-surface-variant">{segmentName ? `Будет в сегменте «${segmentName}»` : "Без сегмента — виден во всех сегментах"}</span>
            <button type="button" onClick={() => void create()} disabled={!check || !check.ok || !!exact || busy} className="btn-primary h-8 shrink-0">
              {exact ? "Уже есть" : confirmSimilar ? "Всё равно создать" : "Создать"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
