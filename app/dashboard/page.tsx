"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type TrackRef = { id: string; name: string };

type DashboardData = {
  tracksInProgress: number;
  overdueTasks: number;
  activeTasksNoDeadline: number;
  activeTasksNoOwner: number;
  tracksStopped: number;
  changesThisWeek: number;
  noUpdateThisWeek: TrackRef[];
  noUpdate2PlusWeeks: Array<TrackRef & { weeksSinceLastUpdate: number }>;
  neverSubmitted: TrackRef[];
  needManagerHelp: Array<TrackRef & { weekStart: string; submittedAt: string | null }>;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .finally(() => setLoading(false));
  }, []);

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
        Dashboard доступен ролям Куратор и Руководитель (раздел 37 ТЗ).
      </div>
    );
  }

  if (!data) return null;

  const noUpdateTotal = data.noUpdateThisWeek.length + data.noUpdate2PlusWeeks.length + data.neverSubmitted.length;

  return (
    <div className="w-full px-6 py-6">
      <div className="animate-fade-in mb-6">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Dashboard</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Что происходит, что изменилось, что остановилось, где нужно внимание — раздел 45 ТЗ.
        </p>
      </div>

      {/* 1. Status — раздел 80 приоритет */}
      <SectionBlock title="Статус">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Треков в работе" value={data.tracksInProgress} />
          <Kpi label="Треков на стопе" value={data.tracksStopped} tone={data.tracksStopped > 0 ? "warn" : "default"} />
          <Kpi label="Просроченных задач" value={data.overdueTasks} tone={data.overdueTasks > 0 ? "danger" : "default"} />
          <Kpi label="Изменений за неделю" value={data.changesThisWeek} />
        </div>
      </SectionBlock>

      {/* 2. Changes уже отражены в "Изменений за неделю" выше; здесь Problems */}
      <SectionBlock title="Проблемы">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi
            label="Активных задач без срока"
            value={data.activeTasksNoDeadline}
            tone={data.activeTasksNoDeadline > 0 ? "warn" : "default"}
          />
          <Kpi
            label="Задач без ответственного"
            value={data.activeTasksNoOwner}
            tone={data.activeTasksNoOwner > 0 ? "warn" : "default"}
          />
          <Kpi label="Нет обновления 2+ недели" value={data.noUpdate2PlusWeeks.length} tone={data.noUpdate2PlusWeeks.length > 0 ? "danger" : "default"} />
          <Kpi label="Никогда не отправляли отчёт" value={data.neverSubmitted.length} tone={data.neverSubmitted.length > 0 ? "warn" : "default"} />
        </div>

        {noUpdateTotal > 0 && (
          <div className="mt-4 space-y-3">
            {data.noUpdate2PlusWeeks.length > 0 && (
              <TrackIssueList
                title="Нет обновления 2+ недели (раздел 22 ТЗ)"
                items={data.noUpdate2PlusWeeks.map((t) => ({
                  id: t.id,
                  name: t.name,
                  detail: `${t.weeksSinceLastUpdate} нед. без отчёта`,
                }))}
              />
            )}
            {data.neverSubmitted.length > 0 && (
              <TrackIssueList
                title="Никогда не отправляли WeeklyUpdate"
                items={data.neverSubmitted.map((t) => ({ id: t.id, name: t.name, detail: null }))}
              />
            )}
            {data.noUpdateThisWeek.length > 0 && (
              <TrackIssueList
                title="Нет обновления за последнюю неделю"
                items={data.noUpdateThisWeek.map((t) => ({ id: t.id, name: t.name, detail: null }))}
              />
            )}
          </div>
        )}
      </SectionBlock>

      {/* 4. Manager Attention */}
      <SectionBlock title="Требуется внимание руководителя">
        {data.needManagerHelp.length === 0 ? (
          <p className="text-[13px] text-neutral-400">Нет треков, отметивших «нужна помощь руководителя».</p>
        ) : (
          <TrackIssueList
            title=""
            items={data.needManagerHelp.map((t) => ({
              id: t.id,
              name: t.name,
              detail: `неделя от ${new Date(t.weekStart).toLocaleDateString("ru-RU")}`,
            }))}
          />
        )}
      </SectionBlock>
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

function Kpi({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warn" | "danger" }) {
  const color = tone === "danger" ? "text-[var(--danger)]" : tone === "warn" ? "text-amber-600" : "text-neutral-900";
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}

function TrackIssueList({
  title,
  items,
}: {
  title: string;
  items: Array<{ id: string; name: string; detail: string | null }>;
}) {
  return (
    <div>
      {title && <p className="mb-1.5 text-[12px] font-medium text-neutral-600">{title}</p>}
      <ul className="divide-y divide-[var(--border)] text-[13px]">
        {items.map((item) => (
          <li key={item.id} className="row-hover -mx-1 flex items-center justify-between rounded-lg px-1 py-1.5">
            <Link href={`/tracks/${item.id}`} className="link-subtle">
              {item.name}
            </Link>
            {item.detail && <span className="text-[12px] text-neutral-400">{item.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
