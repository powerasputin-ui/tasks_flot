"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, EyeOff, FileDown, Info, Merge, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { manualBullet, memoTitle, mergeBullets, sourceText, type BulletFlags, type MemoBullet, type MemoDoc, type SectionDef } from "@/lib/memo";
import type { MemoSource } from "@/lib/memo-load";

type Person = { id: string; name: string; role: string; total: number; sent: number };
type Payload = {
  cycle: { id: string; number: number; status: "OPEN" | "IN_REVIEW" | "FINAL"; deadline: string; meetingDate: string | null };
  editable: boolean;
  doc: MemoDoc;
  version: number;
  flags: Record<string, BulletFlags>;
  sources: MemoSource[];
  notIncluded: MemoSource[];
  submission: Person[];
  directorate: { name: string; shortName: string | null } | null;
  defs: SectionDef[];
  unmappedTracks: string[];
};

/** Плавающая панель действий: появляется при наведении/фокусе поверх поля и не сдвигает текст. */
const PILL = "absolute right-0 z-10 flex items-center gap-0.5 rounded-md border border-outline-variant bg-surface px-0.5 py-0.5 shadow-md opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100";
const ICON = "flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-surface-high hover:text-on-surface disabled:opacity-30 disabled:hover:bg-transparent";
const DANGER = "flex h-6 w-6 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-status-red/10 hover:text-status-red";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/**
 * Редактор справки директора: слева «Подача» и строки, не вошедшие в справку, справа — страница, как она будет в файле.
 * Текст правится прямо на странице; изменения сохраняются сами. Данные строк руководителей не меняются: справка — отдельный текст.
 */
