"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Bell, ArrowUp, EyeOff, FileDown, Info, Merge, Minus, Plus, RefreshCw, Settings2, Trash2, Undo2 } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import { MemoViewSettings } from "@/components/MemoViewSettings";
import { manualBullet, memoTitle, mergeBullets, sectionOf, sourceText, splitTitleDate, type BulletFlags, type MemoBullet, type MemoDoc, type MemoSectionDoc, type SectionDef } from "@/lib/memo";
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

/** Идентификатор раздела, заведённого директором вручную (структурные разделы имеют id вида track:…/segment:…). */
const newSectionId = () => `s_${Date.now().toString(36)}`;

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

// Лист — А4 1:1 при 96dpi (210×297мм), поля 2см и шрифт 11pt — как в выгрузке в Word (lib/memo-export.ts).
const PAGE_W = 794;
const PAGE_H = 1123;
const MARGIN = 76;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const CONTENT_H = PAGE_H - 2 * MARGIN;
const FONT = "11pt";
const LINE = 20;
const MARKER_W = 16;
const MARKER_GAP = 8;
const TEXT_W = CONTENT_W - MARKER_W - MARKER_GAP;
// Высоты служебных блоков листа заданы явно (их элементы имеют ровно такую высоту) — раскладка считает их точно.
const TITLE_TEXT_H = 3 * 20; // название в три строки
const TITLE_H = TITLE_TEXT_H + 4 + 20 + 16; // + дата справа + отступ до первого раздела
const HEADER_H = 28;
const SECTION_GAP = 16;
const BULLET_GAP = 4;
const ADD_H = 26;
const EMPTY_H = 20;
const ADD_SECTION_H = 32;
const EMPTY_DOC_H = 80;
const HINT_H_GUESS = 20;
const TEXT_STYLE = { fontSize: FONT, lineHeight: `${LINE}px`, fontFamily: "inherit" } as const;

/** Фрагмент пункта на одном листе: диапазон [start, end) текста пункта. nlEnd — кусок кончается переводом строки. */
type Frag = { key: string; start: number; end: number; last: boolean; nlEnd: boolean };
type Block =
  | { t: "title"; h: number }
  | { t: "emptyDoc"; h: number }
  | { t: "header"; si: number; gap: number; h: number }
  | { t: "frag"; si: number; bi: number; k: number; start: number; end: number; lines: number; first: boolean; last: boolean; h: number }
  | { t: "addBullet"; si: number; h: number }
  | { t: "emptySection"; si: number; h: number }
  | { t: "addSection"; h: number };
type Layout = { pages: Block[][]; frags: Map<string, Frag[]> };

/** Кэш «начал строк» по тексту — на каждый измеритель свой (пересчитывается только изменённый пункт). */
const lineCaches = new WeakMap<HTMLElement, Map<string, number[]>>();

/**
 * Смещения символов, с которых начинается каждая видимая строка текста в поле шириной TEXT_W: жёсткие переносы
 * (Enter) — по «\n», мягкие — там, где браузер реально перенёс строку в невидимом измерителе с той же вёрсткой.
 */
function measureLineStarts(measurer: HTMLElement, text: string): number[] {
  let cache = lineCaches.get(measurer);
  if (!cache) lineCaches.set(measurer, (cache = new Map()));
  const hit = cache.get(text);
  if (hit) return hit;
  const starts: number[] = [];
  const range = document.createRange();
  let offset = 0;
  for (const para of text.split("\n")) {
    starts.push(offset);
    if (para.length > 0) {
      measurer.textContent = para;
      const node = measurer.firstChild as Text;
      let prevTop: number | null = null;
      for (let i = 0; i < para.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getClientRects()[0];
        if (!rect) continue;
        if (prevTop === null) prevTop = rect.top;
        else if (rect.top > prevTop + LINE / 2) {
          starts.push(offset + i);
          prevTop = rect.top;
        }
      }
    }
    offset += para.length + 1;
  }
  measurer.textContent = "";
  if (cache.size > 500) cache.clear();
  cache.set(text, starts);
  return starts;
}

/** Грубая оценка до появления измерителя (первый кадр). */
function estimateLineStarts(text: string): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const para of text.split("\n")) {
    for (let i = 0; i === 0 || i < para.length; i += 80) starts.push(offset + i);
    offset += para.length + 1;
  }
  return starts;
}

function hasHint(b: MemoBullet, f?: BulletFlags): boolean {
  const emptyByView = !b.text.trim() && b.itemIds.length > 0 && !b.edited;
  return !!(f?.sourceChanged || f?.sourceMissing || b.hidden || emptyByView || (b.origin === "manual" && b.itemIds.length === 0 && b.text.trim()) || (b.edited && b.itemIds.length > 0));
}

/**
 * Раскладка справки по листам как в Word: блоки идут подряд, копится высота листа; пункт режется по строкам —
 * что влезло, остаётся на листе, остальные строки продолжаются вверху следующего. Заголовок раздела не остаётся
 * последней строкой листа — уходит вместе с первой строкой своего пункта.
 */
