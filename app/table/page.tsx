import { TableView } from "@/components/TableView";

export default function TablePage() {
  return (
    <div>
      <div className="animate-fade-in px-6 pt-6">
        <h1 className="text-[19px] font-semibold tracking-tight text-neutral-900">Рабочая таблица</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Позиции оперативки. Галка «Опер» отправляет позицию куратору.
        </p>
      </div>
      <TableView />
    </div>
  );
}
