import { TableView } from "@/components/TableView";

export default function TracksPage() {
  return (
    <div>
      <div className="animate-fade-in mx-auto max-w-7xl px-6 pt-6">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Треки, задачи и варианты судов</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">Главный рабочий экран — раздел 40 ТЗ.</p>
      </div>
      <TableView />
    </div>
  );
}
