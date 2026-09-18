import { describe, expect, it } from "vitest";
import {
  canReadAll,
  canCreateWorkEntity,
  canUpdateWorkEntity,
  canArchiveWorkEntity,
  canManageReferenceData,
  canSetOperFlag,
  canManageOwnership,
  canAccessManagerViews,
  canCreateWeeklyUpdate,
  canEditWeeklyUpdate,
} from "@/lib/permissions";

describe("canReadAll (раздел 35/36/37 ТЗ)", () => {
  it("разрешено всем ролям", () => {
    expect(canReadAll("RESPONSIBLE")).toBe(true);
    expect(canReadAll("CURATOR")).toBe(true);
    expect(canReadAll("MANAGER")).toBe(true);
  });
});

describe("canCreateWorkEntity (раздел 35 ТЗ)", () => {
  it("только Ответственный создаёт Track/Task/VesselOption", () => {
    expect(canCreateWorkEntity("RESPONSIBLE")).toBe(true);
    expect(canCreateWorkEntity("CURATOR")).toBe(false);
    expect(canCreateWorkEntity("MANAGER")).toBe(false);
  });
});

describe("canUpdateWorkEntity (раздел 35/38/39 ТЗ — консервативный дефолт)", () => {
  it("Ответственный может обновлять только свой объект", () => {
    expect(canUpdateWorkEntity("RESPONSIBLE", "user-1", { ownerId: "user-1" })).toBe(true);
  });

  it("Ответственный не может обновлять чужой объект", () => {
    expect(canUpdateWorkEntity("RESPONSIBLE", "user-1", { ownerId: "user-2" })).toBe(false);
  });

  it("ownerId=NULL не даёт автоматический доступ на запись (раздел 38)", () => {
    expect(canUpdateWorkEntity("RESPONSIBLE", "user-1", { ownerId: null })).toBe(false);
  });

  it("Куратор и Руководитель не обновляют рабочие объекты через этот путь", () => {
    expect(canUpdateWorkEntity("CURATOR", "user-1", { ownerId: "user-1" })).toBe(false);
    expect(canUpdateWorkEntity("MANAGER", "user-1", { ownerId: "user-1" })).toBe(false);
  });
});

describe("canArchiveWorkEntity (та же граница, что и update)", () => {
  it("совпадает с canUpdateWorkEntity", () => {
    expect(canArchiveWorkEntity("RESPONSIBLE", "user-1", { ownerId: "user-1" })).toBe(true);
    expect(canArchiveWorkEntity("RESPONSIBLE", "user-1", { ownerId: "user-2" })).toBe(false);
  });
});

describe("canManageReferenceData (раздел 36 ТЗ)", () => {
  it("только Куратор управляет Segment/Attractiveness/Status", () => {
    expect(canManageReferenceData("CURATOR")).toBe(true);
    expect(canManageReferenceData("RESPONSIBLE")).toBe(false);
    expect(canManageReferenceData("MANAGER")).toBe(false);
  });
});

describe("canSetOperFlag (раздел 17/36 ТЗ)", () => {
  it("только Куратор меняет operFlag", () => {
    expect(canSetOperFlag("CURATOR")).toBe(true);
    expect(canSetOperFlag("RESPONSIBLE")).toBe(false);
    expect(canSetOperFlag("MANAGER")).toBe(false);
  });
});

describe("canManageOwnership (подтверждено бизнес-заказчиком)", () => {
  it("только Куратор назначает/меняет/снимает владельца", () => {
    expect(canManageOwnership("CURATOR")).toBe(true);
    expect(canManageOwnership("RESPONSIBLE")).toBe(false);
    expect(canManageOwnership("MANAGER")).toBe(false);
  });
});

describe("canAccessManagerViews (раздел 37 ТЗ)", () => {
  it("Руководитель и Куратор — да, Ответственный — нет", () => {
    expect(canAccessManagerViews("MANAGER")).toBe(true);
    expect(canAccessManagerViews("CURATOR")).toBe(true);
    expect(canAccessManagerViews("RESPONSIBLE")).toBe(false);
  });
});

describe("canCreateWeeklyUpdate (раздел 20 ТЗ)", () => {
  it("только владелец-Ответственный трека создаёт отчёт", () => {
    expect(canCreateWeeklyUpdate("RESPONSIBLE", "user-1", { ownerId: "user-1" })).toBe(true);
    expect(canCreateWeeklyUpdate("RESPONSIBLE", "user-1", { ownerId: "user-2" })).toBe(false);
    expect(canCreateWeeklyUpdate("RESPONSIBLE", "user-1", { ownerId: null })).toBe(false);
    expect(canCreateWeeklyUpdate("CURATOR", "user-1", { ownerId: "user-1" })).toBe(false);
  });
});

describe("canEditWeeklyUpdate (раздел 20 ТЗ — иммутабельность после Submit)", () => {
  it("автор-владелец может редактировать только DRAFT", () => {
    expect(canEditWeeklyUpdate("RESPONSIBLE", "user-1", { authorId: "user-1", status: "DRAFT" })).toBe(true);
    expect(canEditWeeklyUpdate("RESPONSIBLE", "user-1", { authorId: "user-1", status: "SUBMITTED" })).toBe(false);
  });

  it("не автор не может редактировать", () => {
    expect(canEditWeeklyUpdate("RESPONSIBLE", "user-1", { authorId: "user-2", status: "DRAFT" })).toBe(false);
  });

  it("Куратор/Руководитель не редактируют WeeklyUpdate", () => {
    expect(canEditWeeklyUpdate("CURATOR", "user-1", { authorId: "user-1", status: "DRAFT" })).toBe(false);
  });
});
