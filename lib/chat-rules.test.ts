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
