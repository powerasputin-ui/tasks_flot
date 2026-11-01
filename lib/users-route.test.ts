import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Маршруты /api/users без базы: сессия и prisma подменены, смотрим только, кого и что им позволено вести.
// Аудит 01·H-1: админ (куратор) мог завести технического администратора и сменить ему пароль — права выше своих.
const state = vi.hoisted(() => ({ session: { userId: "a1", role: "ADMIN" as string, directorateId: "dir1" as string | null } }));
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
  operationalItem: { count: vi.fn() },
}));

vi.mock("@/lib/session", () => {
  class AuthError extends Error {}
  return { AuthError, requireFreshSession: async () => state.session, invalidateActor: () => {} };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/dictionaries", () => ({ invalidateDicts: () => {} }));
vi.mock("@/lib/directorates", () => ({ listDirectorates: async () => [{ id: "dir1", isActive: true }] }));
vi.mock("@/lib/auth", () => ({ hashPassword: async (p: string) => `hash:${p}` }));
vi.mock("@/lib/notifications", () => ({ createNotification: async () => {} }));
vi.mock("@/lib/error-log", () => ({ describeError: (e: unknown) => String(e), isFrameworkSignal: () => false, recordErrorQuickly: async () => {} }));

import { POST } from "@/app/api/users/route";
import { PATCH } from "@/app/api/users/[id]/route";

const actAs = (role: string, userId = "a1", directorateId: string | null = "dir1") => {
  state.session = { userId, role, directorateId };
};
const request = (method: string, url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const create = (role: string) => POST(request("POST", "/api/users", { name: "Тест", email: "t@example.com", password: "password1", role }));
const patch = (id: string, body: unknown) => PATCH(request("PATCH", `/api/users/${id}`, body), { params: Promise.resolve({ id }) });
// кого «нашла» база по id в PATCH
const targetIs = (role: string, directorateId: string | null = "dir1") => db.user.findUnique.mockResolvedValue({ role, isActive: true, directorateId });
const created = (role: string) => ({ id: "n1", name: "Тест", email: "t@example.com", role, isActive: true });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/users — кого можно завести", () => {
  it("админ не заводит технического администратора", async () => {
    actAs("ADMIN");
    db.user.findUnique.mockResolvedValue(null);
    const res = await create("SYSTEM_ADMIN");
    expect(res.status).toBe(403);
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it("админ по-прежнему заводит директора, ЗГД и другого админа", async () => {
    actAs("ADMIN");
    for (const role of ["DIRECTOR", "EXECUTIVE", "ADMIN", "HEAD"]) {
      db.user.findUnique.mockResolvedValue(null);
      db.user.create.mockResolvedValue(created(role));
      expect((await create(role)).status).toBe(201);
    }
    expect(db.user.create).toHaveBeenCalledTimes(4);
  });

  it("технический администратор заводит технического администратора", async () => {
    actAs("SYSTEM_ADMIN", "t1"); // дирекция нужна любому, кроме ЗГД: у тех. администратора это «домашняя»
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(created("SYSTEM_ADMIN"));
    expect((await create("SYSTEM_ADMIN")).status).toBe(201);
  });

  it("директор заводит только руководителя", async () => {
    actAs("DIRECTOR", "d1");
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(created("HEAD"));
    expect((await create("HEAD")).status).toBe(201);
    for (const role of ["DIRECTOR", "ADMIN", "EXECUTIVE", "SYSTEM_ADMIN"]) expect((await create(role)).status).toBe(403);
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/users/:id — кого можно вести", () => {
  it("админ не меняет пароль технического администратора", async () => {
    actAs("ADMIN");
    targetIs("SYSTEM_ADMIN", null);
    const res = await patch("t1", { password: "new-password-1" });
    expect(res.status).toBe(403);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("и не отключает его, не переименовывает, не правит флаги и дирекцию", async () => {
    actAs("ADMIN");
    for (const body of [{ isActive: false }, { name: "Другое имя" }, { memoEditor: true }, { submits: true }, { directorateId: "dir1" }]) {
      targetIs("SYSTEM_ADMIN", null);
      expect((await patch("t1", body)).status, JSON.stringify(body)).toBe(403);
    }
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("админ по-прежнему ведёт руководителя: пароль меняется, прежние сессии отзываются", async () => {
    actAs("ADMIN");
    targetIs("HEAD");
    db.user.update.mockResolvedValue(created("HEAD"));
    const res = await patch("h1", { password: "new-password-1" });
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledTimes(1);
    const { data } = db.user.update.mock.calls[0][0];
    expect(data.passwordHash).toBe("hash:new-password-1");
    expect(data.sessionsValidAfter).toBeInstanceOf(Date);
  });

  it("технический администратор ведёт другого технического администратора", async () => {
    actAs("SYSTEM_ADMIN", "t1", null);
    targetIs("SYSTEM_ADMIN", null);
    db.user.update.mockResolvedValue(created("SYSTEM_ADMIN"));
    expect((await patch("t2", { password: "new-password-1" })).status).toBe(200);
  });

  it("директор ведёт только руководителей своей дирекции", async () => {
    actAs("DIRECTOR", "d1");
    targetIs("ADMIN");
    expect((await patch("a2", { name: "Другое имя" })).status).toBe(403);
    targetIs("HEAD", "dir2");
    expect((await patch("h2", { name: "Другое имя" })).status).toBe(404);
    expect(db.user.update).not.toHaveBeenCalled();

    targetIs("HEAD");
    db.user.update.mockResolvedValue(created("HEAD"));
    expect((await patch("h1", { name: "Другое имя" })).status).toBe(200);
  });
});
