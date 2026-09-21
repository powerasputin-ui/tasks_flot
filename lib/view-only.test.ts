import { describe, expect, it } from "vitest";
import { blockedInViewOnly } from "@/lib/view-only";

describe("режим просмотра: что запрещено", () => {
  it("чтение и построение отчётов разрешены", () => {
    expect(blockedInViewOnly("GET", "/api/items")).toBe(false);
    expect(blockedInViewOnly("POST", "/api/report")).toBe(false);
    expect(blockedInViewOnly("POST", "/api/cycles/abc123/report")).toBe(false);
    expect(blockedInViewOnly("POST", "/api/view-as")).toBe(false);
    expect(blockedInViewOnly("POST", "/api/auth/logout")).toBe(false);
  });

  it("любые изменения запрещены", () => {
    for (const [m, p] of [["POST", "/api/items"], ["PATCH", "/api/items/1"], ["DELETE", "/api/items/1"], ["POST", "/api/cycles"], ["POST", "/api/cycles/1/finalize"], ["POST", "/api/cycles/1/review"], ["POST", "/api/report-templates"], ["PUT", "/api/table-columns"], ["POST", "/api/notifications/read-all"], ["POST", "/api/users"]] as const) {
      expect(blockedInViewOnly(m, p)).toBe(true);
    }
  });

  it("страницы (не API) не блокируются", () => {
    expect(blockedInViewOnly("POST", "/operativka")).toBe(false);
  });
});
