import { describe, expect, it } from "vitest";
import { idsChangedAfterSubmission, type SubmissionEvent } from "@/lib/submission";

const t = (s: string) => new Date(`2026-09-20T${s}:00Z`);
const ev = (o: Partial<SubmissionEvent>): SubmissionEvent => ({ entityId: "a", fieldName: null, after: null, afterSubmission: false, timestamp: t("10:00"), ...o });

describe("idsChangedAfterSubmission", () => {
  it("правка после отправки помечает позицию", () => {
    const r = idsChangedAfterSubmission([ev({ fieldName: "operFlag", after: "true", timestamp: t("10:00") }), ev({ fieldName: "statusId", afterSubmission: true, timestamp: t("11:00") })]);
    expect([...r]).toEqual(["a"]);
  });

  it("после повторной отправки пометка снимается", () => {
    const r = idsChangedAfterSubmission([
      ev({ fieldName: "operFlag", after: "true", timestamp: t("10:00") }),
      ev({ fieldName: "statusId", afterSubmission: true, timestamp: t("11:00") }),
      ev({ fieldName: "operFlag", after: "true", timestamp: t("12:00") }),
    ]);
    expect(r.size).toBe(0);
  });

  it("считает позиции по отдельности", () => {
    const r = idsChangedAfterSubmission([
      ev({ entityId: "a", fieldName: "operFlag", after: "true", timestamp: t("10:00") }),
      ev({ entityId: "b", fieldName: "operFlag", after: "true", timestamp: t("10:00") }),
      ev({ entityId: "b", fieldName: "cost", afterSubmission: true, timestamp: t("10:30") }),
    ]);
    expect([...r]).toEqual(["b"]);
  });
});
