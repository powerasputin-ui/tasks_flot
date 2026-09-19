"use client";

import { useEffect, useMemo, useState } from "react";

export type Ref = { id: string; name: string };
export type TrackRef = Ref & { segmentId: string | null };
export type Refs = {
  departments: Ref[];
  segments: Ref[];
  tracks: TrackRef[];
  statuses: Ref[];
  attractiveness: Ref[];
  users: Ref[];
};

export type ItemRow = {
  id: string;
  departmentId: string;
  segmentId: string | null;
  trackId: string | null;
  name: string;
  cost: string | null;
  attractivenessId: string | null;
  ownerId: string | null;
  deadline: string | null;
  statusId: string | null;
  operFlag: boolean;
  comment: string | null;
  version: number;
  archived: boolean;
  createdByName: string;
};

type FormState = {
  departmentId: string;
  segmentId: string;
  trackId: string;
  title: string;
  cost: string;
  attractivenessId: string;
  responsibleId: string;
  deadline: string;
  statusId: string;
  comment: string;
  operFlag: boolean;
};

type Event = {
  id: string;
  timestamp: string;
  fieldName: string | null;
  action: string;
  before: string | null;
  after: string | null;
  actor: { name: string } | null;
};

const FIELD_LABEL: Record<string, string> = {
  title: "Название",
  cost: "Оценка $",
  comment: "Комментарий",
  departmentId: "Подразделение",
  segmentId: "Сегмент",
  trackId: "Трек",
  attractivenessId: "Привлекательность",
  responsibleId: "Ответственный",
  deadline: "Срок",
  statusId: "Статус",
  operFlag: "Опер",
};

const fromRow = (r: ItemRow | null, defaultDepartmentId: string): FormState => ({
  departmentId: r?.departmentId ?? defaultDepartmentId,
  segmentId: r?.segmentId ?? "",
  trackId: r?.trackId ?? "",
  title: r?.name ?? "",
  cost: r?.cost ?? "",
  attractivenessId: r?.attractivenessId ?? "",
  responsibleId: r?.ownerId ?? "",
  deadline: r?.deadline ? r.deadline.slice(0, 10) : "",
  statusId: r?.statusId ?? "",
  comment: r?.comment ?? "",
  operFlag: r?.operFlag ?? false,
});

