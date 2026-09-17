import { TableView } from "@/components/TableView";
import { CreateTrackForm } from "@/components/CreateTrackForm";

export default function TracksPage() {
  return (
    <div>
      <div className="animate-fade-in mx-auto flex max-w-7xl items-start justify-between gap-4 px-6 pt-6">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Треки, задачи и варианты судов</h1>
          <p className="mt-0.5 text-[13px] text-neutral-500">Главный рабочий экран — раздел 40 ТЗ.</p>
        </div>
        <CreateTrackForm />
      </div>
      <TableView />
    </div>
  );
}
