"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { startOfISOWeek, endOfISOWeek, getISOWeek } from "date-fns";
import { ExportMenu } from "@/components/ExportMenu";

type ChangeEntry = {
  entityType: string;
  entityId: string;
  entityName: string;
  action: string;
  fieldName: string | null;
  before: string | null;
  after: string | null;
  timestamp: string;
  actorName: string | null;
};

type TrackRef = { id: string; name: string };

type DigestContent = {
  summary: { tracksInProgress: number; tracksStopped: number; changesCount: number; newRecords: number; archivedRecords: number };
  changes: ChangeEntry[];
  bySegment: Array<{ segmentId: string | null; segmentName: string; trackCount: number; statusBreakdown: Record<string, number> }>;
  highAttractiveness: Array<{ id: string; type: string; name: string; trackName: string }>;
  stopped: TrackRef[];
  notRelevant: Array<{ id: string; type: string; name: string }>;
  noUpdate: {
    thisWeek: TrackRef[];
    twoPlusWeeks: Array<TrackRef & { weeksSinceLastUpdate: number }>;
    neverSubmitted: TrackRef[];
  };
  managerHelp: Array<TrackRef & { weekStart: string }>;
};

type WeeklyDigest = {
  id: string;
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  status: "DRAFT" | "FINAL";
  generatedBy: { name: string };
  content: DigestContent;
};

