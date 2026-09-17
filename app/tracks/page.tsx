import { TableView } from "@/components/TableView";

export default function TracksPage() {
  return (
    <div>
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <h1 className="text-lg font-semibold">Треки, задачи и варианты судов</h1>
        <p className="text-sm text-neutral-500">Главный рабочий экран — раздел 40 ТЗ.</p>
      </div>
      <TableView />
    </div>
  );
}
