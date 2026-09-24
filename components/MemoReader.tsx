"use client";

import { Info, Table2 } from "lucide-react";
import { Highlight } from "@/components/ui/Highlight";
import { Popover } from "@/components/ui/Popover";
import { splitTitleDate, visibleSections, type MemoDoc } from "@/lib/memo";
import type { VersionSource } from "@/lib/memo-archive";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");
// лист шириной А4 (210мм при 96dpi), поля 2см, шрифт 11pt — как в файле справки и в редакторе
const TEXT = { fontSize: "11pt", lineHeight: "20px" } as const;

/**
 * Справка «как в файле» только для чтения: заголовок, нумерованные разделы, пункты; у пункта — карточка источника.
 * onShowInTable — перейти к строке-источнику в таблице на дату отправки.
 */
export function MemoReader({ title, doc, sources, query, onShowInTable }: { title: string; doc: MemoDoc; sources: VersionSource[]; query?: string; onShowInTable?: (itemId: string) => void }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const sections = visibleSections(doc);
  const head = splitTitleDate(title);
  let no = 0;
  return (
    <div className="overflow-x-auto">
      <article className="mx-auto rounded-sm border border-outline-variant bg-surface shadow-sm" style={{ width: 794, minHeight: 1123, padding: 76 }}>
        <h2 className="text-center font-medium text-on-surface" style={TEXT}>
          {head.main}
        </h2>
        {head.date && (
          <p className="mt-1 text-right font-medium text-on-surface" style={TEXT}>
            {head.date}
          </p>
        )}
        <div className="mb-7" />
        {sections.length === 0 && <p className="py-8 text-center text-[13px] text-on-surface-variant">В справке нет пунктов.</p>}
        {sections.map((section) => (
          <section key={section.id} className="mb-4">
            {section.title.trim() && (
              <h3 className="mb-1 font-bold text-on-surface" style={TEXT}>
                {++no}. {section.title}
              </h3>
            )}
            <ul>
              {section.bullets.map((b) => {
                const src = b.itemIds.map((id) => byId.get(id)).filter((x): x is VersionSource => !!x);
                return (
                  <li key={b.id} className="group/item relative flex items-start gap-2 pb-1">
                    <span className="w-4 shrink-0 select-none text-on-surface" style={TEXT}>
                      •
                    </span>
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-justify text-on-surface" style={TEXT}>
                      <Highlight text={b.text} query={query} />
                    </p>
                    {src.length > 0 && (
                      <span className="absolute -top-3 right-0 z-10 rounded-md border border-outline-variant bg-surface px-0.5 py-0.5 opacity-0 shadow-md transition-opacity group-hover/item:opacity-100 group-focus-within/item:opacity-100">
                        <Popover
                          align="right"
                          width={340}
                          trigger={({ toggle }) => (
                            <button onClick={toggle} className="flex h-6 w-6 items-center justify-center rounded text-on-surface-variant hover:bg-surface-high hover:text-on-surface" title="Источник: строки данных" aria-label="Источник">
                              <Info size={14} />
                            </button>
                          )}
                        >
                          {(close) => (
                            <div className="max-h-80 space-y-3 overflow-y-auto p-3">
                              {src.map((s) => (
                                <div key={s.id} className="text-[12px] leading-snug">
                                  <p className="font-semibold text-on-surface">{s.title}</p>
                                  <p className="text-on-surface-variant">{[s.ownerName, s.statusName, s.deadline ? `срок ${fmtDate(s.deadline)}` : null, s.trackName].filter(Boolean).join(" · ")}</p>
                                  {s.comment && <p className="mt-1 whitespace-pre-wrap text-on-surface">{s.comment}</p>}
                                  {onShowInTable && (
                                    <button
                                      onClick={() => {
                                        close();
                                        onShowInTable(s.id);
                                      }}
                                      className="mt-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                                    >
                                      <Table2 size={12} /> Показать в таблице на дату отправки
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </Popover>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </article>
    </div>
  );
}
