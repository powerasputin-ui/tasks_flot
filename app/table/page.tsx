import { Suspense } from "react";
import { TableView } from "@/components/TableView";

export default function TablePage() {
  return (
    <Suspense fallback={null}>
      <TableView />
    </Suspense>
  );
}