function buildLayout(
  sections: MemoSectionDoc[],
  opts: { editable: boolean; lineStarts: (text: string) => number[]; tail: (b: MemoBullet) => number }
): Layout {
  const pages: Block[][] = [[]];
  const frags = new Map<string, Frag[]>();
  let used = 0;
  const newPage = () => {
    pages.push([]);
    used = 0;
  };
  const push = (b: Block) => {
    pages[pages.length - 1].push(b);
    used += b.h;
  };
  const put = (b: Block) => {
    if (used > 0 && used + b.h > CONTENT_H) newPage();
    push(b);
  };
  // кнопки редактора — не текст справки: ради них новый лист не заводим, пусть заходят на нижнее поле
  const putControl = (b: Block) => {
    if (used > 0 && used + b.h > CONTENT_H + MARGIN - 8) newPage();
    push(b);
  };

  put({ t: "title", h: TITLE_H });
  if (sections.length === 0) put({ t: "emptyDoc", h: EMPTY_DOC_H });

  sections.forEach((section, si) => {
    const titled = section.kind !== "other" || section.title.trim() !== "";
    if (titled) {
      const first = section.bullets[0];
      const firstNeed = first ? (opts.lineStarts(first.text).length === 1 ? LINE + opts.tail(first) : LINE) : opts.editable ? ADD_H : EMPTY_H;
      if (used > 0 && used + SECTION_GAP + HEADER_H + firstNeed > CONTENT_H) newPage();
      const gap = used > 0 ? SECTION_GAP : 0;
      push({ t: "header", si, gap, h: gap + HEADER_H });
    }

    section.bullets.forEach((b, bi) => {
      const starts = opts.lineStarts(b.text);
      const n = starts.length;
      const tail = opts.tail(b);
      const list: Frag[] = [];
      const add = (line: number, take: number, last: boolean) => {
        const start = starts[line];
        const end = last ? b.text.length : starts[line + take];
        const k = list.length;
        list.push({ key: `${b.id}:${k}`, start, end, last, nlEnd: b.text[end - 1] === "\n" });
        push({ t: "frag", si, bi, k, start, end, lines: take, first: k === 0, last, h: take * LINE + (last ? tail : 0) });
      };
      let line = 0;
      while (line < n) {
        const room = CONTENT_H - used;
        const remaining = n - line;
        const avail = Math.floor(room / LINE);
        if (remaining * LINE + tail <= room || (used === 0 && remaining <= avail)) {
          add(line, remaining, true);
          break;
        }
        // все строки влезают, а подпись под пунктом — нет: последнюю строку уносим вместе с подписью
        const take = remaining <= avail ? remaining - 1 : avail;
        if (take <= 0) {
          newPage();
          continue;
        }
        add(line, take, false);
        line += take;
        newPage();
      }
      frags.set(b.id, list);
    });

    if (opts.editable) putControl({ t: "addBullet", si, h: ADD_H });
    if (!section.bullets.some((b) => !b.hidden)) putControl({ t: "emptySection", si, h: EMPTY_H });
  });

  if (opts.editable) putControl({ t: "addSection", h: ADD_SECTION_H });
  return { pages, frags };
}

/**
 * Редактор справки директора: слева «Подача» и строки, не вошедшие в справку, справа — листы А4, как в файле.
 * Текст правится прямо на листе; изменения сохраняются сами. Данные строк руководителей не меняются: справка — отдельный текст.
 */
