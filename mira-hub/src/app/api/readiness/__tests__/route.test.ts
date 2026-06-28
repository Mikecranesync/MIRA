import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { GET } from "../route";

const session = {
  tenantId: "00000000-0000-0000-0000-00000000000a",
  userId: "u_test",
  email: "test@example.com",
  status: "trial",
  trialExpiresAt: null,
};

describe("GET /api/readiness", () => {
  const originalDb = process.env.NEON_DATABASE_URL;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEON_DATABASE_URL = "postgres://test";
    vi.mocked(sessionOr401).mockResolvedValue(session);
  });

  afterEach(() => {
    process.env.NEON_DATABASE_URL = originalDb;
  });

  it("counts verified knowledge_entries as document readiness and reports unverified chunks as checklist work", async () => {
    const queries: string[] = [];
    const query = vi.fn(async (sql: string) => {
      queries.push(sql);
      return {
        rows: [{
          sites: "1",
          lines: "1",
          assets: "1",
          components: "1",
          docs: "2",
          docs_pending: "4",
          proposals_pending: "0",
          proposals_verified: "0",
          uns_paths: "3",
          wizard_completed: false,
        }],
      };
    });

    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) =>
      fn({ query } as never),
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(queries[0]).toContain("knowledge_entries");
    expect(queries[0]).toContain("verified = true");
    expect(body.counts.docs).toBe(2);
    expect(body.counts.docsPending).toBe(4);
    expect(body.missingContext).toContainEqual(
      expect.objectContaining({
        key: "approved_documents",
        status: "ready",
        count: 2,
        pending: 4,
      }),
    );
  });
});
