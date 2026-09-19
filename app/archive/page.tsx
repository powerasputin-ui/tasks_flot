import { Suspense } from "react";
import { TableView } from "@/components/TableView";

export default function ArchivePage() {
  return (
    <Suspense fallback={null}>
      <TableView defaultArchive="archived" />
    </Suspense>
  );
}
