import { describe, expect, it } from "vitest";
import { canPostInChat, canStartChat, chatBlockReason, pairOf, type ChatPerson } from "@/lib/chat-rules";

const p = (id: string, role: string, directorateId: string | null = "d1", isActive = true): ChatPerson => ({ id, role, directorateId, isActive });
const zgd = p("z", "EXECUTIVE", null);
const dir = p("dir", "DIRECTOR");
const head = p("head", "HEAD");
const head2 = p("head2", "HEAD");
const otherHead = p("oh", "HEAD", "d2");
const otherDir = p("od", "DIRECTOR", "d2");
const admin = p("adm", "ADMIN", "d1");
const sys = p("sys", "SYSTEM_ADMIN", null);
const open = { zgdSpoke: false, closed: false };

describe("правила чата", () => {
  it("ЗГД пишет первым любому, кроме техадмина", () => {
    for (const b of [dir, head, otherHead, otherDir, admin, p("z2", "EXECUTIVE", null)]) expect(canStartChat(zgd, b)).toBe(true);
    expect(canStartChat(zgd, sys)).toBe(false);
  });
  it("руководитель ЗГД первым не пишет; отвечает, пока ЗГД писал и диалог не закрыт", () => {
    expect(canStartChat(head, zgd)).toBe(false);
    expect(canPostInChat(head, zgd, open)).toBe(false);
    expect(canPostInChat(head, zgd, { zgdSpoke: true, closed: false })).toBe(true);
    expect(canPostInChat(head, zgd, { zgdSpoke: true, closed: true })).toBe(false);
    expect(chatBlockReason(head, zgd, open)).toMatch(/ЗГД пишет первым/);
  });
  it("директор и админ пишут ЗГД свободно, даже в закрытом диалоге", () => {
    expect(canPostInChat(dir, zgd, open)).toBe(true);
    expect(canPostInChat(admin, zgd, { zgdSpoke: true, closed: true })).toBe(true);
  });
  it("внутри дирекции — свободно; между дирекциями руководитель и директор не пишут", () => {
    expect(canPostInChat(head, head2, open)).toBe(true);
    expect(canPostInChat(head, dir, open)).toBe(true);
    expect(canPostInChat(dir, head, open)).toBe(true);
    expect(canPostInChat(head, otherHead, open)).toBe(false);
    expect(canPostInChat(head, otherDir, open)).toBe(false);
    expect(canPostInChat(dir, otherDir, open)).toBe(false);
    expect(canPostInChat(dir, otherHead, open)).toBe(false);
  });
  it("админ пишет всем и все пишут админу; сам себе и техадмин — нет", () => {
    expect(canPostInChat(admin, otherHead, open)).toBe(true);
    expect(canPostInChat(otherHead, admin, open)).toBe(true);
    expect(canPostInChat(head, head, open)).toBe(false);
    expect(canPostInChat(sys, head, open)).toBe(false);
    expect(canPostInChat(head, sys, open)).toBe(false);
  });
  it("отключённая учётка: писать нельзя ни ей, ни ею", () => {
    const off = p("off", "HEAD", "d1", false);
    expect(canPostInChat(head, off, open)).toBe(false);
    expect(canPostInChat(off, head, open)).toBe(false);
    expect(canPostInChat(zgd, off, open)).toBe(false);
  });
  it("пара нормализуется независимо от порядка", () => {
    expect(pairOf("b", "a")).toEqual({ userAId: "a", userBId: "b" });
    expect(pairOf("a", "b")).toEqual({ userAId: "a", userBId: "b" });
  });
});

import { canAddToChat, canDiscussItem, mentionsIn, nextOwner } from "@/lib/chat-rules";

describe("группы и чат по задаче", () => {
  it("добавлять в группу можно тех, кому вправе писать первым; ЗГД и админ — любых", () => {
    expect(canAddToChat(head, head2)).toBe(true);
    expect(canAddToChat(head, otherHead)).toBe(false);
    expect(canAddToChat(head, zgd)).toBe(false);
    expect(canAddToChat(dir, zgd)).toBe(true);
    expect(canAddToChat(dir, otherHead)).toBe(false);
    expect(canAddToChat(zgd, otherHead)).toBe(true);
    expect(canAddToChat(admin, otherDir)).toBe(true);
    expect(canAddToChat(head, sys)).toBe(false);
  });
  it("владение переходит самому давнему действующему участнику", () => {
    const m = [
      { userId: "a", joinedAt: "2026-01-01" },
      { userId: "b", joinedAt: "2026-01-02", isActive: false },
      { userId: "c", joinedAt: "2026-01-03" },
    ];
    expect(nextOwner(m, "a")).toBe("c");
    expect(nextOwner(m.slice(0, 2), "a")).toBeNull();
  });
  it("чат по задаче: директор своей дирекции, админ, ответственный; не чужой руководитель и не ЗГД", () => {
    const item = { directorateId: "d1", responsibleId: "head" };
    expect(canDiscussItem(dir, item)).toBe(true);
    expect(canDiscussItem(admin, item)).toBe(true);
    expect(canDiscussItem(head, item)).toBe(true);
    expect(canDiscussItem(head2, item)).toBe(false);
    expect(canDiscussItem(otherDir, item)).toBe(false);
    expect(canDiscussItem(zgd, item)).toBe(false);
  });
  it("упоминания: только участники, чьё имя набрано с «@»", () => {
    const members = [{ id: "1", name: "Иванов И.И." }, { id: "2", name: "Петров П.П." }];
    expect(mentionsIn("@Иванов И.И., посмотрите", members)).toEqual(["1"]);
    expect(mentionsIn("Иванов без собаки", members)).toEqual([]);
  });
});
