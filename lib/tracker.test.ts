import { describe, expect, it } from "vitest";
import { buildEvents, columnOf, motionOf, phasesOf, statusForColumn, summarize, timelineRange, type RawAudit } from "@/lib/tracker";
import { buildSentTracker, buildZgdTracker, MEMO_PUBLICATION } from "@/lib/tracker-sent";
import type { ArchiveRow } from "@/lib/archive-table";
import { canSetStatus } from "@/lib/permissions";

const names = { status: new Map([["s1", "В работе"], ["s2", "На проверке"]]), user: new Map([["u1", "Майков Т.Г."], ["u2", "Сухов В.А."]]) };
const ev = (p: Partial<RawAudit>): RawAudit => ({ entityId: "i1", action: "UPDATE", fieldName: null, before: null, after: null, timestamp: "2026-10-07T10:00:00.000Z", who: "Майков Т.Г.", ...p });

describe("трекер: колонки", () => {
  const cols = new Map<string, "TODO" | "DOING" | "REVIEW" | "DONE" | "HIDDEN" | null>([["s1", "DOING"], ["s2", "REVIEW"], ["s3", null]]);
  it("колонка по статусу; без статуса и без колонки — «Сделать»", () => {
    expect(columnOf("s1", cols)).toBe("DOING");
    expect(columnOf("s2", cols)).toBe("REVIEW");
    expect(columnOf("s3", cols)).toBe("TODO");
    expect(columnOf(null, cols)).toBe("TODO");
  });
  it("перенос в колонку ставит первый статус этой колонки", () => {
    const st = [{ id: "a", trackerColumn: "TODO" as const }, { id: "b", trackerColumn: "DOING" as const }, { id: "c", trackerColumn: "DOING" as const }];
    expect(statusForColumn("DOING", st)).toBe("b");
    expect(statusForColumn("DONE", st)).toBeNull();
  });
  it("«Выполнено» ставит и снимает только директор/админ", () => {
    expect(canSetStatus("HEAD", "DOING", "REVIEW")).toBe(true);
    expect(canSetStatus("HEAD", "REVIEW", "DONE")).toBe(false);
    expect(canSetStatus("HEAD", "DONE", "DOING")).toBe(false);
    expect(canSetStatus("DIRECTOR", "REVIEW", "DONE")).toBe(true);
    expect(canSetStatus("ADMIN", "DONE", "DOING")).toBe(true);
  });
});

