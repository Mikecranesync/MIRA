/**
 * #4877 — pilot-funnel hook on new-account registration.
 * Run: npx vitest run src/capabilities/__tests__/register-route.test.ts
 *
 * Lives under src/capabilities/__tests__/ (not co-located with route.ts)
 * per `.claude/rules/factorylm-unified-ui-cutover.md` — the guard's
 * `_is_hub_api_route` classifier only preserves a file named exactly
 * `route.ts` under `app/**`, so a co-located `route.test.ts` is classified
 * guarded (no `.test.ts` carve-out exists for `mira-hub/src/app/**`). The
 * same convention PR #4882 used for `pilot-approve-route.test.ts`: the test
 * file lives in capabilities/__tests__/ and imports the route handler from
 * its real path.
 *
 * The module-level per-IP rate limiter in route.ts is shared across every
 * test in this file (it's a module-level Map, not reset by vi.clearAllMocks),
 * so each test uses its own `x-forwarded-for` to avoid the 6th-request 429.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "hashed-password") },
}));

vi.mock("@/lib/users", () => ({
  findUserByEmail: vi.fn(),
  ensureUserAndTenant: vi.fn(),
}));

vi.mock("@/capabilities/pilot-funnel", () => ({
  attributionFromRequest: vi.fn(() => ({
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    hasGclid: false,
    hasFbclid: false,
  })),
  handlePilotApplicationSubmitted: vi.fn(async () => undefined),
}));

import { findUserByEmail, ensureUserAndTenant } from "@/lib/users";
import { attributionFromRequest, handlePilotApplicationSubmitted } from "@/capabilities/pilot-funnel";
import { POST } from "@/app/api/auth/register/route";

const mockFindUserByEmail = vi.mocked(findUserByEmail);
const mockEnsureUserAndTenant = vi.mocked(ensureUserAndTenant);
const mockAttributionFromRequest = vi.mocked(attributionFromRequest);
const mockHandlePilotApplicationSubmitted = vi.mocked(handlePilotApplicationSubmitted) as unknown as Mock;

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

function makeRequest(body: unknown, ip: string, headers: Record<string, string> = {}) {
  return new Request("https://app.factorylm.com/api/auth/register/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register — pilot-funnel hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEON_DATABASE_URL = "postgresql://test";
    mockFindUserByEmail.mockResolvedValue(null);
    mockEnsureUserAndTenant.mockResolvedValue({ id: "user-1", tenantId: "tenant-1", email: "new@example.com" });
    // vi.clearAllMocks() clears call history but NOT a previously-set
    // mockRejectedValue implementation — reset it explicitly every test so
    // one test's rejection can't leak into the next test's "happy path".
    mockHandlePilotApplicationSubmitted.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.NEON_DATABASE_URL;
  });

  it("fires the pilot-funnel hook exactly once for a NEW signup, with the new ids", async () => {
    const req = makeRequest({ email: "new@example.com", password: "password123", name: "Jordan" }, freshIp());
    const res = await POST(req);
    expect(res.status).toBe(201);

    // the hook is fire-and-forget (void, not awaited in the route) — flush microtasks
    await vi.waitFor(() => {
      expect(mockHandlePilotApplicationSubmitted).toHaveBeenCalledTimes(1);
    });
    const call = mockHandlePilotApplicationSubmitted.mock.calls[0][0];
    expect(call.tenantId).toBe("tenant-1");
    expect(call.userId).toBe("user-1");
    expect(call.email).toBe("new@example.com");
    expect(call.name).toBe("Jordan");
    expect(mockAttributionFromRequest).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire the hook for an existing-user return (409)", async () => {
    mockFindUserByEmail.mockResolvedValue({
      id: "existing-user",
      email: "exists@example.com",
      passwordHash: "x",
      googleSub: null,
      tenantId: "tenant-existing",
      name: null,
      role: "owner",
      status: "trial",
      trialExpiresAt: null,
      plan: null,
      preferences: {},
    });
    const req = makeRequest({ email: "exists@example.com", password: "password123" }, freshIp());
    const res = await POST(req);
    expect(res.status).toBe(409);
    expect(mockHandlePilotApplicationSubmitted).not.toHaveBeenCalled();
    expect(mockEnsureUserAndTenant).not.toHaveBeenCalled();
  });

  it("a failing pilot-funnel hook does not change the 201 response", async () => {
    mockHandlePilotApplicationSubmitted.mockRejectedValue(new Error("pilot-funnel hook blew up"));
    const req = makeRequest({ email: "resilient@example.com", password: "password123" }, freshIp());
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    // let the rejected fire-and-forget promise's .catch() run so it doesn't
    // surface as an unhandled rejection in this test file
    await vi.waitFor(() => {
      expect(mockHandlePilotApplicationSubmitted).toHaveBeenCalledTimes(1);
    });
  });

  it("passes the parsed body through to attributionFromRequest", async () => {
    const payload = { email: "attrib@example.com", password: "password123", utm_source: "google" };
    const req = makeRequest(payload, freshIp());
    await POST(req);
    await vi.waitFor(() => {
      expect(mockAttributionFromRequest).toHaveBeenCalledTimes(1);
    });
    const [, body] = mockAttributionFromRequest.mock.calls[0];
    expect((body as Record<string, unknown>).utm_source).toBe("google");
  });
});
