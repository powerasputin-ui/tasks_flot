"use client";

import { Info } from "lucide-react";
import { Highlight } from "@/components/ui/Highlight";
import { Popover } from "@/components/ui/Popover";
import { visibleSections, type MemoDoc } from "@/lib/memo";
import type { VersionSource } from "@/lib/memo-archive";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ru-RU") : "—");

/** Справка «как в файле» только для чтения: заголовок, нумерованные разделы, пункты; у пункта — карточка источника. */
export function MemoReader({ title, doc, sources, query }: { title: string; doc: MemoDoc; sources: VersionSource[]; query?: string }) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const sections = visibleSections(doc);
  return (
    <article className="mx-auto max-w-[820px] rounded-lg border border-outline-variant bg-surface px-6 py-8 shadow-sm sm:px-12">
      <h2 className="mb-8 text-center text-[15px] font-medium text-on-surface">{title}</h2>
      {sections.length === 0 && <p className="py-8 text-center text-[13px] text-on-surface-variant">В справке нет пунктов.</p>}
      {sections.map((section, si) => (
        <section key={section.id} className="mb-7">
          <h3 className="mb-1.5 text-[15px] font-bold text-on-surface">
            {si + 1}. {section.title}
          </h3>
          <ul className="space-y-1">
            {section.bullets.map((b) => {
              const src = b.itemIds.map((id) => byId.get(id)).filter((x): x is VersionSource => !!x);
              return (
                <li key={b.id} className="group/item relative flex items-start gap-2 px-1">
                  <span className="mt-[3px] select-none text-[15px] leading-[1.55] text-on-surface">•</span>
                  <p className="min-w-0 flex-1 whitespace-pre-wrap text-justify text-[15px] leading-[1.55] text-on-surface">
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
                        {() => (
                          <div className="max-h-80 space-y-3 overflow-y-auto p-3">
                            {src.map((s) => (
                              <div key={s.id} className="text-[12px] leading-snug">
                                <p className="font-semibold text-on-surface">{s.title}</p>
                                <p className="text-on-surface-variant">{[s.ownerName, s.statusName, s.deadline ? `срок ${fmtDate(s.deadline)}` : null, s.trackName].filter(Boolean).join(" · ")}</p>
                                {s.comment && <p className="mt-1 whitespace-pre-wrap text-on-surface">{s.comment}</p>}
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
  );
}
