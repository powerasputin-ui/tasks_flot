"use client";

const FORMATS = [
  { key: "csv", label: "CSV" },
  { key: "xlsx", label: "XLSX" },
  { key: "pdf", label: "PDF" },
] as const;

/** Обычные ссылки на GET-эндпоинты экспорта: браузер сам скачивает файл (Content-Disposition). */
export function ExportMenu({
  endpoint,
  params,
  withPptx = false,
}: {
  endpoint: string;
  params?: URLSearchParams;
  withPptx?: boolean;
}) {
  const formats = withPptx ? [...FORMATS, { key: "pptx", label: "PPTX" } as const] : FORMATS;
  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-[11px] font-medium text-neutral-500">Экспорт</span>
      {formats.map((f) => {
        const q = new URLSearchParams(params);
        q.set("format", f.key);
        return (
          <a key={f.key} href={`${endpoint}?${q.toString()}`} download className="btn-ghost px-2.5 py-1.5 text-[12px]">
            {f.label}
          </a>
        );
      })}
    </div>
  );
}
