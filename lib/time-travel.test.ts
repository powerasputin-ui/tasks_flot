import { describe, it, expect } from "vitest";
import { valuesAsOf, existedAt } from "@/lib/time-travel";

const d = (s: string) => new Date(s);

describe("valuesAsOf", () => {
  const current = { statusId: "C", ownerId: "u2" };

  it("откатывает изменения после даты от новых к старым", () => {
    const events = [
      { fieldName: "statusId", before: "A", timestamp: d("2026-08-10") }, // A -> B
      { fieldName: "statusId", before: "B", timestamp: d("2026-09-01") }, // B -> C
    ];
    expect(valuesAsOf(current, events, d("2026-08-05")).statusId).toBe("A");
    expect(valuesAsOf(current, events, d("2026-08-20")).statusId).toBe("B");
    expect(valuesAsOf(current, events, d("2026-09-10")).statusId).toBe("C");
  });

  it("порядок событий во входе не важен", () => {
    const events = [
      { fieldName: "statusId", before: "B", timestamp: d("2026-09-01") },
      { fieldName: "statusId", before: "A", timestamp: d("2026-08-10") },
    ];
    expect(valuesAsOf(current, events, d("2026-08-05")).statusId).toBe("A");
  });

  it("возвращает null, если поле раньше было пустым; другие поля не трогает", () => {
    const events = [{ fieldName: "ownerId", before: null, timestamp: d("2026-09-01") }];
    const r = valuesAsOf(current, events, d("2026-08-01"));
    expect(r.ownerId).toBeNull();
    expect(r.statusId).toBe("C");
  });

  it("игнорирует события без поля (CREATE/ARCHIVE)", () => {
    expect(valuesAsOf(current, [{ fieldName: null, before: null, timestamp: d("2026-09-01") }], d("2026-08-01"))).toEqual(current);
  });
});

describe("existedAt", () => {
  it("создана до даты и не архивирована к дате", () => {
    expect(existedAt(d("2026-08-01"), null, d("2026-08-15"))).toBe(true);
    expect(existedAt(d("2026-08-20"), null, d("2026-08-15"))).toBe(false);
    expect(existedAt(d("2026-08-01"), d("2026-08-10"), d("2026-08-15"))).toBe(false);
    expect(existedAt(d("2026-08-01"), d("2026-08-20"), d("2026-08-15"))).toBe(true);
  });
});