export default function WeeklyDigestPage() {
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const weekStart = startOfISOWeek(now);
  const weekEnd = endOfISOWeek(now);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/weekly-digests");
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    const current = data.weeklyDigests.find(
      (d: WeeklyDigest) => new Date(d.weekStart).getTime() === weekStart.getTime()
    );
    setDigest(current ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/weekly-digests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString() }),
      });
      if (!res.ok) {
        setError("Не удалось сформировать дайджест. Попробуйте ещё раз.");
        return;
      }
      await load();
    } finally {
      setGenerating(false);
    }
  }

  async function markFinal() {
    if (!digest) return;
    setError(null);
    const res = await fetch(`/api/weekly-digests/${digest.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "FINAL" }),
    });
    if (!res.ok) {
      setError("Не удалось зафиксировать финальную версию.");
      return;
    }
    load();
  }

  if (loading) {
    return (
      <div className="w-full px-6 py-6">
        <div className="skeleton h-6 w-1/3 rounded" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="w-full px-6 py-10 text-[13px] text-neutral-500">
        Дайджест недели доступен ролям Куратор и Руководитель (раздел 37 ТЗ).
      </div>
    );
  }

  const c = digest?.content;

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">
            Дайджест недели {getISOWeek(now)}
          </h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">
            {weekStart.toLocaleDateString("ru-RU")} — {weekEnd.toLocaleDateString("ru-RU")} · без AI, раздел 25 ТЗ.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {digest && <ExportMenu endpoint="/api/export/weekly-digest" params={new URLSearchParams({ id: digest.id })} />}
          <button onClick={generate} disabled={generating} className="btn-ghost">
            {generating ? "Формирование…" : digest ? "Обновить" : "Сформировать"}
          </button>
          {digest && digest.status === "DRAFT" && (
            <button onClick={markFinal} className="btn-primary">
              Зафиксировать как финальный
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-[13px] text-[var(--danger)]">{error}</p>}

      {!digest ? (
        <div className="surface p-6 text-center text-[13px] text-neutral-400">
          Дайджест за эту неделю ещё не сформирован.
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 text-[12px] text-neutral-500">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                digest.status === "FINAL" ? "bg-green-50 text-green-700" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {digest.status === "FINAL" ? "Финальный" : "Черновик"}
            </span>
            <span>
              сформировал {digest.generatedBy.name} · {new Date(digest.generatedAt).toLocaleString("ru-RU")}
            </span>
          </div>

          {/* Summary */}
          <SectionBlock title="Итог">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Kpi label="Треков в работе" value={c!.summary.tracksInProgress} />
              <Kpi label="На стопе" value={c!.summary.tracksStopped} />
              <Kpi label="Изменений" value={c!.summary.changesCount} />
              <Kpi label="Новых записей" value={c!.summary.newRecords} />
              <Kpi label="Архивировано" value={c!.summary.archivedRecords} />
            </div>
          </SectionBlock>

          {/* Changes / Weekly Diff */}
          <SectionBlock title={`Изменения за неделю (${c!.changes.length})`}>
            {c!.changes.length === 0 ? (
              <p className="text-[13px] text-neutral-400">Изменений не было.</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {c!.changes.map((ch, i) => (
                  <li key={i} className="text-neutral-600">
                    <span className="text-neutral-400">{new Date(ch.timestamp).toLocaleString("ru-RU")}</span>{" "}
                    — {ch.actorName ?? "система"} · <span className="text-neutral-800">{ch.entityName}</span>{" "}
                    <span className="text-neutral-500">({ch.action}</span>
                    {ch.fieldName && (
                      <span className="text-neutral-500">
                        {" "}
                        {ch.fieldName}: {ch.before ?? "—"} → {ch.after ?? "—"}
                      </span>
                    )}
                    <span className="text-neutral-500">)</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionBlock>

          {/* By Segment */}
          <SectionBlock title="По сегментам">
            <ul className="divide-y divide-[var(--border)] text-[13px]">
              {c!.bySegment.map((s) => (
                <li key={s.segmentId ?? "none"} className="py-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-neutral-800">{s.segmentName}</span>
                    <span className="text-neutral-500">{s.trackCount} треков</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-neutral-400">
                    {Object.entries(s.statusBreakdown)
                      .map(([status, count]) => `${status}: ${count}`)
                      .join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
          </SectionBlock>

          {/* High Attractiveness */}
          <SectionBlock title={`Высокая привлекательность P100 (${c!.highAttractiveness.length})`}>
            <TrackLinkList
              items={c!.highAttractiveness.map((h) => ({ id: h.type === "Track" ? h.id : h.trackName === h.name ? h.id : h.id, name: `${h.name} (${h.type === "Track" ? "трек" : "судно"})`, linkId: h.type === "Track" ? h.id : undefined }))}
            />
          </SectionBlock>

          {/* Stopped */}
          <SectionBlock title={`На стопе (${c!.stopped.length})`}>
            <TrackLinkList items={c!.stopped.map((t) => ({ id: t.id, name: t.name, linkId: t.id }))} />
          </SectionBlock>

          {/* Not Relevant */}
          <SectionBlock title={`Не актуально (${c!.notRelevant.length})`}>
            <TrackLinkList items={c!.notRelevant.map((t) => ({ id: t.id, name: `${t.name} (${t.type})` }))} />
          </SectionBlock>

          {/* No Update */}
          <SectionBlock title="Нет обновлений">
            <div className="space-y-3">
              {c!.noUpdate.twoPlusWeeks.length > 0 && (
                <div>
                  <p className="mb-1 text-[12px] font-medium text-neutral-600">2+ недели без отчёта</p>
                  <TrackLinkList
                    items={c!.noUpdate.twoPlusWeeks.map((t) => ({ id: t.id, name: `${t.name} — ${t.weeksSinceLastUpdate} нед.`, linkId: t.id }))}
                  />
                </div>
              )}
              {c!.noUpdate.neverSubmitted.length > 0 && (
                <div>
                  <p className="mb-1 text-[12px] font-medium text-neutral-600">Никогда не отправляли</p>
                  <TrackLinkList items={c!.noUpdate.neverSubmitted.map((t) => ({ id: t.id, name: t.name, linkId: t.id }))} />
                </div>
              )}
            </div>
          </SectionBlock>

          {/* Manager Help */}
          <SectionBlock title={`Нужна помощь руководителя (${c!.managerHelp.length})`}>
            {c!.managerHelp.length === 0 ? (
              <p className="text-[13px] text-neutral-400">Нет запросов.</p>
            ) : (
              <TrackLinkList items={c!.managerHelp.map((t) => ({ id: t.id, name: t.name, linkId: t.id }))} />
            )}
          </SectionBlock>
        </>
      )}
    </div>
  );
}

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="animate-fade-in mb-6">
      <h2 className="mb-2 text-[13px] font-semibold text-neutral-700">{title}</h2>
      <div className="surface p-4">{children}</div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-2xl font-semibold text-neutral-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}

function TrackLinkList({ items }: { items: Array<{ id: string; name: string; linkId?: string }> }) {
  if (items.length === 0) return <p className="text-[13px] text-neutral-400">Нет записей.</p>;
  return (
    <ul className="divide-y divide-[var(--border)] text-[13px]">
      {items.map((item, i) => (
        <li key={`${item.id}-${i}`} className="row-hover -mx-1 rounded-lg px-1 py-1.5">
          {item.linkId ? (
            <Link href={`/tracks/${item.linkId}`} className="link-subtle">
              {item.name}
            </Link>
          ) : (
            <span className="text-neutral-700">{item.name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