export function ItemForm({
  row,
  refs,
  defaultDepartmentId,
  lockDepartment,
  canEdit,
  onClose,
  onSaved,
}: {
  row: ItemRow | null;
  refs: Refs;
  defaultDepartmentId: string;
  lockDepartment: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [base, setBase] = useState<ItemRow | null>(row);
  const [form, setForm] = useState<FormState>(fromRow(row, defaultDepartmentId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [history, setHistory] = useState<Event[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const isNew = row === null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const tracksForSegment = useMemo(
    () => refs.tracks.filter((t) => !form.segmentId || t.segmentId === form.segmentId || t.segmentId === null),
    [refs.tracks, form.segmentId]
  );

  useEffect(() => {
    if (!showHistory || !base) return;
    fetch(`/api/items/${base.id}/history`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setHistory(d.events));
  }, [showHistory, base]);

  const nul = (v: string) => (v === "" ? null : v);
  const payload = () => ({
    departmentId: form.departmentId,
    segmentId: nul(form.segmentId),
    trackId: nul(form.trackId),
    title: form.title,
    cost: nul(form.cost),
    attractivenessId: nul(form.attractivenessId),
    responsibleId: nul(form.responsibleId),
    deadline: form.deadline ? form.deadline : null,
    statusId: nul(form.statusId),
    comment: nul(form.comment),
    operFlag: form.operFlag,
  });

  async function save() {
    if (!form.title.trim()) {
      setError("Название обязательно");
      return;
    }
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      const res = await fetch(isNew ? "/api/items" : `/api/items/${base!.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? payload() : { ...payload(), version: base!.version }),
      });
      if (res.ok) {
        onSaved();
        return;
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        if (body?.error === "ARCHIVED") setError("Позиция в архиве: сначала верните её в работу.");
        else setConflict(true);
      } else if (res.status === 403) setError("Нет прав на это действие.");
      else if (res.status === 400) setError("Проверьте заполненные поля.");
      else setError("Не удалось сохранить. Данные не потеряны, попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  async function reloadLatest() {
    if (!base) return;
    const res = await fetch(`/api/items/${base.id}`);
    if (!res.ok) return;
    const fresh = (await res.json()).row as ItemRow;
    setBase(fresh);
    setForm(fromRow(fresh, defaultDepartmentId));
    setConflict(false);
  }

  async function toggleArchive() {
    if (!base) return;
    const res = await fetch(base.archived ? `/api/items/${base.id}/restore` : `/api/items/${base.id}`, {
      method: base.archived ? "POST" : "DELETE",
    });
    if (res.ok) onSaved();
    else setError("Не удалось изменить архивное состояние.");
  }

  const name = (list: Ref[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? "—" : "—");
  const showValue = (field: string | null, v: string | null) => {
    if (v === null) return "—";
    switch (field) {
      case "departmentId": return name(refs.departments, v);
      case "segmentId": return name(refs.segments, v);
      case "trackId": return name(refs.tracks, v);
      case "attractivenessId": return name(refs.attractiveness, v);
      case "statusId": return name(refs.statuses, v);
      case "responsibleId": return name(refs.users, v);
      case "deadline": return new Date(v).toLocaleDateString("ru-RU");
      case "operFlag": return v === "true" ? "да" : "нет";
      default: return v;
    }
  };

  const disabled = !canEdit || (base?.archived ?? false);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="surface animate-fade-in my-6 w-full max-w-2xl bg-white p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-neutral-900">{isNew ? "Новая позиция" : "Позиция"}</h2>
            {!isNew && (
              <p className="text-[12px] text-neutral-500">
                Создал: {base!.createdByName}
                {base!.archived && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">в архиве</span>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost px-2 py-1" title="Закрыть">✕</button>
        </div>

        {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-[13px] text-[var(--danger)]">{error}</p>}
        {conflict && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            <span>Позиция была изменена другим пользователем. Обновите данные, чтобы не затереть чужие правки.</span>
            <button onClick={reloadLatest} className="btn-ghost shrink-0">Обновить</button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Подразделение">
            <Sel value={form.departmentId} onChange={(v) => set("departmentId", v)} options={refs.departments} disabled={disabled || lockDepartment} allowEmpty={false} />
          </Field>
          <Field label="Сегмент">
            <Sel value={form.segmentId} onChange={(v) => set("segmentId", v)} options={refs.segments} disabled={disabled} />
          </Field>
          <Field label="Трек">
            <Sel value={form.trackId} onChange={(v) => set("trackId", v)} options={tracksForSegment} disabled={disabled} />
          </Field>
          <Field label="Ответственный">
            <Sel value={form.responsibleId} onChange={(v) => set("responsibleId", v)} options={refs.users} disabled={disabled} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Название *">
              <textarea value={form.title} onChange={(e) => set("title", e.target.value)} disabled={disabled} rows={2} className="input w-full" />
            </Field>
          </div>
          <Field label="Оценка $">
            <input value={form.cost} onChange={(e) => set("cost", e.target.value)} disabled={disabled} className="input w-full" placeholder="например, 2 млн.$" />
          </Field>
          <Field label="Привлекательность">
            <Sel value={form.attractivenessId} onChange={(v) => set("attractivenessId", v)} options={refs.attractiveness} disabled={disabled} emptyLabel="P0 (не указана)" />
          </Field>
          <Field label="Срок">
            <input type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} disabled={disabled} className="input w-full" />
          </Field>
          <Field label="Статус">
            <Sel value={form.statusId} onChange={(v) => set("statusId", v)} options={refs.statuses} disabled={disabled} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Комментарий">
              <textarea value={form.comment} onChange={(e) => set("comment", e.target.value)} disabled={disabled} rows={3} className="input w-full" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-neutral-700 sm:col-span-2">
            <input type="checkbox" checked={form.operFlag} onChange={(e) => set("operFlag", e.target.checked)} disabled={disabled} className="h-4 w-4 accent-neutral-900" />
            Опер — отправить куратору
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {canEdit && !(base?.archived) && (
              <button onClick={save} disabled={saving} className="btn-primary">{saving ? "Сохранение…" : isNew ? "Создать" : "Сохранить"}</button>
            )}
            <button onClick={onClose} className="btn-ghost">Закрыть</button>
          </div>
          {!isNew && (
            <div className="flex gap-2">
              <button onClick={() => setShowHistory((v) => !v)} className="btn-ghost">{showHistory ? "Скрыть историю" : "История"}</button>
              {canEdit && (
                <button onClick={toggleArchive} className="btn-ghost">{base!.archived ? "Вернуть в работу" : "В архив"}</button>
              )}
            </div>
          )}
        </div>

        {showHistory && (
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <h3 className="mb-2 text-[12px] font-semibold text-neutral-700">История изменений</h3>
            {history === null ? (
              <p className="text-[12px] text-neutral-400">Загрузка…</p>
            ) : history.length === 0 ? (
              <p className="text-[12px] text-neutral-400">Изменений нет.</p>
            ) : (
              <ul className="space-y-1.5 text-[12px] text-neutral-600">
                {history.map((e) => (
                  <li key={e.id}>
                    <span className="text-neutral-400">{new Date(e.timestamp).toLocaleString("ru-RU")}</span> — {e.actor?.name ?? "система"} ·{" "}
                    {e.fieldName ? (
                      <>
                        {FIELD_LABEL[e.fieldName] ?? e.fieldName}:{" "}
                        <span className="text-neutral-400">{showValue(e.fieldName, e.before)}</span> →{" "}
                        <span className="text-neutral-800">{showValue(e.fieldName, e.after)}</span>
                      </>
                    ) : (
                      <span className="text-neutral-800">{e.action === "CREATE" ? "создал" : e.action === "ARCHIVE" ? "в архив" : e.action === "RESTORE" ? "вернул из архива" : e.action}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-neutral-500">{label}</label>
      {children}
    </div>
  );
}

function Sel({
  value,
  onChange,
  options,
  disabled,
  allowEmpty = true,
  emptyLabel = "—",
}: {
  value: string;
  onChange: (v: string) => void;
  options: Ref[];
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="select w-full">
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
