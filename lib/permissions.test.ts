import { describe, expect, it } from "vitest";
import {
  canAssignResponsible,
  canCreateItem,
  canDeleteItem,
  canEditItem,
  canExportWorkTable,
  canCreateDirectorates,
  canManageDirectory,
  canManageSegments,
  canManageTracks,
  canManageUser,
  canManageUsers,
  canViewAs,
  canViewItems,
  checkRoleChange,
  isDirectorial,
  type Actor,
} from "@/lib/permissions";

const head: Actor = { id: "u1", role: "HEAD" };
const director: Actor = { id: "d1", role: "DIRECTOR" };
const admin: Actor = { id: "a1", role: "ADMIN" };
const executive: Actor = { id: "e1", role: "EXECUTIVE" };
const tech: Actor = { id: "t1", role: "SYSTEM_ADMIN" };

describe("просмотр и правка позиций", () => {
  it("руководитель видит позиции, но правит только свои (где он ответственный)", () => {
    expect(canViewItems("HEAD")).toBe(true);
    expect(canEditItem(head, { responsibleId: "u1" })).toBe(true);
    expect(canEditItem(head, { responsibleId: "u9" })).toBe(false);
    expect(canEditItem(head, { responsibleId: null })).toBe(false);
  });

  it("директор и админ правят любые позиции, включая без ответственного", () => {
    for (const a of [director, admin]) {
      expect(canEditItem(a, { responsibleId: "u1" })).toBe(true);
      expect(canEditItem(a, { responsibleId: null })).toBe(true);
    }
  });

  it("ЗГД не видит рабочие позиции: только отправленные итоги", () => {
    expect(canViewItems("EXECUTIVE")).toBe(false);
    expect(canEditItem(executive, { responsibleId: "e1" })).toBe(false);
    expect(canCreateItem("EXECUTIVE")).toBe(false);
  });

  it("технический администратор читает позиции, но не правит и не создаёт", () => {
    expect(canViewItems("SYSTEM_ADMIN")).toBe(true);
    expect(canEditItem(tech, { responsibleId: "t1" })).toBe(false);
    expect(canCreateItem("SYSTEM_ADMIN")).toBe(false);
  });

  it("создают позиции руководитель, директор и админ", () => {
    expect(canCreateItem("HEAD")).toBe(true);
    expect(canCreateItem("DIRECTOR")).toBe(true);
    expect(canCreateItem("ADMIN")).toBe(true);
  });

  it("isDirectorial: только директор и админ", () => {
    expect(isDirectorial("DIRECTOR")).toBe(true);
    expect(isDirectorial("ADMIN")).toBe(true);
    for (const r of ["HEAD", "EXECUTIVE", "SYSTEM_ADMIN"]) expect(isDirectorial(r)).toBe(false);
  });
});

describe("назначение ответственного", () => {
  it("директор и админ назначают кого угодно, руководитель — только себя", () => {
    for (const a of [director, admin]) {
      expect(canAssignResponsible(a, "u9")).toBe(true);
      expect(canAssignResponsible(a, null)).toBe(true);
    }
    expect(canAssignResponsible(head, "u1")).toBe(true);
    expect(canAssignResponsible(head, "u9")).toBe(false);
    expect(canAssignResponsible(head, null)).toBe(false);
  });
});

describe("справочники и экспорт", () => {
  it("общие справочники (статусы, привлекательность) — админ и технический администратор", () => {
    expect(canManageDirectory("SYSTEM_ADMIN")).toBe(true);
    expect(canManageDirectory("ADMIN")).toBe(true);
    for (const r of ["DIRECTOR", "HEAD", "EXECUTIVE"] as const) expect(canManageDirectory(r)).toBe(false);
  });

  it("сегменты дирекции — директор, админ, технический администратор; дирекции заводит только админ", () => {
    for (const r of ["DIRECTOR", "ADMIN", "SYSTEM_ADMIN"] as const) expect(canManageSegments(r)).toBe(true);
    for (const r of ["HEAD", "EXECUTIVE"] as const) expect(canManageSegments(r)).toBe(false);
    expect(canCreateDirectorates("ADMIN")).toBe(true);
    expect(canCreateDirectorates("SYSTEM_ADMIN")).toBe(true);
    for (const r of ["DIRECTOR", "HEAD", "EXECUTIVE"] as const) expect(canCreateDirectorates(r)).toBe(false);
  });

  it("экспорт рабочей таблицы: руководитель, директор, админ", () => {
    for (const r of ["HEAD", "DIRECTOR", "ADMIN"] as const) expect(canExportWorkTable(r)).toBe(true);
    expect(canExportWorkTable("SYSTEM_ADMIN")).toBe(false);
    expect(canExportWorkTable("EXECUTIVE")).toBe(false);
  });
});

describe("canDeleteItem", () => {
  it("руководитель удаляет только свои позиции", () => {
    expect(canDeleteItem(head, { responsibleId: "u1", createdById: "u1" })).toBe(true);
    expect(canDeleteItem(head, { responsibleId: "u2", createdById: "u1" })).toBe(false);
  });

  it("директор и админ не удаляют чужие позиции, но удаляют свои", () => {
    for (const a of [director, admin]) {
      expect(canDeleteItem(a, { responsibleId: "u1", createdById: "u1" })).toBe(false);
      expect(canDeleteItem(a, { responsibleId: a.id, createdById: a.id })).toBe(true);
      expect(canDeleteItem(a, { responsibleId: null, createdById: a.id })).toBe(true);
      expect(canDeleteItem(a, { responsibleId: null, createdById: "u1" })).toBe(false);
    }
  });

  it("остальным ролям удалять нельзя", () => {
    expect(canDeleteItem(tech, { responsibleId: "t1", createdById: "t1" })).toBe(false);
    expect(canDeleteItem(executive, { responsibleId: "e1", createdById: "e1" })).toBe(false);
  });
});

