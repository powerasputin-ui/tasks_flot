"use client";

import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { clearBootstrap } from "@/lib/client-bootstrap";
import { checkTrackName, findTrackMatches, TRACK_NAME_MAX } from "@/lib/track-name";

export type TrackOption = { id: string; name: string; segmentId: string | null };

/**
 * Форма «Добавить трек»: пока человек печатает, показываем похожие существующие треки (кликом выбираются),
 * точный повтор создать нельзя, на «почти такое же» — предупреждение. Созданный трек сразу попадает
 * в общий справочник — как будто его завёл куратор. Используется в карточке позиции и в фильтре «Трек».
 */
export function AddTrackForm({
  tracks,
  segmentId,
  segmentName,
  onPick,
  onCreated,
  onClose,
}: {
  tracks: TrackOption[];
  segmentId: string | null;
  segmentName: string | null;
  /** Человек выбрал уже существующий трек (или только что созданный). */
  onPick: (id: string) => void;
  onCreated: (t: TrackOption) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSimilar, setConfirmSimilar] = useState(false);

  const matches = useMemo(() => findTrackMatches(text, tracks), [text, tracks]);
  const exact = matches.find((m) => m.kind === "exact");
  const similar = matches.filter((m) => m.kind === "similar");
  const check = useMemo(() => (text.trim() ? checkTrackName(text) : null), [text]);
  const invalid = check && !check.ok ? check.error : null;

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
        onPick(d.track.id);
      } else if (res.status === 409 && d?.existing) {
        // кто-то уже добавил такой же трек — просто выбираем его
        if (d.existing.isActive === false) setError(`Трек «${d.existing.name}» уже есть, но отключён куратором.`);
        else {
          onCreated({ id: d.existing.id, name: d.existing.name, segmentId: d.existing.segmentId ?? null });
          onPick(d.existing.id);
        }
      } else setError(d?.message ?? "Не удалось добавить трек. Попробуйте ещё раз.");
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-md border border-outline-variant bg-surface-low p-3">
      <input
        autoFocus
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
            onClose();
          }
        }}
        placeholder="Название нового трека"
        className="input h-9 w-full"
        aria-label="Название нового трека"
      />

      {matches.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold text-on-surface-variant">{exact ? "Такой трек уже есть:" : "Уже есть похожие — выберите, чтобы не создавать повтор:"}</p>
          <ul className="space-y-1">
            {matches.map((m) => (
              <li key={m.track.id}>
                <button type="button" onClick={() => onPick(m.track.id)} className="flex min-h-9 w-full items-center gap-2 rounded-md border border-outline-variant bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-high">
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

      <p className="text-[11px] leading-snug text-on-surface-variant">{segmentName ? `Трек будет в сегменте «${segmentName}».` : "Без сегмента — трек будет виден во всех сегментах."}</p>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void create()} disabled={!check || !check.ok || !!exact || busy} className="btn-primary h-9 flex-1">
          {exact ? "Уже есть" : confirmSimilar ? "Всё равно создать" : "Создать трек"}
        </button>
        <button type="button" onClick={onClose} className="btn-ghost h-9">Отмена</button>
      </div>
    </div>
  );
}

/** Выбор трека в карточке позиции + «Добавить трек» под списком. */
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
  return (
    <div>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="select w-full">
        <option value="">—</option>
        {tracks.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      {!disabled && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="mt-1.5 flex h-8 items-center gap-1 text-[12px] font-semibold text-primary">
          <Plus size={14} /> Добавить трек
        </button>
      )}
      {!disabled && adding && (
        <div className="mt-2">
          <AddTrackForm tracks={tracks} segmentId={segmentId} segmentName={segmentName} onCreated={onCreated} onPick={(id) => { onChange(id); setAdding(false); }} onClose={() => setAdding(false)} />
        </div>
      )}
    </div>
  );
}

/** «+ Добавить трек» внизу выпадашки фильтра «Трек»: раскрывается в ту же форму с подсказками. */
export function AddTrackInline({
  tracks,
  segmentId,
  segmentName,
  onCreated,
  onPick,
  onClose,
}: {
  tracks: TrackOption[];
  segmentId: string | null;
  segmentName: string | null;
  onCreated: (t: TrackOption) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  if (!adding)
    return (
      <button type="button" onClick={() => setAdding(true)} className="flex h-9 w-full items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-primary hover:bg-primary-soft">
        <Plus size={15} /> Добавить трек
      </button>
    );
  return (
    <AddTrackForm
      tracks={tracks}
      segmentId={segmentId}
      segmentName={segmentName}
      onCreated={onCreated}
      onPick={(id) => {
        onPick(id);
        setAdding(false);
        onClose();
      }}
      onClose={() => setAdding(false)}
    />
  );
}
