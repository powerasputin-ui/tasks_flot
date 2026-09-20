import { describe, expect, it } from "vitest";
import { canTransition, reminderDue } from "@/lib/cycles";

describe("canTransition", () => {
  it("идёт только вперёд: OPEN → IN_REVIEW → FINAL", () => {
    expect(canTransition("OPEN", "IN_REVIEW")).toBe(true);
    expect(canTransition("IN_REVIEW", "FINAL")).toBe(true);
    expect(canTransition("OPEN", "FINAL")).toBe(false);
    expect(canTransition("IN_REVIEW", "OPEN")).toBe(false);
  });

  it("после FINAL переходов нет", () => {
    expect(canTransition("FINAL", "OPEN")).toBe(false);
    expect(canTransition("FINAL", "IN_REVIEW")).toBe(false);
  });
});

describe("reminderDue", () => {
  const deadline = new Date("2026-10-10T12:00:00Z");

  it("не срабатывает раньше чем за 2 дня до срока", () => {
    expect(reminderDue(deadline, new Date("2026-10-07T11:59:00Z"))).toBe(false);
  });

  it("срабатывает ровно за 2 дня и позже", () => {
    expect(reminderDue(deadline, new Date("2026-10-08T12:00:00Z"))).toBe(true);
    expect(reminderDue(deadline, new Date("2026-10-11T00:00:00Z"))).toBe(true);
  });
});
