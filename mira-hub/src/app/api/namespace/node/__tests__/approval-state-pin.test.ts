// ARPK Phase 1a hardening — user-created nodes must pin approval_state.
// docs/migrations/008 defaults kg_entities.approval_state to 'verified';
// mira-hub migration 029 defaults it to 'proposed'. NodeChat 404s any node that
// is not 'verified', so in an environment where 029's default won, every node a
// user creates (and then attaches manuals to) would be un-chattable. The INSERT
// must name the state explicitly instead of trusting the ambient default.

import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const TENANT = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u1",
    tenantId: TENANT,
    role: "owner",
  } as never);
});

describe("POST /api/namespace/node approval_state pin", () => {
  it("creates the node with approval_state pinned to 'verified'", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes("INSERT INTO kg_entities")) {
          return { rows: [{ id: "new-node-id" }] };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(withTenantContext).mockImplementation(
      ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
    );

    const res = await POST(
      new Request("http://test/api/namespace/node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Pump House", kind: "area" }),
      }),
    );

    expect(res.status).toBe(201);
    const insert = calls.find((c) => c.sql.includes("INSERT INTO kg_entities"));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("approval_state");
    expect(insert!.sql).toContain("'verified'");
  });
});
