"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Ref = { id: string; name: string };

type TableRow = {
  id: string;
  type: "TRACK" | "TASK" | "VESSEL_OPTION";
  segmentName: string | null;
  trackId: string;
  trackName: string;
  name: string;
  attractivenessName: string | null;
  ownerName: string | null;
  deadline: string | null;
  deadlineWeek: number | null;
  statusName: string | null;
  statusId: string | null;
  operFlag: boolean;
  comment: string | null;
};

const TYPE_LABEL: Record<TableRow["type"], string> = {
  TRACK: "Трек",
  TASK: "Задача",
  VESSEL_OPTION: "Судно",
};

const SORT_OPTIONS = [
  { value: "", label: "Без сортировки" },
  { value: "deadline", label: "Срок" },
  { value: "deadlineWeek", label: "Неделя" },
  { value: "status", label: "Статус" },
  { value: "attractiveness", label: "Привлекательность" },
  { value: "owner", label: "Ответственный" },
  { value: "segment", label: "Сегмент" },
];

export function TableView({ fixedType }: { fixedType?: TableRow["type"] }) {
  const [rows, setRows] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState<Ref[]>([]);
  const [statuses, setStatuses] = useState<Ref[]>([]);
  const [attractiveness, setAttractiveness] = useState<Ref[]>([]);
  const [users, setUsers] = useState<Ref[]>([]);

  const [segmentId, setSegmentId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [attractivenessId, setAttractivenessId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [operFlag, setOperFlag] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    Promise.all([
      fetch("/api/segments").then((r) => r.json()),
      fetch("/api/statuses").then((r) => r.json()),
      fetch("/api/attractiveness").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
    ]).then(([s, st, a, u]) => {
      setSegments(s.segments);
      setStatuses(st.statuses);
      setAttractiveness(a.attractiveness);
      setUsers(u.users);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (fixedType) params.set("type", fixedType);
    if (segmentId) params.set("segmentId", segmentId);
    if (statusId) params.set("statusId", statusId);
    if (attractivenessId) params.set("attractivenessId", attractivenessId);
    if (ownerId) params.set("ownerId", ownerId);
    if (operFlag) params.set("operFlag", operFlag);
    if (sortBy) {
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
    }
    setLoading(true);
    fetch(`/api/table?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .finally(() => setLoading(false));
  }, [fixedType, segmentId, statusId, attractivenessId, ownerId, operFlag, sortBy, sortDir]);

  const isOverdue = useMemo(
    () => (row: TableRow) => {
      if (row.type !== "TASK" || !row.deadline) return false;
      if (row.statusName === "Завершено" || row.statusName === "Не актуально") return false;
      return new Date(row.deadline) < new Date();
    },
    []
  );

  const columns = fixedType ? 10 : 11;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="surface mb-4 flex flex-wrap items-end gap-3 p-4">
        <Select label="Сегмент" value={segmentId} onChange={setSegmentId} options={segments} />
        <Select label="Статус" value={statusId} onChange={setStatusId} options={statuses} />
        <Select label="Привлекательность" value={attractivenessId} onChange={setAttractivenessId} options={attractiveness} />
        <Select label="Ответственный" value={ownerId} onChange={setOwnerId} options={users} />
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Опер-флаг</label>
          <select value={operFlag} onChange={(e) => setOperFlag(e.target.value)} className="select">
            <option value="">Все</option>
            <option value="true">Да</option>
            <option value="false">Нет</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-neutral-500">Сортировка</label>
          <div className="flex gap-1">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="select">
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
              className="select w-9 transition-transform duration-150 active:scale-90"
              title="Направление сортировки"
            >
              {sortDir === "asc" ? "↑" : "↓"}
            </button>
          </div>
        </div>
      </div>

      <div className="surface overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              <Th>Сегмент</Th>
              <Th>Трек</Th>
              {!fixedType && <Th>Тип</Th>}
              <Th>Название</Th>
              <Th>Привлекательность</Th>
              <Th>Ответственный</Th>
              <Th>Срок</Th>
              <Th>Неделя</Th>
              <Th>Статус</Th>
              <Th>Опер</Th>
              <Th>Комментарий</Th>
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[var(--border)]">
                  {Array.from({ length: columns }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="skeleton h-3.5 w-full rounded" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row, i) => (
                <tr
                  key={`${row.type}-${row.id}`}
                  className="row-hover animate-fade-in border-b border-[var(--border)] last:border-0"
                  style={{ animationDelay: `${Math.min(i, 20) * 12}ms` }}
                >
                  <Td>{row.segmentName ?? "—"}</Td>
                  <Td>
                    <Link href={`/tracks/${row.trackId}`} className="link-subtle">
                      {row.trackName}
                    </Link>
                  </Td>
                  {!fixedType && (
                    <Td>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                        {TYPE_LABEL[row.type]}
                      </span>
                    </Td>
                  )}
                  <Td className="max-w-xs truncate" title={row.name}>
                    {row.name}
                  </Td>
                  <Td>{row.attractivenessName ?? "—"}</Td>
                  <Td>{row.ownerName ?? "—"}</Td>
                  <Td className={isOverdue(row) ? "font-medium text-[var(--danger)]" : ""}>
                    {row.deadline ? new Date(row.deadline).toLocaleDateString("ru-RU") : "—"}
                  </Td>
                  <Td>{row.deadlineWeek ?? "—"}</Td>
                  <Td>{row.statusName ?? "—"}</Td>
                  <Td>{row.operFlag ? "да" : "—"}</Td>
                  <Td className="max-w-xs truncate" title={row.comment ?? ""}>
                    {row.comment ?? "—"}
                  </Td>
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-4 py-14 text-center text-[13px] text-neutral-400">
                  Нет записей по выбранным фильтрам.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Ref[];
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-neutral-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        <option value="">Все</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5">{children}</th>;
}

function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td className={`px-4 py-2.5 text-neutral-700 ${className}`} title={title}>
      {children}
    </td>
  );
}