export function MemoEditor({ cycleId, readOnly = false }: { cycleId: string; readOnly?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [doc, setDoc] = useState<MemoDoc | null>(null);
  const [meeting, setMeeting] = useState("");
  const [save, setSave] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const docRef = useRef<MemoDoc | null>(null);
  const meetingRef = useRef("");
  const versionRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const pending = useRef(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/cycles/${cycleId}/memo`);
    if (!r.ok) {
      setError(r.status === 404 ? "Справка недоступна." : "Не удалось загрузить справку.");
      return;
    }
    const d = (await r.json()) as Payload;
    setData(d);
    setDoc(d.doc);
    docRef.current = d.doc;
    versionRef.current = d.version;
    setMeeting(isoDay(d.cycle.meetingDate));
    meetingRef.current = isoDay(d.cycle.meetingDate);
    setSave("saved");
    setError(null);
  }, [cycleId]);

  useEffect(() => {
    load().catch(() => setError("Не удалось загрузить справку."));
  }, [load]);

  // Сохранение без гонок: пока идёт запрос, новые правки ждут и уходят следующим запросом с самой свежей версией текста.
  const saveNow = useCallback(async () => {
    if (inflight.current) {
      pending.current = true;
      return;
    }
    if (!docRef.current) return;
    inflight.current = true;
    try {
      do {
        pending.current = false;
        setSave("saving");
        const res = await fetch(`/api/cycles/${cycleId}/memo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doc: docRef.current, version: versionRef.current, meetingDate: meetingRef.current || null }),
        });
        if (res.ok) versionRef.current = (await res.json()).version;
        else {
          setSave(res.status === 409 ? "conflict" : "error");
          pending.current = false;
          return;
        }
        if (!pending.current) setSave("saved");
      } while (pending.current);
    } catch {
      setSave("error");
    } finally {
      inflight.current = false;
    }
  }, [cycleId]);

  const schedule = useCallback(() => {
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), 800);
  }, [saveNow]);

  // перед уходом со страницы досохраняем
  useEffect(() => {
    const onHide = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void saveNow();
      }
    };
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      onHide();
    };
  }, [saveNow]);

  const change = useCallback(
    (next: MemoDoc) => {
      setDoc(next);
      docRef.current = next;
      schedule();
    },
    [schedule]
  );

  const sourceById = useMemo(() => new Map([...(data?.sources ?? []), ...(data?.notIncluded ?? [])].map((s) => [s.id, s])), [data]);
  const allSources = useMemo(() => [...(data?.sources ?? []), ...(data?.notIncluded ?? [])], [data]);

  if (error) return <p className="surface p-6 text-center text-[13px] text-on-surface-variant">{error}</p>;
  if (!data || !doc) return <div className="skeleton h-64 rounded-lg" />;

  const editable = data.editable && !readOnly;
  // пока новая дата совещания не сохранилась на сервере, заголовок-заглушка считается тут же, чтобы поле не «дёргалось»
  const autoTitle = memoTitle(data.directorate ?? { name: "" }, meeting || null);

  const patchSection = (sid: string, fn: (b: MemoBullet[]) => MemoBullet[]) => change({ ...doc, sections: doc.sections.map((s) => (s.id === sid ? { ...s, bullets: fn(s.bullets) } : s)) });
  const patchBullet = (sid: string, bid: string, patch: Partial<MemoBullet>) => patchSection(sid, (bs) => bs.map((b) => (b.id === bid ? { ...b, ...patch } : b)));
  const moveBullet = (sid: string, i: number, d: -1 | 1) =>
    patchSection(sid, (bs) => {
      const j = i + d;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeSection = (sid: string) => {
    const s = doc.sections.find((x) => x.id === sid);
    if (!s) return;
    const n = s.bullets.length;
    // непустой раздел удаляем только после подтверждения; строки-источники вернутся в «Не вошло в справку»
    if (n > 0 && !window.confirm(`Удалить раздел «${s.title}» и его пункты (${n})? Строки данных вернутся в «Не вошло в справку», написанный вручную текст пропадёт.`)) return;
    change({ ...doc, sections: doc.sections.filter((x) => x.id !== sid) });
  };
  const removeBullet = (sid: string, bid: string) => patchSection(sid, (bs) => bs.filter((b) => b.id !== bid));
  const moveSection = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= doc.sections.length) return;
    const next = [...doc.sections];
    [next[i], next[j]] = [next[j], next[i]];
    change({ ...doc, sections: next });
  };
  const addBullet = (sid: string, text = "", itemIds: string[] = []) => patchSection(sid, (bs) => [...bs, manualBullet(text, itemIds, allSources)]);

  // «не вошло»: строка добавляется пунктом в раздел её трека (или в первый/«Прочие»)
  const addFromSource = (s: MemoSource) => {
    const def = data.defs.find((d) => s.trackId && d.trackIds.includes(s.trackId));
    let target = def ? doc.sections.find((x) => x.id === def.id) : doc.sections.find((x) => x.kind === "other");
    let base = doc;
    if (!target) {
      target = def ? { id: def.id, title: def.title, kind: "section" as const, bullets: [] } : { id: "other", title: "Прочие направления", kind: "other" as const, bullets: [] };
      base = { ...doc, sections: [...doc.sections, target] };
    }
    const tid = target.id;
    change({ ...base, sections: base.sections.map((x) => (x.id === tid ? { ...x, bullets: [...x.bullets, { ...manualBullet(sourceText(s), [s.id], allSources), origin: "auto" as const, edited: false }] } : x)) });
  };

  const setMeetingDate = (v: string) => {
    setMeeting(v);
    meetingRef.current = v;
    schedule();
  };

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    await saveNow();
  };

  const refresh = async () => {
    await flush();
    const r = await fetch(`/api/cycles/${cycleId}/memo/refresh`, { method: "POST" });
    if (r.ok) {
      const d = await r.json();
      setNotice(d.added ? `Добавлено пунктов: ${d.added}.` : "Новых поданных позиций нет.");
      await load();
    } else setError("Не удалось обновить из данных.");
  };

  const acceptSource = async (bid: string) => {
    await flush();
    await fetch(`/api/cycles/${cycleId}/memo/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bulletId: bid }) });
    await load();
  };

  const submitted = data.submission.filter((p) => p.sent > 0).length;
  const missing = data.submission.filter((p) => p.sent === 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-40 lg:self-start">
        <section className="surface p-4">
          <h3 className="label-caps">Подача</h3>
          <p className="mt-1 text-[13px] text-on-surface">
            Подали <span className="font-semibold">{submitted}</span> из {data.submission.length}
          </p>
          {missing.length > 0 && (
            <p className="mt-1 text-[12px] leading-snug text-status-red">
              Не подали: {missing.map((p) => p.name).join(", ")}
            </p>
          )}
        </section>

        <section className="surface p-4">
          <h3 className="label-caps">Не вошло в справку · {data.notIncluded.length}</h3>
          {data.notIncluded.length === 0 ? (
            <p className="mt-1 text-[12px] text-on-surface-variant">Все поданные позиции уже в справке.</p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {data.notIncluded.map((s) => (
                <li key={s.id} className="flex items-start gap-2 rounded-md border border-outline-variant/60 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[12px] leading-snug text-on-surface">{s.title}</p>
                    <p className="text-[11px] text-on-surface-variant">
                      {s.ownerName ?? "без ответственного"}
                      {!s.operFlag && " · не подана"}
                    </p>
                  </div>
                  {editable && (
                    <button onClick={() => addFromSource(s)} className="btn-icon h-6 w-6 shrink-0" title="Добавить пунктом в справку" aria-label="Добавить в справку">
                      <Plus size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-on-surface-variant">
            Оперативное совещание
            <input type="date" value={meeting} onChange={(e) => setMeetingDate(e.target.value)} disabled={!editable} className="input h-8" />
          </label>
          <span className="ml-auto flex items-center gap-2">
            <SaveState state={save} onReload={() => void load()} />
            {editable && (
              <button onClick={() => void refresh()} className="btn-ghost h-8" title="Добавить в справку новые поданные позиции; ваши правки не затрагиваются">
                <RefreshCw size={14} /> Обновить из данных
              </button>
            )}
            <a href={`/api/cycles/${cycleId}/memo/export?format=pdf`} onClick={() => void flush()} className="btn-ghost h-8" download>
              <FileDown size={14} /> PDF
            </a>
            <a href={`/api/cycles/${cycleId}/memo/export?format=docx`} onClick={() => void flush()} className="btn-ghost h-8" download>
              <FileDown size={14} /> Word
            </a>
          </span>
        </div>

        {notice && (
          <p className="mb-3 flex items-center justify-between rounded-md border border-outline-variant bg-surface-low px-3 py-2 text-[13px] text-on-surface">
            {notice}
            <button onClick={() => setNotice(null)} className="text-[12px] font-semibold text-primary hover:underline">Скрыть</button>
          </p>
        )}
        {data.unmappedTracks.length > 0 && (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-status-amber/40 bg-status-amber/10 px-3 py-2 text-[13px] text-on-surface">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-status-amber" />
            <span>
              Треки без раздела справки ({data.unmappedTracks.join(", ")}) попадают в «Прочие направления». Задайте структуру справки в Настройки → «Структура справки».
            </span>
          </p>
        )}

        <article className="mx-auto max-w-[820px] rounded-lg border border-outline-variant bg-surface px-6 py-8 shadow-sm sm:px-12">
          <input
            value={doc.title ?? ""}
            disabled={!editable}
            onChange={(e) => change({ ...doc, title: e.target.value })}
            placeholder={autoTitle}
            aria-label="Заголовок справки"
            className="mb-8 block w-full rounded-sm bg-transparent px-1 text-center text-[15px] font-medium text-on-surface outline-none placeholder:text-on-surface hover:bg-surface-low focus:bg-surface-low"
          />

          {doc.sections.length === 0 && <p className="py-10 text-center text-[13px] text-on-surface-variant">Пока нет поданных позиций. Когда руководители поставят «Опер», нажмите «Обновить из данных».</p>}

          {doc.sections.map((section, si) => {
            const visible = section.bullets.filter((b) => !b.hidden).length;
            return (
              <section key={section.id} className="mb-7">
                <div className="group/item relative mb-1.5 flex items-center gap-2">
                  <span className="text-[15px] font-bold text-on-surface">{si + 1}.</span>
                  <input
                    value={section.title}
                    disabled={!editable}
                    onChange={(e) => change({ ...doc, sections: doc.sections.map((x) => (x.id === section.id ? { ...x, title: e.target.value } : x)) })}
                    className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-[15px] font-bold text-on-surface outline-none hover:bg-surface-low focus:bg-surface-low"
                    aria-label="Название раздела"
                  />
                  {editable && (
                    <span className={`${PILL} -top-3`}>
                      <button onClick={() => moveSection(si, -1)} disabled={si === 0} className={ICON} title="Раздел выше"><ArrowUp size={14} /></button>
                      <button onClick={() => moveSection(si, 1)} disabled={si === doc.sections.length - 1} className={ICON} title="Раздел ниже"><ArrowDown size={14} /></button>
                      <button onClick={() => removeSection(section.id)} className={DANGER} title="Удалить раздел" aria-label="Удалить раздел"><Trash2 size={14} /></button>
                    </span>
                  )}
                </div>

                <ul className="space-y-1">
                  {section.bullets.map((b, bi) => (
                    <BulletRow
                      key={b.id}
                      bullet={b}
                      flags={data.flags[b.id]}
                      editable={editable}
                      canMergeNext={bi < section.bullets.length - 1}
                      sources={b.itemIds.map((id) => sourceById.get(id)).filter((x): x is MemoSource => !!x)}
                      onText={(text) => patchBullet(section.id, b.id, { text, edited: true })}
                      onUp={() => moveBullet(section.id, bi, -1)}
                      onDown={() => moveBullet(section.id, bi, 1)}
                      isFirst={bi === 0}
                      isLast={bi === section.bullets.length - 1}
                      onHide={() => patchBullet(section.id, b.id, { hidden: !b.hidden })}
                      onMerge={() => change(mergeBullets(doc, section.id, b.id, section.bullets[bi + 1].id, allSources))}
                      onAccept={() => void acceptSource(b.id)}
                      onRemove={b.itemIds.length === 0 ? () => removeBullet(section.id, b.id) : undefined}
                    />
                  ))}
                </ul>
                {editable && (
                  <button onClick={() => addBullet(section.id)} className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                    <Plus size={13} /> Добавить пункт
                  </button>
                )}
                {visible === 0 && <p className="text-[12px] text-outline">Пока пусто: добавьте пункт. Пустой раздел в файл не попадёт.</p>}
              </section>
            );
          })}

          {editable && (
            <button
              onClick={() => change({ ...doc, sections: [...doc.sections, { id: `s_${Date.now().toString(36)}`, title: "Новый раздел", kind: "section", bullets: [] }] })}
              className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline"
            >
              <Plus size={14} /> Добавить раздел
            </button>
          )}
        </article>
      </div>
    </div>
  );
}

function SaveState({ state, onReload }: { state: "saved" | "saving" | "error" | "conflict"; onReload: () => void }) {
  if (state === "conflict")
    return (
      <span className="flex items-center gap-2 text-[12px] text-status-red">
        Справку изменили в другом окне.
        <button onClick={onReload} className="font-semibold underline">Обновить</button>
      </span>
    );
  if (state === "error") return <span className="text-[12px] text-status-red">Не сохранено — проверьте соединение</span>;
  return (
    <span className="flex items-center gap-1 text-[12px] text-on-surface-variant">
      {state === "saved" && <Check size={13} className="text-status-emerald" />}
      {state === "saving" ? "Сохраняю…" : "Сохранено"}
    </span>
  );
}

function BulletRow({
  bullet,
  flags,
  editable,
  sources,
  canMergeNext,
  isFirst,
  isLast,
  onText,
  onUp,
  onDown,
  onHide,
  onMerge,
  onAccept,
  onRemove,
}: {
  bullet: MemoBullet;
  flags?: BulletFlags;
  editable: boolean;
  sources: MemoSource[];
  canMergeNext: boolean;
  isFirst: boolean;
  isLast: boolean;
  onText: (t: string) => void;
  onUp: () => void;
  onDown: () => void;
  onHide: () => void;
  onMerge: () => void;
  onAccept: () => void;
  /** Только у пунктов, написанных вручную (без строк-источников): у остальных есть «Скрыть». */
  onRemove?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // высота по тексту
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [bullet.text]);

  return (
    <li className={`group/item relative flex items-start gap-2 rounded-md px-1 ${bullet.hidden ? "opacity-45" : ""}`}>
      <span className="mt-[3px] select-none text-[15px] leading-[1.55] text-on-surface">•</span>
      <div className="min-w-0 flex-1">
        <textarea
          ref={ref}
          value={bullet.text}
          disabled={!editable}
          rows={1}
          onChange={(e) => onText(e.target.value)}
          onBlur={() => {
            if (onRemove && !bullet.text.trim()) onRemove(); // пустой пункт без источников убирается сам
          }}
          className="block w-full resize-none rounded-sm bg-transparent text-[15px] leading-[1.55] text-on-surface outline-none hover:bg-surface-low focus:bg-surface-low"
          aria-label="Текст пункта"
          placeholder="Текст пункта"
        />
        {(flags?.sourceChanged || flags?.sourceMissing || bullet.hidden || (bullet.origin === "manual" && bullet.itemIds.length === 0 && bullet.text.trim())) && (
          <p className="mb-1 flex flex-wrap items-center gap-x-3 text-[11px] text-on-surface-variant">
            {bullet.hidden && <span>скрыт — в файл не идёт</span>}
            {bullet.origin === "manual" && bullet.itemIds.length === 0 && <span>написан вручную</span>}
            {flags?.sourceMissing && <span className="text-status-amber">строку сняли с подачи или удалили</span>}
            {flags?.sourceChanged && (
              <span className="text-status-amber">
                источник изменился{" "}
                {editable && (
                  <button onClick={onAccept} className="font-semibold text-primary hover:underline">
                    принять
                  </button>
                )}
              </span>
            )}
          </p>
        )}
      </div>
      {(sources.length > 0 || editable) && (
        <span className={`${PILL} -top-3`}>
          {sources.length > 0 && (
            <Popover
              align="right"
              width={340}
              trigger={({ toggle }) => (
                <button onClick={toggle} className={ICON} title="Источник: строки данных" aria-label="Источник">
                  <Info size={14} />
                </button>
              )}
            >
              {() => (
                <div className="max-h-80 space-y-3 overflow-y-auto p-3">
                  {sources.map((s) => (
                    <div key={s.id} className="text-[12px] leading-snug">
                      <p className="font-semibold text-on-surface">{s.title}</p>
                      <p className="text-on-surface-variant">
                        {[s.ownerName, s.statusName, s.deadline ? `срок ${fmtDate(s.deadline)}` : null, s.trackName].filter(Boolean).join(" · ")}
                      </p>
                      {s.comment && <p className="mt-1 whitespace-pre-wrap text-on-surface">{s.comment}</p>}
                      <a href={`/table?item=${s.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-primary hover:underline">
                        Открыть строку в таблице
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </Popover>
          )}
          {editable && (
            <>
              <button onClick={onUp} disabled={isFirst} className={ICON} title="Выше" aria-label="Выше"><ArrowUp size={14} /></button>
              <button onClick={onDown} disabled={isLast} className={ICON} title="Ниже" aria-label="Ниже"><ArrowDown size={14} /></button>
              {canMergeNext && (
                <button onClick={onMerge} className={ICON} title="Объединить со следующим пунктом" aria-label="Объединить"><Merge size={14} /></button>
              )}
              <button onClick={onHide} className={ICON} title={bullet.hidden ? "Вернуть в справку" : "Скрыть (в файл не пойдёт)"} aria-label="Скрыть">
                {bullet.hidden ? <Undo2 size={14} /> : <EyeOff size={14} />}
              </button>
              {onRemove && (
                <button onClick={onRemove} className={DANGER} title="Удалить пункт" aria-label="Удалить пункт"><Trash2 size={14} /></button>
              )}
            </>
          )}
        </span>
      )}
    </li>
  );
}
