import { Suspense } from "react";
import { TrackerView } from "@/components/tracker/TrackerView";

export default function TrackerPage() {
  return (
    <Suspense fallback={null}>
      <TrackerView />
    </Suspense>
  );
}
