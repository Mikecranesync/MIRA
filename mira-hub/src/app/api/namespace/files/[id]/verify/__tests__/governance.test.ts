// Workstream A case 10 (PRD §7.4): admin namespace verification keeps its
// documented governance behaviour. `namespace_direct_uploads.verified` is the
// filing cabinet's RETENTION flag (verified files cannot be deleted — 059
// trigger); it is NOT the shared-corpus trust flag on knowledge_entries and NOT
// notebook confirmation. Retrieval admission for a tenant's private source is
// derived from the notebook relationship, so this route must keep writing only
// its own table — it must never start (or be expected to) flip
// knowledge_entries.verified.
//
// Run: cd mira-hub && npx vitest run "src/app/api/namespace/files/[id]/verify"

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/capabilities", () => ({ requireCapability: vi.fn() }));

const captured = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) => {
        captured.sql.push(sql);
        return { rows: [{ id: "f", verified: true, verified_at: "2026-08-29T00:00:00Z" }] };
      }),
    }),
  ),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";

const ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  vi.resetAllMocks();
  captured.sql.length = 0;
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u_1",
    tenantId: "tenant-aaaa-bbbb",
    email: "x@y",
    status: "trial",
    trialExpiresAt: null,
  } as never);
  vi.mocked(requireCapability).mockReturnValue(null);
});

describe("POST /api/namespace/files/[id]/verify — governance scope", () => {
  it("updates namespace_direct_uploads (tenant-scoped) and touches no knowledge_entries row", async () => {
    const res = await POST(
      new Request(`https://hub.test/api/namespace/files/${ID}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verified: true }),
      }),
      { params: Promise.resolve({ id: ID }) },
    );
    expect(res.status).toBe(200);
    expect(captured.sql).toHaveLength(1);
    expect(captured.sql[0]).toMatch(/UPDATE namespace_direct_uploads/);
    expect(captured.sql[0]).toContain("tenant_id = $2");
    expect(captured.sql[0]).not.toMatch(/knowledge_entries/);
  });
});
