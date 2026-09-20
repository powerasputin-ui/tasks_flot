"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Send, Trash2 } from "lucide-react";
import { AuditChange } from "@/components/AuditChange";
import { HistoryEntry } from "@/components/HistoryEntry";
import { ATTRACTIVENESS_LABEL } from "@/components/ui/Badge";
import { AutoTextarea } from "@/components/ui/AutoTextarea";
import { ExpandableText } from "@/components/ui/ExpandableText";
import { Panel } from "@/components/ui/Panel";
import { FIELD_LABEL } from "@/lib/audit-format";

export type Ref = { id: string; name: string };
export type TrackRef = Ref & { segmentId: string | null };
export type Refs = {
  segments: Ref[];
  tracks: TrackRef[];
  statuses: Ref[];
  attractiveness: Ref[];
  users: Ref[];
};

export type ItemRow = {
  id: string;
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
  createdById: string;
  createdByName: string;
  customValues?: Record<string, string>;
};

type FormState = {
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
  /** значения своих колонок: { <id колонки>: значение } */
  custom: Record<string, string>;
};

export type CustomColumnRef = { id: string; name: string; type: "TEXT" | "NUMBER" | "DATE" | "SELECT"; options: string[] };

type Event = {
  id: string;
  timestamp: string;
  fieldName: string | null;
  action: string;
  before: string | null;
  after: string | null;
  afterSubmission?: boolean;
  actor: { name: string } | null;
};

const fromRow = (r: ItemRow | null, defaultResponsibleId: string): FormState => ({
  segmentId: r?.segmentId ?? "",
  trackId: r?.trackId ?? "",
  title: r?.name ?? "",
  cost: r?.cost ?? "",
  attractivenessId: r?.attractivenessId ?? "",
  responsibleId: r ? r.ownerId ?? "" : defaultResponsibleId,
  deadline: r?.deadline ? r.deadline.slice(0, 10) : "",
  statusId: r?.statusId ?? "",
  comment: r?.comment ?? "",
  operFlag: r?.operFlag ?? false,
  custom: { ...(r?.customValues ?? {}) },
});

