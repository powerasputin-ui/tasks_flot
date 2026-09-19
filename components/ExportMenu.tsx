"use client";

import { Download, FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { MenuItem, Popover } from "@/components/ui/Popover";

const FORMATS = [
  { key: "csv", label: "CSV", icon: <FileText size={15} /> },
  { key: "xlsx", label: "Excel (XLSX)", icon: <FileSpreadsheet size={15} /> },
  { key: "pdf", label: "PDF", icon: <FileText size={15} /> },
  { key: "pptx", label: "PowerPoint (PPTX)", icon: <Presentation size={15} /> },
] as const;

/** Кнопка «Экспорт ▾»: ссылки на GET-эндпоинты, браузер сам скачивает файл (Content-Disposition). */
export function ExportMenu({ endpoint, params, withPptx = false }: { endpoint: string; params?: URLSearchParams; withPptx?: boolean }) {
  const formats = withPptx ? FORMATS : FORMATS.filter((f) => f.key !== "pptx");
  return (
    <Popover
      align="right"
      width={220}
      trigger={({ toggle }) => (
        <button onClick={toggle} className="btn-ghost">
          <Download size={15} />
          Экспорт
        </button>
      )}
    >
      {(close) => (
        <div>
          {formats.map((f) => {
            const q = new URLSearchParams(params);
            q.set("format", f.key);
            return (
              <a key={f.key} href={`${endpoint}?${q.toString()}`} download onClick={close} className="block">
                <MenuItem icon={f.icon}>{f.label}</MenuItem>
              </a>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
