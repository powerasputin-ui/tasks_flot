import { TableView } from "@/components/TableView";

export default function TasksPage() {
  return (
    <div>
      <div className="animate-fade-in mx-auto max-w-7xl px-6 pt-6">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Задачи</h1>
      </div>
      <TableView fixedType="TASK" />
    </div>
  );
}
