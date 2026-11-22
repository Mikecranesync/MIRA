import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() } }));
import pool from "@/lib/db";
import { publicSignupPolicy } from "@/capabilities/free-technician-signup";
import { ensureUserAndTenant } from "@/lib/users";
import { GET } from "@/app/api/public/signup-policy/route";
import { ONBOARDING_VERSION } from "@/capabilities/onboarding-policy";
import { PILOT_WINDOW_DAYS } from "@/lib/config";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("MIRA_FREE_TECHNICIANS", "false"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0"); });
afterEach(() => vi.unstubAllEnvs());
describe("public onboarding policy", () => {
    it.each([undefined, "false", "TRUE", "1"])("never enables the permanent offer from ambiguous flag %s", flag => { vi.stubEnv("MIRA_FREE_TECHNICIANS", flag); expect(publicSignupPolicy()).toMatchObject({ kind: "trial", trialDays: PILOT_WINDOW_DAYS }); });
    it("keeps personal and reviewed-pilot policy separate", () => { vi.stubEnv("MIRA_FREE_TECHNICIANS", "true"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1"); expect(publicSignupPolicy().kind).toBe("free_technician"); expect(publicSignupPolicy("pilot").kind).toBe("pilot_application"); });
    it("ordinary constructors cannot create a free identity even with a generic verified flag", async () => { vi.stubEnv("MIRA_FREE_TECHNICIANS", "true"); await expect(ensureUserAndTenant({ email: "new@example.test", verifiedEmail: true })).rejects.toThrow("Verify your email"); expect(pool.connect).not.toHaveBeenCalled(); });
    it("reports environment-specific policy and agreement without a session or database write", async () => { vi.stubEnv("MIRA_FREE_TECHNICIANS", "true"); vi.stubEnv("MIRA_MARKETING_ORIGIN", "https://staging.factorylm.com"); const response = GET(); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull(); expect(await response.json()).toMatchObject({ kind: "free_technician", agreementVersion: ONBOARDING_VERSION, policyUrl: "https://staging.factorylm.com/free-technicians" }); expect(pool.query).not.toHaveBeenCalled(); });
    it.each([["false", "0"], ["false", "1"], ["true", "0"], ["true", "1"]])("explicit pilot policy with free=%s review=%s", async (free, pilot) => { vi.stubEnv("MIRA_FREE_TECHNICIANS", free); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", pilot); expect((await GET(new Request("https://app.factorylm.com/api/public/signup-policy/?intent=pilot")).json()).kind).toBe(pilot === "1" ? "pilot_application" : "trial"); });
});
