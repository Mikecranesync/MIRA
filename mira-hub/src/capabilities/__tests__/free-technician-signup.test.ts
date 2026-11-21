import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import pool from "@/lib/db";
import { ensureUserAndTenant } from "@/lib/users";
import { PILOT_WINDOW_DAYS } from "@/lib/config";
import { publicSignupPolicy } from "@/capabilities/free-technician-signup";
import { GET } from "@/app/api/public/signup-policy/route";
import { signupOfferLabel } from "@/factorylm-ui/SignupOffer";

const query = vi.mocked(pool.query);
const connect = vi.mocked(pool.connect);
let writes: { sql: string; values?: unknown[] }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
  vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "false");
  query.mockResolvedValue({ rows: [] } as never);
  writes = [];
  connect.mockResolvedValue({
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      writes.push({ sql, values });
      if (sql.includes("INSERT INTO hub_tenants")) return { rows: [{ id: "tenant-1" }] };
      if (sql.includes("INSERT INTO hub_users")) return { rows: [{ id: "user-1", email: "tech@example.com" }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  } as never);
});

afterEach(() => vi.unstubAllEnvs());

describe("free technician signup", () => {
  it.each([undefined, "false", "TRUE", "1"])("does not activate for ambiguous flag %s", (flag) => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", flag);
    expect(publicSignupPolicy()).toEqual({ version: 1, kind: "trial", requiresApproval: false, trialDays: PILOT_WINDOW_DAYS });
  });

  it("persists a non-expiring free personal account without platform-admin promotion", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    await ensureUserAndTenant({ email: "tech@example.com", passwordHash: "hash" });
    const insert = writes.find((row) => row.sql.includes("INSERT INTO hub_users"))!;
    expect(insert.sql).toContain("'approved', NULL, 'technician_free'");
    expect(insert.sql).not.toContain("'admin'");
    expect(insert.values).toEqual(["tech@example.com", "hash", null, "tenant-1", null]);
    expect(writes.some((row) => row.sql.includes("pilot_status"))).toBe(false);
    expect(writes.at(-1)?.sql).toBe("COMMIT");
    expect(publicSignupPolicy().kind).toBe("free_technician");
  });

  it("uses the same free policy for a new federated-login account", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    await ensureUserAndTenant({ email: "tech@example.com", googleSub: "subject-1" });
    const insert = writes.find((row) => row.sql.includes("INSERT INTO hub_users"))!;
    expect(insert.sql).toContain("'approved', NULL, 'technician_free'");
    expect(insert.values?.[2]).toBe("subject-1");
  });

  it("keeps explicit pilot applications approval-required even when free personal signup is on", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1");
    await ensureUserAndTenant({ email: "tech@example.com", signupIntent: "pilot" });
    const insert = writes.find((row) => row.sql.includes("INSERT INTO hub_users"))!;
    expect(insert.sql).toContain("'pending', NULL");
    expect(insert.sql).not.toContain("technician_free");
    expect(writes.some((row) => row.sql.includes("pilot_status = 'pending'"))).toBe(true);
    expect(publicSignupPolicy("pilot")).toMatchObject({ kind: "pilot_application", requiresApproval: true });
    expect(publicSignupPolicy()).toMatchObject({ kind: "free_technician", requiresApproval: false });
  });

  it("does not rewrite an existing paid or expired account", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    query.mockResolvedValue({ rows: [{ id: "existing", email: "tech@example.com", tenant_id: "paid-tenant", status: "expired", plan: "enterprise" }] } as never);
    await expect(ensureUserAndTenant({ email: "tech@example.com" })).resolves.toEqual({ id: "existing", tenantId: "paid-tenant", email: "tech@example.com" });
    expect(connect).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("reports only public policy data, uncached, without starting a session", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ version: 1, kind: "free_technician", requiresApproval: false, trialDays: null });
    expect(query).not.toHaveBeenCalled();
  });

  it("shows the current policy and keeps an unreadable offer neutral", () => {
    expect(signupOfferLabel(null)).toBe("Create your MIRA account.");
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    expect(signupOfferLabel(publicSignupPolicy())).toBe("Free for technicians — no credit card.");
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1");
    expect(signupOfferLabel(publicSignupPolicy("pilot"))).toContain("Approval is required");
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "false");
    expect(signupOfferLabel(publicSignupPolicy())).toContain(`${PILOT_WINDOW_DAYS}-day free trial`);
  });
});