export function MemoEditor({ cycleId, readOnly = false }: { cycleId: string; readOnly?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [doc, setDoc] = useState<MemoDoc | null>(null);
  const [meeting, setMeeting] = useState("");
  const [save, setSave] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);
  const [reminded, setReminded] = useState<Set<string>>(new Set());
  const [remindNote, setRemindNote] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100); // масштаб листа в редакторе — как в Word: кнопки +/− или Ctrl+колесо

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

  const sourceById = new Map([...(data?.sources ?? []), ...(data?.notIncluded ?? [])].map((s) => [s.id, s]));
  const allSources = [...(data?.sources ?? []), ...(data?.notIncluded ?? [])];

  // --- Раскладка по листам А4 ---
  // Невидимый измеритель с той же шириной и шрифтом, что поле пункта: по нему находим, где браузер переносит строки.
  const [measurer, setMeasurer] = useState<HTMLDivElement | null>(null);
  const [fontEpoch, setFontEpoch] = useState(0);
  const [hintHeights, setHintHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const taRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const hintEls = useRef(new Map<string, HTMLElement>());
  // где курсор/выделение в пункте — в позициях всего текста пункта, а не куска на листе
  const caretRef = useRef<{ bulletId: string; start: number; end: number } | null>(null);

  const editable = !!data?.editable && !readOnly;
  const layout: Layout | null =
    doc && data
      ? buildLayout(doc.sections, {
          editable,
          lineStarts: (text) => (measurer && fontEpoch >= 0 ? measureLineStarts(measurer, text) : estimateLineStarts(text)),
          tail: (b) => (hasHint(b, data.flags[b.id]) ? hintHeights.get(b.id) ?? HINT_H_GUESS : 0) + BULLET_GAP,
        })
      : null;

  // шрифт Inter подгружается позже первого кадра — после загрузки сбрасываем замеры строк
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (!alive || !measurer) return;
      lineCaches.delete(measurer);
      setFontEpoch((x) => x + 1);
    });
    return () => {
      alive = false;
    };
  }, [measurer]);

  // высота подписи под пунктом («отредактирован», «источник не подан»…) зависит от текста подписи — меряем по факту;
  // на каждый рендер (подписи появляются/исчезают с любой правкой), состояние меняется только при новой высоте
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    let next: Map<string, number> | null = null;
    hintEls.current.forEach((el, id) => {
      const h = el.offsetHeight;
      if (hintHeights.get(id) !== h) {
        next ??= new Map(hintHeights);
        next.set(id, h);
      }
    });
    if (next) setHintHeights(next);
  });

  // Курсор «течёт» между листами: если после пересчёта позиция курсора оказалась в другом куске пункта
  // (допечатали до конца листа, или стёрли и строки вернулись назад) — фокус и курсор переходят туда.
  useLayoutEffect(() => {
    const c = caretRef.current;
    if (!c || !layout) return;
    const frs = layout.frags.get(c.bulletId);
    if (!frs) {
      caretRef.current = null;
      return;
    }
    const active = document.activeElement;
    const activeKey = active instanceof HTMLTextAreaElement ? active.dataset.fragKey : undefined;
    if (!activeKey && active && active !== document.body) return; // человек ушёл в другое поле/кнопку
    if (activeKey && !activeKey.startsWith(`${c.bulletId}:`)) return;
    const fits = (f: Frag) => c.start >= f.start && c.end <= f.end && (f.last || !f.nlEnd || c.end < f.end);
    const target =
      (activeKey ? frs.find((f) => f.key === activeKey && fits(f)) : undefined) ??
      frs.find((f) => c.start >= f.start && c.start < f.end) ??
      frs[frs.length - 1];
    const el = taRefs.current.get(target.key);
    if (!el) return;
    const s = Math.max(0, Math.min(c.start - target.start, el.value.length));
    const e = c.end <= target.end ? Math.max(s, c.end - target.start) : s;
    if (document.activeElement !== el) el.focus();
    if (el.selectionStart !== s || el.selectionEnd !== e) el.setSelectionRange(s, e);
    el.scrollTop = 0;
  });

  if (error) return <p className="surface p-6 text-center text-[13px] text-on-surface-variant">{error}</p>;
  if (!data || !doc || !layout) return <div className="skeleton h-64 rounded-lg" />;

  // пока новая дата совещания не сохранилась на сервере, заголовок-заглушка считается тут же, чтобы поле не «дёргалось»
  const autoTitle = memoTitle(data.directorate ?? { name: "" }, meeting || null);

  const patchSection = (sid: string, fn: (b: MemoBullet[]) => MemoBullet[]) => change({ ...doc, sections: doc.sections.map((s) => (s.id === sid ? { ...s, bullets: fn(s.bullets) } : s)) });
  const patchBullet = (sid: string, bid: string, patch: Partial<MemoBullet>) => patchSection(sid, (bs) => bs.map((b) => (b.id === bid ? { ...b, ...patch } : b)));
  // отменить правку: пункт снова становится «авто» и тут же подхватывает текущий вид справки/данные строки
  const resetBulletText = (sid: string, b: MemoBullet) => {
    const text = b.itemIds.map((id) => sourceById.get(id)).filter((x): x is MemoSource => !!x).map(sourceText).join(" | ");
    if (!text) return;
    patchBullet(sid, b.id, { text, edited: false });
  };
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

  // строки таблицы, которых ещё нет в справке: для «Добавить пункт» — сначала те, что относятся к этому разделу
  const availableFor = (sectionId: string) => {
    const mine = (s: MemoSource) => (sectionOf(s, data.defs)?.id ?? "other") === sectionId;
    const rest = data.notIncluded.filter((s) => !mine(s));
    return [...data.notIncluded.filter(mine), ...rest];
  };
  /**
   * Разделы структуры, которых сейчас нет в справке — их можно вернуть одним кликом. Только те, где в таблице
   * реально есть хотя бы одна строка (пустые треки/сегменты справочника, под которые ещё никто ничего не завёл,
   * не предлагаются — предлагать нечего).
   */
  const missingSections = data.defs.filter((d) => !doc.sections.some((s) => s.id === d.id) && allSources.some((s) => sectionOf(s, data.defs)?.id === d.id));
  const addSection = (def?: SectionDef) => {
    const section = def
      ? { id: def.id, title: def.title, kind: "section" as const, bullets: [] }
      : { id: newSectionId(), title: "Новый раздел", kind: "section" as const, bullets: [] };
    // раздел из структуры встаёт на своё место по порядку справочника, свой — в конец
    const rank = (id: string) => {
      const i = data.defs.findIndex((d) => d.id === id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const at = def ? doc.sections.findIndex((s) => rank(s.id) > rank(def.id)) : -1;
    const nextSections = [...doc.sections];
    nextSections.splice(at === -1 ? nextSections.length : at, 0, section);
    change({ ...doc, sections: nextSections });
  };
  // строку кладём именно в тот раздел, где нажали «Добавить пункт» — это решение человека, автоматика его не переложит
  const addSourceTo = (sid: string, s: MemoSource) =>
    patchSection(sid, (bs) => [...bs, { ...manualBullet(sourceText(s), [s.id], allSources), origin: "auto" as const, edited: false, pinned: true }]);

  // «не вошло»: строка добавляется пунктом в раздел её трека, иначе — сегмента, иначе — в «Прочие»
  const addFromSource = (s: MemoSource) => {
    const def = sectionOf(s, data.defs);
    let target = def ? doc.sections.find((x) => x.id === def.id) : doc.sections.find((x) => x.kind === "other");
    let base = doc;
    if (!target) {
      target = def ? { id: def.id, title: def.title, kind: "section" as const, bullets: [] } : { id: "other", title: "Прочие направления", kind: "other" as const, bullets: [] };
      base = { ...doc, sections: [...doc.sections, target] };
    }
    const tid = target.id;
    // положили сами — pinned: автоматика такой пункт не уберёт, даже если строка не подана
    change({ ...base, sections: base.sections.map((x) => (x.id === tid ? { ...x, bullets: [...x.bullets, { ...manualBullet(sourceText(s), [s.id], allSources), origin: "auto" as const, edited: false, pinned: true }] } : x)) });
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

  // «Вид справки» поменяли: несохранённые правки дописываем, дальше сервер сам пересоберёт структуру и тексты
  const reloadAfterViewChange = async () => {
    await flush();
    await load();
  };

  const ZOOM_MIN = 50;
  const ZOOM_MAX = 200;
  const zoomBy = (delta: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) / 10) * 10)));
  // масштаб — только с зажатым Ctrl/⌘, как в Word/браузере; обычная прокрутка листа работает как обычно
  const onPagesWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z - Math.sign(e.deltaY) * 10)));
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
  // напоминание не подавшим: приходит самому человеку в уведомления (по одному или всем сразу)
  const remind = async (ids?: string[]) => {
    setReminding(true);
    setRemindNote(null);
    try {
      const r = await fetch(`/api/cycles/${cycleId}/remind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids ? { userIds: ids } : {}) });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setRemindNote("Не удалось отправить напоминание.");
        return;
      }
      const targets = ids ?? missing.map((p) => p.id);
      setReminded((prev) => new Set([...prev, ...targets]));
      setRemindNote(d.sent > 0 ? `Напоминание отправлено: ${d.sent}.` : "Недавно уже напоминали — повторим не раньше, чем через 30 минут.");
      if (d.sent > 0 && d.skippedRecent > 0) setRemindNote(`Отправлено: ${d.sent}. Ещё ${d.skippedRecent} напоминали недавно.`);
    } finally {
      setReminding(false);
    }
  };
  const missing = data.submission.filter((p) => p.sent === 0);

  /** Правка текста пункта с запоминанием курсора в позициях всего пункта — по ним курсор найдёт свой лист. */
  const setBulletText = (sid: string, bid: string, text: string, caretStart: number, caretEnd = caretStart) => {
    caretRef.current = { bulletId: bid, start: caretStart, end: caretEnd };
    patchBullet(sid, bid, { text, edited: true });
  };
  const focusFrag = (bid: string, f: Frag, pos: number) => {
    caretRef.current = { bulletId: bid, start: pos, end: pos };
    const el = taRefs.current.get(f.key);
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos - f.start, pos - f.start);
  };

  const renderBlock = (blk: Block) => {
    switch (blk.t) {
      case "title": {
        // название по центру (переносится на несколько строк), дата совещания — отдельной строкой справа, как в файле
        const shown = splitTitleDate(doc.title?.trim() ? doc.title : autoTitle);
        const auto = splitTitleDate(autoTitle);
        const date = shown.date || auto.date;
        return (
          <div key="title" style={{ height: blk.h }}>
            <textarea
              value={doc.title?.trim() ? shown.main : ""}
              disabled={!editable}
              rows={3}
              onChange={(e) => {
                const main = e.target.value.replace(/\n/g, " ");
                // пусто — заголовок снова собирается сам; иначе название + дата совещания
                change({ ...doc, title: main.trim() ? `${main}${date ? ` к ОС ${date}` : ""}` : "" });
              }}
              placeholder={auto.main}
              aria-label="Заголовок справки"
              style={{ ...TEXT_STYLE, height: TITLE_TEXT_H }}
              className="block w-full resize-none overflow-hidden rounded-sm bg-transparent px-1 text-center font-medium text-on-surface outline-none placeholder:text-on-surface hover:bg-surface-low focus:bg-surface-low"
            />
            <p style={{ ...TEXT_STYLE, height: LINE }} className="mt-1 px-1 text-right font-medium text-on-surface">
              {date}
            </p>
          </div>
        );
      }
      case "emptyDoc":
        return (
          <p key="emptyDoc" style={{ height: blk.h }} className="pt-6 text-center text-[13px] text-on-surface-variant">
            Пока нет поданных позиций. Когда руководители поставят «Опер», нажмите «Обновить из данных».
          </p>
        );
      case "header": {
        const si = blk.si;
        const section = doc.sections[si];
        const no = doc.sections.slice(0, si).filter((x) => x.kind !== "other" || x.title.trim() !== "").length + 1;
        return (
          <div key={`h:${section.id}`} style={{ height: HEADER_H, marginTop: blk.gap }} className="group/item relative flex items-center gap-2">
            <span style={TEXT_STYLE} className="font-bold text-on-surface">{no}.</span>
            <input
              value={section.title}
              disabled={!editable}
              onChange={(e) => change({ ...doc, sections: doc.sections.map((x) => (x.id === section.id ? { ...x, title: e.target.value } : x)) })}
              style={TEXT_STYLE}
              className="min-w-0 flex-1 rounded-sm bg-transparent px-1 font-bold text-on-surface outline-none hover:bg-surface-low focus:bg-surface-low"
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
        );
      }
      case "frag": {
        const section = doc.sections[blk.si];
        const b = section.bullets[blk.bi];
        const bi = blk.bi;
        const frs = layout.frags.get(b.id) ?? [];
        const prev = frs[blk.k - 1];
        const next = frs[blk.k + 1];
        const fragKey = `${b.id}:${blk.k}`;
        return (
          <div key={fragKey} style={{ height: blk.h }}>
            <BulletFragment
              bullet={b}
              value={b.text.slice(blk.start, blk.end)}
              fragKey={fragKey}
              lines={blk.lines}
              first={blk.first}
              last={blk.last}
              flags={data.flags[b.id]}
              editable={editable}
              canMergeNext={bi < section.bullets.length - 1}
              sources={b.itemIds.map((id) => sourceById.get(id)).filter((x): x is MemoSource => !!x)}
              registerTextarea={(el) => {
                if (el) taRefs.current.set(fragKey, el);
                else taRefs.current.delete(fragKey);
              }}
              registerHint={(el) => {
                if (el) hintEls.current.set(b.id, el);
                else hintEls.current.delete(b.id);
              }}
              onEdit={(v, s, e) => setBulletText(section.id, b.id, b.text.slice(0, blk.start) + v + b.text.slice(blk.end), blk.start + s, blk.start + e)}
              onSelectRange={(s, e) => {
                caretRef.current = { bulletId: b.id, start: blk.start + s, end: blk.start + e };
              }}
              onBackspaceAtStart={() => setBulletText(section.id, b.id, b.text.slice(0, blk.start - 1) + b.text.slice(blk.start), blk.start - 1)}
              onDeleteAtEnd={() => setBulletText(section.id, b.id, b.text.slice(0, blk.end) + b.text.slice(blk.end + 1), blk.end)}
              onPrev={prev ? () => focusFrag(b.id, prev, prev.nlEnd ? prev.end - 1 : prev.end) : undefined}
              onNext={next ? () => focusFrag(b.id, next, next.start) : undefined}
              onBlurOut={() => {
                caretRef.current = null;
                if (b.itemIds.length === 0 && !b.text.trim()) removeBullet(section.id, b.id); // пустой ручной пункт убирается сам
              }}
              onUp={() => moveBullet(section.id, bi, -1)}
              onDown={() => moveBullet(section.id, bi, 1)}
              isFirst={bi === 0}
              isLast={bi === section.bullets.length - 1}
              onHide={() =>
                // возвращая пункт, у которого сама справка его скрыла (источник не подан/в архиве) — закрепляем,
                // иначе при следующей загрузке та же проверка снова его спрячет
                patchBullet(section.id, b.id, b.hidden && data.flags[b.id]?.sourceMissing ? { hidden: false, pinned: true } : { hidden: !b.hidden })
              }
              onMerge={() => change(mergeBullets(doc, section.id, b.id, section.bullets[bi + 1].id, allSources))}
              onAccept={() => void acceptSource(b.id)}
              onReset={() => resetBulletText(section.id, b)}
              onRemove={b.itemIds.length === 0 || data.flags[b.id]?.sourceMissing ? () => removeBullet(section.id, b.id) : undefined}
            />
          </div>
        );
      }
      case "addBullet": {
        const section = doc.sections[blk.si];
        return (
          <div key={`a:${section.id}`} style={{ height: blk.h }} className="flex items-center">
            <Popover
              width={420}
              trigger={({ toggle }) => (
                <button onClick={toggle} className="flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                  <Plus size={13} /> Добавить пункт
                </button>
              )}
            >
              {(close) => (
                <AddMenu
                  empty={{ label: "Пустой пункт — напишу сам", onPick: () => addBullet(section.id) }}
                  title="Строки таблицы, которых ещё нет в справке"
                  emptyHint="Все строки таблицы уже в справке."
                  items={availableFor(section.id).map((s) => ({
                    id: s.id,
                    title: s.title,
                    hint: [s.trackName ?? s.segmentName, s.operFlag ? null : "не подана"].filter(Boolean).join(" · "),
                    onPick: () => addSourceTo(section.id, s),
                  }))}
                  close={close}
                />
              )}
            </Popover>
          </div>
        );
      }
      case "emptySection":
        return (
          <p key={`e:${doc.sections[blk.si].id}`} style={{ height: blk.h }} className="text-[12px] text-outline">
            Пока пусто: добавьте пункт. Пустой раздел в файл не попадёт.
          </p>
        );
      case "addSection":
        return (
          <div key="addSection" style={{ height: blk.h }} className="flex items-end">
            <Popover
              width={420}
              trigger={({ toggle }) => (
                <button onClick={toggle} className="flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
                  <Plus size={14} /> Добавить раздел
                </button>
              )}
            >
              {(close) => (
                <AddMenu
                  empty={{ label: "Свой раздел — назову сам", onPick: () => addSection() }}
                  title="Разделы из таблицы, которых нет в справке"
                  emptyHint="Все разделы таблицы уже в справке."
                  items={missingSections.map((d) => ({ id: d.id, title: d.title, hint: d.trackIds.length ? "трек" : "сегмент", onPick: () => addSection(d) }))}
                  close={close}
                />
              )}
            </Popover>
          </div>
        );
    }
  };

  const pages = layout.pages;

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-40 lg:self-start">
          <section className="surface p-4">
            <h3 className="label-caps">Подача</h3>
            <p className="mt-1 text-[13px] text-on-surface">
              Подали <span className="font-semibold">{submitted}</span> из {data.submission.length}
            </p>
            {missing.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-status-red">Не подали · {missing.length}</p>
                  {data.editable && (
                    <button onClick={() => void remind()} disabled={reminding || readOnly} title={readOnly ? "В режиме просмотра напоминать нельзя — выйдите из режима (меню под вашим именем)" : undefined} className="text-[12px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline">
                      Напомнить всем
                    </button>
                  )}
                </div>
                <ul className="mt-1 divide-y divide-outline-variant/50">
                  {missing.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-on-surface" title={p.name}>
                        {p.name}
                      </span>
                      {data.editable &&
                        (reminded.has(p.id) ? (
                          <span className="shrink-0 text-[11px] text-status-emerald">напомнено</span>
                        ) : (
                          <button onClick={() => void remind([p.id])} disabled={reminding || readOnly} className="btn-ghost h-6 shrink-0 px-2 text-[11px] disabled:opacity-50" title={readOnly ? "В режиме просмотра напоминать нельзя — выйдите из режима (меню под вашим именем)" : "Отправить напоминание в уведомления"}>
                            <Bell size={11} /> Напомнить
                          </button>
                        ))}
                    </li>
                  ))}
                </ul>
                {remindNote && <p className="mt-1.5 text-[11px] leading-snug text-on-surface-variant">{remindNote}</p>}
              </div>
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
                <Popover
                  align="right"
                  width={380}
                  trigger={({ toggle }) => (
                    <button onClick={toggle} className="btn-ghost h-8" title="Что входит в справку: разделы и столбцы таблицы в тексте пункта">
                      <Settings2 size={14} /> Вид справки
                    </button>
                  )}
                >
                  {() => (
                    <div className="max-h-[75vh] overflow-y-auto p-4">
                      {/* галочка применяется сразу: сохраняем настройку и перечитываем справку — на листе всегда настоящий результат */}
                      <MemoViewSettings compact onApplied={() => void reloadAfterViewChange()} />
                    </div>
                  )}
                </Popover>
              )}
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
                У строк указан трек, которого нет в списке треков дирекции ({data.unmappedTracks.join(", ")}) — такие строки идут по разделу сегмента, а если сегмента тоже нет — в «Прочие направления». Проверьте список треков в Настройках.
              </span>
            </p>
          )}

          {/* масштаб — как в Word: визуальный transform, сама вёрстка листов не пересчитывается */}
          <div className="overflow-x-auto">
            <div onWheel={onPagesWheel} style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
              {pages.map((blocks, pi) => (
                <div key={pi} className="mx-auto" style={{ width: PAGE_W }}>
                  {pages.length > 1 && (
                    <p className="mb-1.5 text-center text-[11px] uppercase tracking-wide text-on-surface-variant">Лист {pi + 1} из {pages.length}</p>
                  )}
                  <article
                    className={`overflow-hidden rounded-sm border border-outline-variant bg-surface shadow-sm ${pi < pages.length - 1 ? "mb-8" : ""}`}
                    style={{ width: PAGE_W, height: PAGE_H, padding: MARGIN }}
                  >
                    {blocks.map(renderBlock)}
                  </article>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Измеритель строк: те же ширина, шрифт и правила переноса, что у поля пункта; вне масштабируемого блока. */}
      <div
        ref={setMeasurer}
        aria-hidden
        style={{ ...TEXT_STYLE, position: "fixed", left: -10000, top: 0, width: TEXT_W, visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap", overflowWrap: "break-word" }}
      />

      {/* Масштаб — плавающая панель в левом нижнем углу (как в Word/просмотрщиках PDF), вне трансформированного
          контейнера листов, чтобы сама кнопка не масштабировалась вместе с ними. */}
      <div className="fixed bottom-4 left-4 z-40 flex items-center gap-0.5 rounded-md border border-outline-variant bg-surface px-0.5 py-0.5 shadow-md">
        <button onClick={() => zoomBy(-10)} disabled={zoom <= ZOOM_MIN} className={ICON} title="Уменьшить (Ctrl+колесо)" aria-label="Уменьшить масштаб"><Minus size={14} /></button>
        <button onClick={() => setZoom(100)} className="min-w-[3.5ch] px-1 text-center text-[12px] text-on-surface-variant hover:text-on-surface" title="Сбросить масштаб">{zoom}%</button>
        <button onClick={() => zoomBy(10)} disabled={zoom >= ZOOM_MAX} className={ICON} title="Увеличить (Ctrl+колесо)" aria-label="Увеличить масштаб"><Plus size={14} /></button>
      </div>
    </>
  );
}

/**
 * Меню «что ещё можно добавить»: показывает то, что есть в таблице, но ещё не попало в справку (строки или разделы),
 * плюс вариант завести пустое и написать самому. Так удалённый раздел или строку всегда видно и можно вернуть.
 */
function AddMenu({
  title,
  items,
  empty,
  emptyHint,
  close,
}: {
  title: string;
  items: Array<{ id: string; title: string; hint?: string; onPick: () => void }>;
  empty: { label: string; onPick: () => void };
  emptyHint: string;
  close: () => void;
}) {
  const [q, setQ] = useState("");
  const found = q.trim() ? items.filter((i) => `${i.title} ${i.hint ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())) : items;
  const pick = (fn: () => void) => {
    fn();
    close();
  };
  return (
    <div className="p-2">
      <button onClick={() => pick(empty.onPick)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] font-semibold text-primary hover:bg-primary-soft">
        <Plus size={14} /> {empty.label}
      </button>
      <div className="my-1.5 border-t border-outline-variant" />
      <p className="px-2.5 pb-1 text-[11px] uppercase tracking-wide text-on-surface-variant">{title}</p>
      {items.length === 0 ? (
        <p className="px-2.5 py-2 text-[12px] text-on-surface-variant">{emptyHint}</p>
      ) : (
        <>
          {items.length > 7 && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" autoFocus className="input mb-1 h-8 w-full" />
          )}
          <ul className="max-h-72 overflow-y-auto">
            {found.map((i) => (
              <li key={i.id}>
                <button onClick={() => pick(i.onPick)} className="w-full rounded-md px-2.5 py-1.5 text-left hover:bg-surface-high">
                  <span className="block truncate text-[13px] text-on-surface">{i.title}</span>
                  {i.hint && <span className="block truncate text-[11px] text-on-surface-variant">{i.hint}</span>}
                </button>
              </li>
            ))}
            {found.length === 0 && <li className="px-2.5 py-2 text-[12px] text-on-surface-variant">Ничего не нашлось.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

/** Тихое автосохранение: в спокойном состоянии ничего не показываем, чтобы не путать с другими элементами тулбара — важны только процесс и проблемы. */
function SaveState({ state, onReload }: { state: "saved" | "saving" | "error" | "conflict"; onReload: () => void }) {
  if (state === "conflict")
    return (
      <span className="flex items-center gap-2 text-[12px] text-status-red">
        Справку изменили в другом окне.
        <button onClick={onReload} className="font-semibold underline">Обновить</button>
      </span>
    );
  if (state === "error") return <span className="text-[12px] text-status-red">Не сохранено — проверьте соединение</span>;
  if (state === "saving") return <span className="text-[12px] text-on-surface-variant">Сохраняю…</span>;
  return null;
}

/**
 * Кусок пункта на одном листе. Длинный пункт, не влезший в лист, состоит из нескольких кусков на соседних листах;
 * каждый правит свой диапазон общего текста. Маркер «•» — у первого куска, подпись о состоянии пункта — у последнего.
 */
function BulletFragment({
  bullet,
  value,
  fragKey,
  lines,
  first,
  last,
  flags,
  editable,
  sources,
  canMergeNext,
  isFirst,
  isLast,
  registerTextarea,
  registerHint,
  onEdit,
  onSelectRange,
  onBackspaceAtStart,
  onDeleteAtEnd,
  onPrev,
  onNext,
  onBlurOut,
  onUp,
  onDown,
  onHide,
  onMerge,
  onAccept,
  onReset,
  onRemove,
}: {
  bullet: MemoBullet;
  value: string;
  fragKey: string;
  lines: number;
  first: boolean;
  last: boolean;
  flags?: BulletFlags;
  editable: boolean;
  sources: MemoSource[];
  canMergeNext: boolean;
  isFirst: boolean;
  isLast: boolean;
  registerTextarea: (el: HTMLTextAreaElement | null) => void;
  registerHint: (el: HTMLElement | null) => void;
  onEdit: (value: string, selStart: number, selEnd: number) => void;
  onSelectRange: (selStart: number, selEnd: number) => void;
  onBackspaceAtStart: () => void;
  onDeleteAtEnd: () => void;
  /** Перейти в конец куска на предыдущем листе / в начало куска на следующем. */
  onPrev?: () => void;
  onNext?: () => void;
  /** Фокус ушёл из пункта совсем (а не на соседний лист). */
  onBlurOut: () => void;
  onUp: () => void;
  onDown: () => void;
  onHide: () => void;
  onMerge: () => void;
  onAccept: () => void;
  /** Заменить текст пункта на собранный из текущих данных/вида справки и снять пометку «отредактирован». */
  onReset: () => void;
  /** У ручных пунктов (без источника) и у пунктов с пропавшим источником — насовсем убрать из справки (строка таблицы не трогается). */
  onRemove?: () => void;
}) {
  // пункт собрался из строки, но в «Виде справки» не отмечено ничего текстового — объясняем, почему он пустой
  const emptyByView = !bullet.text.trim() && bullet.itemIds.length > 0 && !bullet.edited;
  const showHint = last && hasHint(bullet, flags);
  // кнопки действий пункта попадают в Tab только пока фокус внутри пункта: иначе на странице сотни лишних остановок
  const [inside, setInside] = useState(false);
  const tab = inside ? 0 : -1;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const s = el.selectionStart;
    const collapsed = s === el.selectionEnd;
    if (!collapsed) return;
    if (!first && s === 0) {
      if (e.key === "Backspace" && editable) {
        e.preventDefault();
        onBackspaceAtStart();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowUp") && onPrev) {
        e.preventDefault();
        onPrev();
      }
    } else if (!last && s === el.value.length && e.key === "Delete" && editable) {
      e.preventDefault();
      onDeleteAtEnd();
    } else if (!last && (e.key === "ArrowRight" || e.key === "ArrowDown") && onNext) {
      // курсор не сдвинулся (уже на последней строке куска) или ушёл за скрытый перевод строки в конце — на следующий лист
      const hiddenFrom = el.value.endsWith("\n") ? el.value.length : el.value.length + 1;
      requestAnimationFrame(() => {
        if (document.activeElement !== el) return;
        if (el.selectionStart >= hiddenFrom || (el.selectionStart === s && el.selectionEnd === s)) onNext();
      });
    }
  };

  return (
    <div
      className={`group/item relative flex items-start ${bullet.hidden ? "opacity-45" : ""}`}
      style={{ columnGap: MARKER_GAP }}
      onFocus={() => setInside(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setInside(false);
      }}
    >
      <span className="shrink-0 select-none text-on-surface" style={{ ...TEXT_STYLE, width: MARKER_W }}>
        {first ? "•" : ""}
      </span>
      <div style={{ width: TEXT_W }}>
        <textarea
          ref={registerTextarea}
          value={value}
          disabled={!editable}
          data-frag-key={fragKey}
          wrap="soft"
          spellCheck
          onChange={(e) => onEdit(e.target.value, e.target.selectionStart, e.target.selectionEnd)}
          onSelect={(e) => onSelectRange(e.currentTarget.selectionStart, e.currentTarget.selectionEnd)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            e.currentTarget.scrollTop = 0; // строки куска всегда видны целиком — поле не прокручивается
          }}
          onBlur={(e) => {
            const el = e.currentTarget;
            // фокус перешёл на соседний кусок того же пункта или поле пересоздаётся при переносе на другой лист — это не уход
            setTimeout(() => {
              const now = document.activeElement;
              const stay = now instanceof HTMLTextAreaElement && now.dataset.fragKey?.startsWith(`${bullet.id}:`);
              if (el.isConnected && !stay) onBlurOut();
            }, 0);
          }}
          style={{ ...TEXT_STYLE, display: "block", width: TEXT_W, height: lines * LINE, padding: 0, border: 0, resize: "none", overflow: "hidden" }}
          className="rounded-sm bg-transparent text-on-surface outline-none hover:bg-surface-low focus:bg-surface-low"
          aria-label="Текст пункта"
          placeholder={first ? "Текст пункта" : undefined}
        />
        {showHint && (
          <p ref={registerHint} className="flex flex-wrap items-center gap-x-3 pb-1 pt-0.5 text-[11px] text-on-surface-variant">
            {bullet.hidden && !flags?.sourceMissing && <span>скрыт — в файл не идёт</span>}
            {emptyByView && <span>пусто по текущему «Виду справки» — в файл не пойдёт</span>}
            {bullet.origin === "manual" && bullet.itemIds.length === 0 && <span>написан вручную</span>}
            {bullet.edited && bullet.itemIds.length > 0 && (
              <span>
                отредактирован — не обновляется автоматически{" "}
                {editable && (
                  <button onClick={onReset} className="font-semibold text-primary hover:underline">
                    вернуть текст из данных
                  </button>
                )}
              </span>
            )}
            {flags?.sourceMissing && (
              <span className="text-status-amber">
                {flags.sourceMissing === "unsubmitted" ? "источник не подан" : "строка в архиве"} — в файл не попадёт
                {editable && (
                  <>
                    {" · "}
                    <button onClick={onHide} className="font-semibold text-primary hover:underline">
                      вернуть в справку
                    </button>
                    {" · "}
                    <button onClick={onRemove} className="font-semibold text-primary hover:underline">
                      убрать совсем
                    </button>
                  </>
                )}
              </span>
            )}
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
                <button tabIndex={tab} onClick={toggle} className={ICON} title="Источник: строки данных" aria-label="Источник">
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
              <button tabIndex={tab} onClick={onUp} disabled={isFirst} className={ICON} title="Выше" aria-label="Выше"><ArrowUp size={14} /></button>
              <button tabIndex={tab} onClick={onDown} disabled={isLast} className={ICON} title="Ниже" aria-label="Ниже"><ArrowDown size={14} /></button>
              {canMergeNext && (
                <button tabIndex={tab} onClick={onMerge} className={ICON} title="Объединить со следующим пунктом" aria-label="Объединить"><Merge size={14} /></button>
              )}
              <button tabIndex={tab} onClick={onHide} className={ICON} title={bullet.hidden ? "Вернуть в справку" : "Скрыть (в файл не пойдёт)"} aria-label="Скрыть">
                {bullet.hidden ? <Undo2 size={14} /> : <EyeOff size={14} />}
              </button>
              {onRemove && (
                <button tabIndex={tab} onClick={onRemove} className={DANGER} title="Удалить пункт" aria-label="Удалить пункт"><Trash2 size={14} /></button>
              )}
            </>
          )}
        </span>
      )}
    </div>
  );
}