describe("управление пользователями", () => {
  it("раздел пользователей открыт директору, админу и техническому администратору", () => {
    for (const r of ["DIRECTOR", "ADMIN", "SYSTEM_ADMIN"] as const) expect(canManageUsers(r)).toBe(true);
    expect(canManageUsers("HEAD")).toBe(false);
    expect(canManageUsers("EXECUTIVE")).toBe(false);
  });

  it("директор ведёт только руководителей (HEAD); админ и технический администратор — всех", () => {
    expect(canManageUser(director, "HEAD")).toBe(true);
    for (const t of ["DIRECTOR", "ADMIN", "EXECUTIVE", "SYSTEM_ADMIN"] as const) expect(canManageUser(director, t)).toBe(false);
    for (const t of ["HEAD", "DIRECTOR", "ADMIN", "EXECUTIVE"] as const) expect(canManageUser(admin, t)).toBe(true);
    expect(canManageUser(tech, "ADMIN")).toBe(true);
    expect(canManageUser(head, "HEAD")).toBe(false);
  });
});

describe("треки", () => {
  it("треки ведут директор, админ и технический администратор", () => {
    for (const r of ["DIRECTOR", "ADMIN", "SYSTEM_ADMIN"] as const) expect(canManageTracks(r)).toBe(true);
    expect(canManageTracks("HEAD")).toBe(false);
    expect(canManageTracks("EXECUTIVE")).toBe(false);
  });
});

describe("смена роли: админ назначает и снимает директоров и ЗГД", () => {
  const headT = { id: "h1", role: "HEAD" as const, isActive: true };
  const dirT = { id: "d2", role: "DIRECTOR" as const, isActive: true };
  const adminT = { id: "a2", role: "ADMIN" as const, isActive: true };

  it("админ назначает руководителя директором или ЗГД и снимает директора", () => {
    expect(checkRoleChange(admin, headT, "DIRECTOR", 2)).toBeNull();
    expect(checkRoleChange(admin, headT, "EXECUTIVE", 2)).toBeNull();
    expect(checkRoleChange(admin, dirT, "HEAD", 2)).toBeNull();
  });

  it("нельзя снять админа с себя и последнего активного админа", () => {
    expect(checkRoleChange(admin, { id: "a1", role: "ADMIN", isActive: true }, "DIRECTOR", 3)).toBe("CANNOT_DEMOTE_SELF");
    expect(checkRoleChange(admin, adminT, "DIRECTOR", 1)).toBe("LAST_ADMIN");
    // отключённого админа снять можно: активных от этого не убавится
    expect(checkRoleChange(admin, { ...adminT, isActive: false }, "HEAD", 1)).toBeNull();
    expect(checkRoleChange(admin, adminT, "HEAD", 2)).toBeNull();
  });

  it("админ не назначает и не снимает технического администратора", () => {
    expect(checkRoleChange(admin, headT, "SYSTEM_ADMIN", 2)).toBe("FORBIDDEN");
    expect(checkRoleChange(admin, { id: "t", role: "SYSTEM_ADMIN", isActive: true }, "HEAD", 2)).toBe("FORBIDDEN");
  });

  it("директор, руководитель и ЗГД роли не меняют", () => {
    for (const a of [director, head, executive]) expect(checkRoleChange(a, headT, "DIRECTOR", 2)).toBe("FORBIDDEN");
  });

  it("технический администратор может любую смену роли", () => {
    expect(checkRoleChange(tech, headT, "SYSTEM_ADMIN", 1)).toBeNull();
    expect(checkRoleChange(tech, adminT, "HEAD", 1)).toBeNull();
  });
});

describe("«Посмотреть как»", () => {
  const A = "dirA";
  const t = (role: "HEAD" | "DIRECTOR" | "ADMIN" | "EXECUTIVE" | "SYSTEM_ADMIN", directorateId: string | null = A, isActive = true) => ({ id: "x", role, directorateId, isActive });
  const adminA = { id: "a1", role: "ADMIN" as const, directorateId: A };
  const directorA = { id: "d1", role: "DIRECTOR" as const, directorateId: A };

  it("админ смотрит глазами руководителя, директора, ЗГД и другого админа — но не технического администратора и не себя", () => {
    for (const r of ["HEAD", "DIRECTOR", "EXECUTIVE", "ADMIN"] as const) expect(canViewAs(adminA, t(r, r === "EXECUTIVE" ? null : "dirB"))).toBe(true);
    expect(canViewAs(adminA, t("SYSTEM_ADMIN"))).toBe(false);
    expect(canViewAs(adminA, { ...t("HEAD"), id: "a1" })).toBe(false);
    expect(canViewAs(adminA, t("HEAD", A, false))).toBe(false);
  });

  it("директор смотрит только глазами руководителей своей дирекции", () => {
    expect(canViewAs(directorA, t("HEAD", A))).toBe(true);
    expect(canViewAs(directorA, t("HEAD", "dirB"))).toBe(false);
    for (const r of ["DIRECTOR", "ADMIN", "EXECUTIVE"] as const) expect(canViewAs(directorA, t(r, A))).toBe(false);
  });

  it("руководитель и ЗГД смотреть глазами других не могут", () => {
    for (const role of ["HEAD", "EXECUTIVE"] as const) expect(canViewAs({ id: "u", role, directorateId: A }, t("HEAD", A))).toBe(false);
  });
});
