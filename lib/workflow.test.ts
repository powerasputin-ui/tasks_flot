import { describe, expect, it } from "vitest";
import { changedSincePublish } from "@/lib/workflow";

describe("«не подтверждено для ЗГД»", () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 19, 9, 0, 0) + ms);
  it("ни разу не подтверждали — изменена; правка хоть на миллисекунду позже подтверждения — изменена", () => {
    expect(changedSincePublish(at(0), null)).toBe(true);
    expect(changedSincePublish(at(60_000), at(0))).toBe(true);
    // правку сразу после подтверждения (другой человек, автотест) не теряем: допусков нет
    expect(changedSincePublish(at(1), at(0))).toBe(true);
  });
  it("подтвердили после правки или в тот же момент — подтверждена (строки ISO — так же, как даты)", () => {
    expect(changedSincePublish(at(0), at(5))).toBe(false);
    expect(changedSincePublish(at(5), at(5))).toBe(false);
    expect(changedSincePublish(at(5).toISOString(), at(5).toISOString())).toBe(false);
  });
});
