// #4731: PATCH /api/work-orders/[id] status handling. "closed" (sent by the
// phone's "Close & archive") must close the order; an unknown value must be a
// 400 naming the allowed values, decided before any query runs.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/capabilities", () => ({ requireCapability: vi.fn(() => null) }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { PATCH } from "@/app/api/work-orders/[id]/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const ID = "11111111-2222-3333-4444-555555555555";
const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const params = Promise.resolve({ id: ID });

const current = { title: "Pump down", description: null, fault_description: "Trip", resolution: "Reset" };

function wire() {
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (/^\s*SELECT title/.test(sql)) return { rows: [current] };
    if (/UPDATE work_orders/.test(sql)) return { rows: [{ id: ID, status: values[2] }] };
    return { rows: [] };
  });
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn({ query })) as never,
  );
  return query;
}

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://t/api/work-orders/x", { method: "PATCH", body: JSON.stringify(body) }),
    { params },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT } as never);
});

describe("PATCH work order status (#4731)", () => {
  it("'closed' closes the order as 'completed' and stamps closed_at", async () => {
    const query = wire();
    const res = await patch({ status: "closed" });
    expect(res.status).toBe(200);
    const update = query.mock.calls.find(([sql]) => /UPDATE work_orders/.test(sql as string));
    expect(update).toBeDefined();
    expect(update![1]).toContain("completed");
    expect(update![1]).not.toContain("closed");
    expect(update![0]).toMatch(/closed_at = NOW\(\)/);
  });

  it("'completed' still works", async () => {
    wire();
    const res = await patch({ status: "completed" });
    expect(res.status).toBe(200);
  });

  it("an unknown status is a 400 with the allowed values, and no query runs", async () => {
    const query = wire();
    const res = await patch({ status: "archived" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.allowed).toContain("completed");
    expect(body.allowed).not.toContain("closed");
    expect(query).not.toHaveBeenCalled();
  });

  it("a non-string status is a 400", async () => {
    const query = wire();
    const res = await patch({ status: 7 });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
