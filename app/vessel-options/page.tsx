import { TableView } from "@/components/TableView";

export default function VesselOptionsPage() {
  return (
    <div>
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <h1 className="text-lg font-semibold">Варианты судов</h1>
      </div>
      <TableView fixedType="VESSEL_OPTION" />
    </div>
  );
}