describe("трекер: события", () => {
  it("журнал → понятные события; сдвиг срока позже помечен", () => {
    const e = buildEvents(
      [
        ev({ action: "CREATE" }),
        ev({ action: "STATUS_CHANGE", fieldName: "statusId", before: "s1", after: "s2", timestamp: "2026-10-08T09:00:00.000Z" }),
        ev({ action: "DEADLINE_CHANGE", fieldName: "deadline", before: "2026-10-09T00:00:00.000Z", after: "2026-10-20T00:00:00.000Z", timestamp: "2026-10-09T09:00:00.000Z" }),
        ev({ action: "OPER_FLAG_CHANGE", fieldName: "operFlag", before: "false", after: "true", timestamp: "2026-10-09T10:00:00.000Z" }),
        ev({ action: "OWNER_CHANGE", fieldName: "responsibleId", before: "u1", after: "u2", timestamp: "2026-10-09T11:00:00.000Z" }),
      ],
      [{ at: "2026-10-10T08:00:00.000Z", title: "Справка №3", itemIds: ["i1"] }],
      names,
    );
    expect(e.map((x) => x.text)).toEqual([
      "задача создана",
      "статус: В работе → На проверке",
      "срок: 09.10.26 → 20.10.26 (+11 дн.)",
      "подана в справку",
      "ответственный: Майков Т.Г. → Сухов В.А.",
      "вошла в отправленную справку «Справка №3»",
    ]);
    expect(e[2].slip).toBe(11);
  });
  it("смена статуса действием трекера не повторяется отдельной строкой «статус: …», но сама смена остаётся в действии", () => {
    const e = buildEvents([ev({ fieldName: "statusId", before: "s1", after: "s2" }), ev({ fieldName: "workflow:submit", after: "отчёт готов" })], [], names);
    expect(e.map((x) => x.kind)).toEqual(["workflow"]);
    expect(e[0]).toMatchObject({ before: "В работе", after: "На проверке" });
  });
  it("«на проверке N дн.» — от сдачи, а не от прошлой смены статуса", () => {
    const e = buildEvents(
      [
        ev({ action: "CREATE", timestamp: "2026-10-01T10:00:00.000Z" }),
        ev({ fieldName: "statusId", before: null, after: "s1", timestamp: "2026-10-02T10:00:00.000Z" }),
        ev({ fieldName: "statusId", before: "s1", after: "s2", timestamp: "2026-10-10T10:00:00.000Z" }),
        ev({ fieldName: "workflow:submit", after: "отчёт", timestamp: "2026-10-10T10:00:00.040Z" }),
      ],
      [],
      names,
    );
    expect(motionOf(e, "REVIEW", new Date("2026-10-12T11:00:00.000Z")).inColumnDays).toBe(2);
  });
  it("сдали и сразу приняли в ту же минуту — у каждого действия своя смена статуса", () => {
    const e = buildEvents(
      [
        ev({ fieldName: "statusId", before: "s1", after: "s2", timestamp: "2026-10-10T10:00:00.010Z" }),
        ev({ fieldName: "workflow:submit", after: "отчёт", timestamp: "2026-10-10T10:00:00.020Z" }),
        ev({ fieldName: "statusId", before: "s2", after: "s3", timestamp: "2026-10-10T10:00:30.010Z" }),
        ev({ fieldName: "workflow:accept", timestamp: "2026-10-10T10:00:30.020Z" }),
      ],
      [],
      { ...names, status: new Map([...names.status, ["s3", "Завершено"]]) },
    );
    expect(e.map((x) => [x.kind, x.after])).toEqual([["workflow", "На проверке"], ["workflow", "Завершено"]]);
  });
  it("фазы на таймлайне: по сменам статуса, стоп отдельно, закрытая задача обрывается в день закрытия", () => {
    const cols = new Map<string, "TODO" | "DOING" | "REVIEW" | "DONE" | "HIDDEN">([["Не начато", "TODO"], ["В работе", "DOING"], ["На стопе", "DOING"], ["На проверке", "REVIEW"], ["Завершено", "DONE"]]);
    const col = (n: string | null) => (n ? cols.get(n) : null) ?? "TODO";
    const at = (d: string) => `2026-10-${d}T10:00:00.000Z`;
    const evs = [
      { itemId: "i1", at: at("01"), kind: "created" as const, who: null, text: "задача создана" },
      { itemId: "i1", at: at("03"), kind: "status" as const, who: null, text: "", before: "Не начато", after: "В работе" },
      { itemId: "i1", at: at("05"), kind: "workflow" as const, who: null, text: "на стопе", before: "В работе", after: "На стопе" },
      { itemId: "i1", at: at("07"), kind: "workflow" as const, who: null, text: "снята со стопа", before: "На стопе", after: "В работе" },
      { itemId: "i1", at: at("09"), kind: "workflow" as const, who: null, text: "сдана", before: "В работе", after: "На проверке" },
      { itemId: "i1", at: at("11"), kind: "workflow" as const, who: null, text: "принята", before: "На проверке", after: "Завершено" },
    ];
    const r = phasesOf(evs, { status: "Завершено", column: "DONE" }, col, new Date(at("20")).getTime());
    expect(r.phases.map((p) => (p.stop ? "STOP" : p.column))).toEqual(["TODO", "DOING", "STOP", "DOING", "REVIEW"]);
    expect(r.closedAt).toBe(new Date(at("11")).getTime());
    const open = phasesOf(evs.slice(0, 3), { status: "На стопе", column: "DOING" }, col, new Date(at("06")).getTime());
    expect(open.closedAt).toBeNull();
    expect(open.phases[open.phases.length - 1]).toMatchObject({ stop: true, to: new Date(at("06")).getTime() });
  });
  it("заголовок и комментарий одним сохранением — одно событие", () => {
    const e = buildEvents([ev({ fieldName: "title" }), ev({ fieldName: "comment" })], [], names);
    expect(e).toHaveLength(1);
  });
  it("сводка: сдвиги срока и дни без движения (справка движением не считается)", () => {
    const e = buildEvents(
      [
        ev({ fieldName: "deadline", before: "2026-10-01T00:00:00.000Z", after: "2026-10-05T00:00:00.000Z", timestamp: "2026-10-01T09:00:00.000Z" }),
        ev({ fieldName: "deadline", before: "2026-10-05T00:00:00.000Z", after: "2026-10-12T00:00:00.000Z", timestamp: "2026-10-04T09:00:00.000Z" }),
      ],
      [{ at: "2026-10-10T08:00:00.000Z", title: "С", itemIds: ["i1"] }],
      names,
    );
    expect(summarize(e, new Date("2026-10-14T09:00:00.000Z"))).toEqual({ slips: 2, slipDays: 11, idleDays: 10, lastMoveAt: "2026-10-04T09:00:00.000Z" });
  });
  it("ось: с понедельника самой ранней даты до двух недель после позднего срока", () => {
    const r = timelineRange(["2026-10-08T10:00:00.000Z", "2026-10-30T00:00:00.000Z"], new Date("2026-10-14T00:00:00.000Z"));
    expect(new Date(r.from).toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(new Date(r.to).toISOString().slice(0, 10)).toBe("2026-11-09");
  });
});

describe("трекер ЗГД: история по отправленным справкам", () => {
  const row = (o: Partial<ArchiveRow>): ArchiveRow => ({ id: "a", segmentId: "s", segmentName: "Флот", trackName: "Т", name: "Задача", cost: null, attractivenessName: null, attractivenessColor: null, ownerName: "Майков Т.Г.", ownerRole: "HEAD", deadline: "2026-10-09T00:00:00.000Z", deadlineWeek: null, statusName: "В работе", statusColor: null, comment: "c", customValues: {}, submitted: true, inMemo: true, ...o });
  const v = (at: string, rows: ArchiveRow[]) => ({ directorateId: "d", directorateName: "РФ и КЭ", sentAt: at, title: `Справка ${at.slice(5, 10)}`, rows });
  it("разница между справками: статус, перенос срока, ответственный, новая и исчезнувшая задача", () => {
    const r = buildSentTracker([
      v("2026-10-07T10:00:00.000Z", [row({}), row({ id: "b", name: "Удалят" })]),
      v("2026-10-14T10:00:00.000Z", [row({ statusName: "На проверке", deadline: "2026-10-20T00:00:00.000Z", ownerName: "Сухов В.А." }), row({ id: "c", name: "Новая", inMemo: false })]),
    ]);
    const texts = r.events.map((e) => `${e.itemId}: ${e.text}`);
    expect(texts).toEqual(expect.arrayContaining([
      "a: в таблице на 07.10.26 — с этой справки известна история",
      "a: статус: В работе → На проверке",
      "a: срок: 09.10.26 → 20.10.26 (+11 дн.)",
      "a: ответственный: Майков Т.Г. → Сухов В.А.",
      "c: появилась в таблице (справка от 14.10.26)",
      "b: нет в таблице на 14.10.26 (удалена)",
    ]));
    expect(r.events.find((e) => e.kind === "deadline")?.slip).toBe(11);
    // доска — состояние на последнюю справку
    expect(r.rows.map((x) => [x.id, x.statusName])).toEqual([["a", "На проверке"], ["c", "В работе"]]);
    expect(r.since).toBe("2026-10-07T10:00:00.000Z");
  });
  it("подтверждение справкой: блокер и отмена — по снимку задачи, без лишних событий; снятый блок не «залипает»", () => {
    const pub = (at: string, reason: string, state: Record<string, unknown>) => ({ itemId: "a", directorateId: "d", directorateName: "РФ и КЭ", at, who: "Директор Д.Д.", reason, state: { name: "Задача", comment: "c", ownerName: "Майков Т.Г.", statusName: "В работе", deadline: "2026-10-09T00:00:00.000Z", ...state } });
    const r = buildZgdTracker(
      [v("2026-10-07T10:00:00.000Z", [row({})]), v("2026-10-14T10:00:00.000Z", [row({})])],
      [
        pub("2026-10-08T10:00:00.000Z", "заблокировал(а)", { blockedBy: "поставка" }),
        pub("2026-10-14T10:00:01.000Z", MEMO_PUBLICATION, { blockedBy: null, submitted: false }),
      ],
    );
    const texts = r.events.map((e) => e.text);
    expect(texts).toContain("снята со стопа");
    expect(texts.filter((t) => t.includes(MEMO_PUBLICATION))).toEqual([]);
    expect(texts).not.toContain("обновлён текст задачи");
    expect(r.rows[0]).toMatchObject({ blockedBy: null, confirmedBy: "справка от 14.10.26" });
  });
  it("решение директора уходит ЗГД без черновых правок карточки: меняются только статус, приёмка, стоп", () => {
    const r = buildZgdTracker(
      [v("2026-10-07T10:00:00.000Z", [row({ comment: "подтверждённый текст" })])],
      [{ itemId: "a", directorateId: "d", directorateName: "РФ и КЭ", at: "2026-10-09T10:00:00.000Z", who: "Директор Д.Д.", reason: "принял(а) задачу", only: ["statusName", "statusColor", "review", "cancelReason", "blockedBy", "blockedUntil"],
        state: { name: "Задача (черновик руководителя)", comment: "черновой текст", statusName: "Завершено", review: { result: "Отчёт", decision: "ACCEPTED", decidedByName: "Директор Д.Д.", comment: null } } }],
    );
    expect(r.rows[0]).toMatchObject({ name: "Задача", comment: "подтверждённый текст", statusName: "Завершено" });
    expect(r.rows[0].review?.decision).toBe("ACCEPTED");
    expect(r.events.map((e) => e.text)).not.toContain("обновлён текст задачи");
  });
  it("перенос в колонку не выбирает «На стопе» — его ставят только действием с причиной", () => {
    const st = [{ id: "stop", name: "На стопе", trackerColumn: "DOING" as const }, { id: "work", name: "В работе", trackerColumn: "DOING" as const }];
    expect(statusForColumn("DOING", st)).toBe("work");
  });
  it("справка без снимка таблицы не считается «всё удалили»", () => {
    const r = buildSentTracker([v("2026-10-07T10:00:00.000Z", [row({})]), v("2026-10-10T10:00:00.000Z", [])]);
    expect(r.events.some((e) => e.kind === "archived")).toBe(false);
    expect(r.rows).toHaveLength(1);
  });
  it("движение задачи: дни в колонке, переносы, простой, история", () => {
    const e = buildEvents([ev({ action: "CREATE" }), ev({ fieldName: "statusId", before: "s1", after: "s2", timestamp: "2026-10-08T09:00:00.000Z" })], [], names);
    const m = motionOf(e, "REVIEW", new Date("2026-10-12T09:00:00.000Z"));
    expect(m).toMatchObject({ column: "REVIEW", inColumnDays: 4, slips: 0, idleDays: 4 });
    expect(m.history[1]).toBe("08.10.26 — статус: В работе → На проверке (Майков Т.Г.)");
  });
});
