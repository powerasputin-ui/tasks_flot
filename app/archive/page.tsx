import { TableView } from "@/components/TableView";

export default function ArchivePage() {
  return (
    <div>
      <div className="animate-fade-in px-6 pt-6">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Архив</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Закрытые и старые позиции: поиск, сортировка, фильтры; позицию можно вернуть в работу.
        </p>
      </div>
      <TableView defaultArchive="archived" />
    </div>
  );
}