export function ItemPanel({
  row,
  refs,
  defaultResponsibleId,
  lockResponsible,
  canEdit,
  canDelete,
  customColumns = [],
  onClose,
  onSaved,
}: {
  row: ItemRow | null;
  refs: Refs;
  defaultResponsibleId: string;
  lockResponsible: boolean;
  canEdit: boolean;
  canDelete: boolean;
  customColumns?: CustomColumnRef[];
  onClose: () => void;
  /** Вызывается после сохранения/удаления/возврата; row — актуальная строка с сервера. */
  onSaved: (row?: ItemRow) => void;
}) {
  const [base, setBase] = useState<ItemRow | null>(row);
  const [form, setForm] = useState<FormState>(fromRow(row, defaultResponsibleId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<"details" | "history">("details");
  const [history, setHistory] = useState<Event[] | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const isNew = row === null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const tracksForSegment = useMemo(
    () => refs.tracks.filter((t) => !form.segmentId || t.segmentId === form.segmentId || t.segmentId === null),
    [refs.tracks, form.segmentId]
  );
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(fromRow(base, defaultResponsibleId)), [form, base, defaultResponsibleId]);

  useEffect(() => {
    if (tab !== "history" || !base) return;
    setHistory(null);
    fetch(`/api/items/${base.id}/history`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setHistory(d.events));
  }, [tab, base]);

  const nul = (v: string) => (v === "" ? null : v);
  const payload = () => ({
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
    customValues: form.custom,
  });

  async function save() {
    if (!form.title.trim()) {
      setError("Задача обязательна");
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
        onSaved((await res.json().catch(() => null))?.row);
        return;
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        if (body?.error === "ARCHIVED") setError("Позиция в архиве: сначала верните её в работу.");
        else setConflict(true);
      } else if (res.status === 403) setError("Нет прав на это действие.");
      else if (res.status === 400) setError((await res.json().catch(() => null))?.message ?? "Проверьте заполненные поля.");
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
    setForm(fromRow(fresh, defaultResponsibleId));
    setConflict(false);
  }

  async function toggleArchive() {
    if (!base) return;
    const res = await fetch(base.archived ? `/api/items/${base.id}/restore` : `/api/items/${base.id}`, {
      method: base.archived ? "POST" : "DELETE",
    });
    if (res.ok) onSaved((await res.json().catch(() => null))?.row);
    else setError(base.archived ? "Не удалось вернуть позицию." : "Не удалось удалить позицию: удалять может только тот, кто её заполняет.");
  }

  const name = (list: Ref[], id: string | null) => (id ? list.find((x) => x.id === id)?.name ?? "—" : "—");
  const showValue = (field: string | null, v: string | null) => {
    if (v === null) return "—";
    switch (field) {
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
  const editable = canEdit && !(base?.archived ?? false);

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {editable && (
          <button onClick={save} disabled={saving || (!isNew && !dirty)} className="btn-primary">
            {saving ? "Сохранение…" : isNew ? "Создать" : "Сохранить"}
          </button>
        )}
        <button onClick={onClose} className="btn-ghost">{editable ? "Отмена" : "Закрыть"}</button>
        {dirty && !isNew && <span className="text-[11px] text-status-amber">● есть изменения</span>}
      </div>
      {!isNew && base!.archived && canEdit && (
        <button onClick={toggleArchive} className="btn-ghost">
          <RotateCcw size={15} /> Вернуть в работу
        </button>
      )}
      {!isNew && !base!.archived && canDelete &&
        (confirmArchive ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-on-surface-variant">Удалить позицию?</span>
            <button onClick={toggleArchive} className="btn-primary h-8 bg-status-red hover:bg-status-red">Да, удалить</button>
            <button onClick={() => setConfirmArchive(false)} className="btn-ghost h-8">Нет</button>
          </div>
        ) : (
          <button onClick={() => setConfirmArchive(true)} className="btn-ghost text-status-red hover:bg-status-red/10" title="Удалить позицию">
            <Trash2 size={15} /> Удалить
          </button>
        ))}
    </div>
  );

  return (
    <Panel
      title={isNew ? "Новая позиция" : base!.name}
      subtitle={
        isNew ? (
          "Заполните поля и нажмите «Создать»"
        ) : (
          <span>
            Создал: {base!.createdByName}
            {base!.archived && <span className="ml-2 rounded-full bg-surface-highest px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">в архиве</span>}
          </span>
        )
      }
      onClose={onClose}
      footer={footer}
    >
      {!isNew && (
        <div className="flex border-b border-outline-variant px-5">
          {(["details", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === t ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t === "details" ? "Детали" : "История"}
            </button>
          ))}
        </div>
      )}

      {tab === "details" ? (
        <div className="space-y-5 px-5 py-5">
          {error && <Banner tone="error">{error}</Banner>}
          {conflict && (
            <Banner tone="warn">
              <span className="flex-1">Позиция была изменена другим пользователем. Обновите данные, чтобы не затереть чужие правки.</span>
              <button onClick={reloadLatest} className="btn-ghost h-8 shrink-0">Обновить</button>
            </Banner>
          )}

          <Section title="Основное">
            <Field label="Задача *">
              {disabled ? (
                <div className="rounded-md border border-outline-variant bg-surface-low px-3 py-2 text-[13px] text-on-surface">
                  <ExpandableText text={form.title || "—"} lines={4} />
                </div>
              ) : (
                <>
                  <AutoTextarea value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={300} />
                  {form.title.length > 200 && <p className="mt-1 text-right text-[11px] text-outline">{form.title.length} / 300</p>}
                </>
              )}
            </Field>
            <Field label="Оценка $">
              <input value={form.cost} onChange={(e) => set("cost", e.target.value)} disabled={disabled} className="input w-full" placeholder="например, 2 млн.$" />
            </Field>
          </Section>

          <Section title="Классификация">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Сегмент">
                <Sel value={form.segmentId} onChange={(v) => set("segmentId", v)} options={refs.segments} disabled={disabled} />
              </Field>
              <Field label="Трек">
                <Sel value={form.trackId} onChange={(v) => set("trackId", v)} options={tracksForSegment} disabled={disabled} />
              </Field>
              <div className="col-span-2">
                <Field label="Привлекательность">
                  <Sel value={form.attractivenessId} onChange={(v) => set("attractivenessId", v)} options={refs.attractiveness.map((a) => ({ ...a, name: ATTRACTIVENESS_LABEL[a.name] ? `${a.name} — ${ATTRACTIVENESS_LABEL[a.name]}` : a.name }))} disabled={disabled} emptyLabel="P0 — Отсутствует (не указана)" />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="Ответственность и срок">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Ответственный">
                  <Sel value={form.responsibleId} onChange={(v) => set("responsibleId", v)} options={refs.users} disabled={disabled || lockResponsible} allowEmpty={!lockResponsible} />
                </Field>
              </div>
              <Field label="Дедлайн">
                <input type="date" value={form.deadline} onChange={(e) => set("deadline", e.target.value)} disabled={disabled} className="input w-full" />
              </Field>
              <Field label="Статус">
                <Sel value={form.statusId} onChange={(v) => set("statusId", v)} options={refs.statuses} disabled={disabled} />
              </Field>
            </div>
          </Section>

          {customColumns.length > 0 && (
            <Section title="Дополнительные поля">
              <div className="grid grid-cols-2 gap-3">
                {customColumns.map((c) => {
                  const v = form.custom[c.id] ?? "";
                  const setV = (val: string) => setForm((f) => ({ ...f, custom: { ...f.custom, [c.id]: val } }));
                  return (
                    <Field key={c.id} label={c.name}>
                      {c.type === "SELECT" ? (
                        <select value={v} onChange={(e) => setV(e.target.value)} disabled={disabled} className="select w-full">
                          <option value="">—</option>
                          {c.options.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={c.type === "DATE" ? "date" : "text"}
                          inputMode={c.type === "NUMBER" ? "decimal" : undefined}
                          value={v}
                          onChange={(e) => setV(e.target.value)}
                          disabled={disabled}
                          className="input w-full"
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title="Комментарий">
            {disabled ? (
              <div className="rounded-md border border-outline-variant bg-surface-low px-3 py-2 text-[13px] text-on-surface">
                <ExpandableText text={form.comment || "—"} lines={6} />
              </div>
            ) : (
              <>
                <AutoTextarea value={form.comment} onChange={(e) => set("comment", e.target.value)} maxLength={2000} minLength={0} className="min-h-[88px]" />
                <p className="mt-1 text-right text-[11px] text-outline">{form.comment.length} / 2000</p>
              </>
            )}
          </Section>

          <div className={`rounded-lg border p-3.5 ${form.operFlag ? "border-status-emerald/40 bg-status-emerald/10" : "border-outline-variant bg-surface-low"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Send size={16} className={form.operFlag ? "text-status-emerald" : "text-outline"} />
                <div>
                  <p className="text-[13px] font-semibold text-on-surface">Отправить куратору</p>
                  <p className="text-[12px] text-on-surface-variant">{form.operFlag ? "Отправлено — позиция попадёт в оперативку" : "Черновик — в оперативку пока не попадёт"}</p>
                </div>
              </div>
              <Switch checked={form.operFlag} onChange={(v) => set("operFlag", v)} disabled={disabled} />
            </div>
          </div>
        </div>
      ) : (
        <div className="px-5 py-5">
          {history === null ? (
            <ul className="space-y-4">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex gap-3">
                  <div className="skeleton h-6 w-6 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-3.5 w-2/3 rounded" />
                    <div className="skeleton h-3.5 w-1/3 rounded" />
                  </div>
                </li>
              ))}
            </ul>
          ) : history.length === 0 ? (
            <p className="text-[13px] text-outline">Изменений пока нет.</p>
          ) : (
            <ul>
              {history.map((e) => (
                <HistoryEntry
                  key={e.id}
                  actorName={e.actor?.name}
                  timestamp={e.timestamp}
                  badge={e.afterSubmission ? "после отправки" : undefined}
                  headline={
                    e.fieldName ? (
                      <>изменил(а) поле «{FIELD_LABEL[e.fieldName] ?? customColumns.find((c) => `custom:${c.id}` === e.fieldName)?.name ?? (e.fieldName.startsWith("custom:") ? "Доп. поле" : e.fieldName)}»</>
                    ) : e.action === "CREATE" ? (
                      "создал(а) позицию"
                    ) : e.action === "ARCHIVE" ? (
                      "отправил(а) в архив"
                    ) : e.action === "RESTORE" ? (
                      "вернул(а) из архива"
                    ) : (
                      e.action
                    )
                  }
                  detail={e.fieldName ? <AuditChange before={showValue(e.fieldName, e.before)} after={showValue(e.fieldName, e.after)} /> : undefined}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function Banner({ tone, children }: { tone: "error" | "warn"; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] ${tone === "error" ? "border-status-red/30 bg-status-red/10 text-status-red" : "border-status-amber/40 bg-status-amber/10 text-amber-800"}`}>
      <AlertTriangle size={15} className="shrink-0" />
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="label-caps">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-on-surface-variant">{label}</label>
      {children}
    </div>
  );
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-status-emerald" : "bg-outline/60"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
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
