import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/demo-auth", () => ({ sessionOrDemo: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET } from "../route";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

const TENANT_ID = "11111111-2222-3333-4444-555555555555";
const DEMO_TENANT_ID = "00000000-0000-0000-0000-0000000000d1";

const session = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "ops@example.com",
  status: "trial",
  trialExpiresAt: null,
  isDemo: false,
};

function wireRows(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows }));
  vi.mocked(withTenantContext).mockImplementation(
    ((_tenantId: string, fn: (client: { query: typeof query }) => unknown) =>
      fn({ query })) as never,
  );
  return query;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only";
  vi.mocked(sessionOrDemo).mockResolvedValue(session as never);
});

describe("GET /api/hub/status", () => {
  it("returns 503 when the database is not configured", async () => {
    delete process.env.NEON_DATABASE_URL;

    const res = await GET(new Request("https://hub.test/api/hub/status"));

    expect(res.status).toBe(503);
  });

  it("passes through auth failures", async () => {
    vi.mocked(sessionOrDemo).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );

    const res = await GET(new Request("https://hub.test/api/hub/status"));

    expect(res.status).toBe(401);
  });

  it("queries live_signal_cache through the caller tenant context", async () => {
    const freshAt = new Date().toISOString();
    const query = wireRows([
      {
        plc_tag: "conv_simple.motor_run",
        last_value_text: null,
        last_value_numeric: null,
        last_value_bool: true,
        last_changed_at: freshAt,
      },
      {
        plc_tag: "conv_simple.vfd_speed_hz",
        last_value_text: null,
        last_value_numeric: 30,
        last_value_bool: null,
        last_changed_at: freshAt,
      },
      {
        plc_tag: "conv_simple.comm_ok",
        last_value_text: null,
        last_value_numeric: null,
        last_value_bool: true,
        last_changed_at: freshAt,
      },
    ]);

    const res = await GET(new Request("https://hub.test/api/hub/status"));

    expect(res.status).toBe(200);
    expect(withTenantContext).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM live_signal_cache"), [
      TENANT_ID,
    ]);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE\s+tenant_id\s*=\s*\$1::uuid/i);

    const body = await res.json();
    expect(body.zones).toContainEqual(
      expect.objectContaining({
        id: "conv_simple",
        state: "running",
        stale: false,
      }),
    );
    expect(body.as_of).toEqual(expect.any(String));
  });

  it("allows the demo tenant session fallback without demo-only rejection", async () => {
    const freshAt = new Date().toISOString();
    vi.mocked(sessionOrDemo).mockResolvedValue({
      ...session,
      tenantId: DEMO_TENANT_ID,
      isDemo: true,
    } as never);
    wireRows([
      {
        plc_tag: "stardust.launch_1.block_occupied",
        last_value_text: null,
        last_value_numeric: null,
        last_value_bool: true,
        last_changed_at: freshAt,
      },
    ]);

    const req = new Request("https://hub.test/api/hub/status", {
      headers: { authorization: "Bearer demo-token" },
    });
    const res = await GET(req);

    expect(sessionOrDemo).toHaveBeenCalledWith(req);
    expect(withTenantContext).toHaveBeenCalledWith(DEMO_TENANT_ID, expect.any(Function));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.zones).toContainEqual(
      expect.objectContaining({ id: "stardust.launch_1", state: "blocked" }),
    );
  });
});
