import { Suspense } from "react";
import { WeeksShell } from "@/components/WeeksShell";

export default function TablePage() {
  return (
    <Suspense fallback={null}>
      <WeeksShell />
    </Suspense>
  );
}
