"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Presentation, Settings2 } from "lucide-react";
import { MenuItem, Popover } from "@/components/ui/Popover";

type Tpl = { id: string; name: string };
const FORMATS = [
  { key: "xlsx", label: "Excel", icon: <FileSpreadsheet size={15} /> },
  { key: "pdf", label: "PDF", icon: <FileText size={15} /> },
  { key: "pptx", label: "PowerPoint", icon: <Presentation size={15} /> },
] as const;

/** Иконка экспорта в шапке таблицы: быстрый экспорт «как в таблице» и отчёты по шаблонам (Сегмент → Трек и т.п.). */
export function TableExportMenu({ params }: { params?: URLSearchParams }) {
  const [templates, setTemplates] = useState<Tpl[] | null>(null);

  const load = () => {
    if (templates) return;
    fetch("/api/report-templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTemplates((d?.templates ?? []).map((t: Tpl) => ({ id: t.id, name: t.name }))))
      .catch(() => setTemplates([]));
  };
  const table = (format: string) => {
    const q = new URLSearchParams(params);
    q.set("format", format);
    return `/api/export/table?${q.toString()}`;
  };
  const report = (templateId: string, format: string) => `/api/export/report?templateId=${encodeURIComponent(templateId)}&format=${format}`;

  return (
    <Popover
      align="right"
      width={280}
      trigger={({ toggle }) => (
        <button onClick={() => { load(); toggle(); }} className="btn-icon" title="Экспорт" aria-label="Экспорт">
          <Download size={18} />
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="px-3 pt-2 pb-1 text-xs text-slate-500">Таблица как на экране</div>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            {["csv", "xlsx", "pdf"].map((f) => (
              <a key={f} href={table(f)} download onClick={close} className="btn-ghost !py-1 text-xs uppercase">{f}</a>
            ))}
          </div>
          <div className="border-t border-slate-100 px-3 pt-2 pb-1 text-xs text-slate-500">Отчёт по шаблону</div>
          {[{ id: "sys:directorate", name: "Оперативка по дирекции" }, ...(templates ?? []).filter((t) => t.id !== "sys:directorate")].map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-1 text-sm">
              <span className="truncate" title={t.name}>{t.name}</span>
              <span className="flex shrink-0 gap-1">
                {FORMATS.map((f) => (
                  <a key={f.key} href={report(t.id, f.key)} download onClick={close} className="btn-icon !p-1" title={f.label} aria-label={`${t.name}: ${f.label}`}>{f.icon}</a>
                ))}
              </span>
            </div>
          ))}
          <div className="border-t border-slate-100">
            <Link href="/operativka" onClick={close} className="block">
              <MenuItem icon={<Settings2 size={15} />}>Настроить отчёт…</MenuItem>
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
