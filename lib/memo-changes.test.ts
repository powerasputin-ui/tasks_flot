import { describe, expect, it } from "vitest";
import { describeDiff, diffMemo, isEmptyDiff, stampChanges } from "@/lib/memo-changes";
import type { MemoDoc } from "@/lib/memo";

const doc = (bullets: Array<{ id: string; text: string; hidden?: boolean; changedBy?: string; changedAt?: string }>, title = "Справка"): MemoDoc =>
  ({ title, sections: [{ id: "s1", title: "Раздел", bullets }] }) as unknown as MemoDoc;

describe("журнал правок справки", () => {
  const before = doc([{ id: "a", text: "Один" }, { id: "b", text: "Два", changedBy: "Сухов", changedAt: "2026-10-01T10:00:00.000Z" }, { id: "c", text: "Три" }]);

  it("diffMemo считает изменённые, добавленные, удалённые, скрытые пункты и заголовок", () => {
    const after = doc([{ id: "a", text: "Один!" }, { id: "b", text: "Два", hidden: true }, { id: "d", text: "Новый" }], "Другая");
    expect(diffMemo(before, after)).toEqual({ changed: 1, added: 1, removed: 1, hidden: 1, shown: 0, title: true });
    expect(isEmptyDiff({ ...diffMemo(before, before), meeting: false })).toBe(true);
  });

  it("stampChanges метит только тронутые пункты, у остальных сохраняет прежнюю метку, подделку клиента игнорирует", () => {
    const at = new Date("2026-10-05T09:00:00.000Z");
    const after = doc([{ id: "a", text: "Один!", changedBy: "Подделка" }, { id: "b", text: "Два", changedBy: "Подделка" }, { id: "c", text: "Три" }]);
    const [a, b, c] = stampChanges(before, after, "Майков", at).sections[0].bullets;
    expect(a).toMatchObject({ changedBy: "Майков", changedAt: at.toISOString() });
    expect(b).toMatchObject({ changedBy: "Сухов", changedAt: "2026-10-01T10:00:00.000Z" });
    expect(c.changedBy).toBeUndefined();
  });

  it("describeDiff — по-русски и без пустых частей", () => {
    expect(describeDiff({ changed: 2, added: 0, removed: 0, hidden: 1, shown: 0, title: false, meeting: true })).toBe("изменено пунктов: 2, скрыто: 1, дата совещания");
    expect(describeDiff({ changed: 0, added: 0, removed: 0, hidden: 0, shown: 0, title: false, meeting: false })).toBe("без изменений текста");
  });
});
