/** Equipment-first navigation: the default-off flag gates all three browser routes. */
import { afterEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "tech-1", status: "approved", trialExpiresAt: null })),
}));
vi.mock("@/capabilities/trial-access", () => ({ trialAccessDecision: vi.fn(() => "ok") }));
const tenant = vi.hoisted(() => ({ withTenantContext: vi.fn(async () => { throw new Error("reached the database"); }) }));
vi.mock("@/lib/tenant-context", () => tenant);

import { GET as children } from "../../../app/api/equipment-browser/children/route";
import { GET as search } from "../../../app/api/equipment-browser/search/route";
import { GET as resolve } from "../../../app/api/equipment-browser/resolve/route";

const routes = [
  ["children", children, "http://test/api/equipment-browser/children?parentKind=root"],
  ["search", search, "http://test/api/equipment-browser/search?scopeKind=root&q=VFD1"],
  ["resolve", resolve, `http://test/api/equipment-browser/resolve?targetKind=installed_instance&installedInstanceId=${TENANT}`],
] as const;

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("MIRA_EQUIPMENT_NAV", () => {
  for (const [name, GET, url] of routes) {
    it(`${name}: off (unset) answers 404 equipment_nav_disabled without touching the database`, async () => {
      vi.stubEnv("MIRA_EQUIPMENT_NAV", "");
      const res = await GET(new Request(url));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "equipment_nav_disabled" });
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(tenant.withTenantContext).not.toHaveBeenCalled();
    });

    it(`${name}: on reaches the read path`, async () => {
      vi.stubEnv("MIRA_EQUIPMENT_NAV", "1");
      vi.stubEnv("AUTH_SECRET", "flag-route-test");
      const res = await GET(new Request(url));
      expect(res.status).not.toBe(404);
      expect(tenant.withTenantContext).toHaveBeenCalled();
    });
  }

  it("treats any value other than 1/true as off", async () => {
    vi.stubEnv("MIRA_EQUIPMENT_NAV", "yes");
    const res = await children(new Request(routes[0][2]));
    expect(res.status).toBe(404);
  });
});
