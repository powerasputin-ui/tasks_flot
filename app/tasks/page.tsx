import { TableView } from "@/components/TableView";

export default function TasksPage() {
  return (
    <div>
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <h1 className="text-lg font-semibold">Задачи</h1>
      </div>
      <TableView fixedType="TASK" />
    </div>
  );
}
