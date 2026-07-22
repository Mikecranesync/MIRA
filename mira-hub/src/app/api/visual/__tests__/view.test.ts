// Run: npx vitest run src/app/api/visual/__tests__/view.test.ts
//
// Evidence byte delivery — cookie path, signed-token path, 404 discipline
// (a bad token or cross-tenant id is a plain 404, never a distinguishable
// error), inline safelist + nosniff headers.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const queryMock = vi.fn();
const tenantSeen: string[] = [];
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: (tenantId: string, fn: (c: unknown) => unknown) => {
    tenantSeen.push(tenantId);
    return fn({ query: queryMock });
  },
}));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));

process.env.NEON_DATABASE_URL ||= "postgres://unit-test/none";
process.env.VISUAL_EVIDENCE_SIGNING_SECRET = "unit-test-secret-0123456789";

import { GET as viewEvidence } from "@/app/api/visual/evidence/[id]/view/route";
import { mintEvidenceToken } from "@/lib/visual/signed-url";
import { sessionOr401 } from "@/lib/session";

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EVIDENCE = "11111111-2222-3333-4444-555555555555";
const CTX = {
  userId: "u-1",
  tenantId: TENANT,
  email: "t@example.com",
  status: "active",
  trialExpiresAt: null,
};
const PNG_ROW = { content: Buffer.from([0x89, 0x50]), content_mime: "image/png" };

function evidenceParams(id = EVIDENCE) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  queryMock.mockReset();
  tenantSeen.length = 0;
  vi.mocked(sessionOr401).mockReset();
  vi.mocked(sessionOr401).mockResolvedValue(CTX as never);
});

describe("GET /api/visual/evidence/[id]/view", () => {
  it("serves bytes on the cookie path with safe headers", async () => {
    queryMock.mockResolvedValueOnce({ rows: [PNG_ROW] });
    const res = await viewEvidence(new Request("http://x/view"), evidenceParams());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toContain("private");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/tenant_id = \$2/);
    expect(params).toEqual([EVIDENCE, TENANT]);
  });

  it("serves bytes on the signed-token path without a session", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    queryMock.mockResolvedValueOnce({ rows: [PNG_ROW] });
    const token = mintEvidenceToken(EVIDENCE, TENANT)!;
    const res = await viewEvidence(
      new Request(`http://x/view?token=${encodeURIComponent(token)}`),
      evidenceParams(),
    );
    expect(res.status).toBe(200);
    expect(tenantSeen[0]).toBe(TENANT); // tenant came from the token, not a session
    expect(sessionOr401).not.toHaveBeenCalled();
  });

  it("404s a token minted for a different evidence id", async () => {
    const token = mintEvidenceToken("22222222-3333-4444-5555-666666666666", TENANT)!;
    const res = await viewEvidence(
      new Request(`http://x/view?token=${encodeURIComponent(token)}`),
      evidenceParams(),
    );
    expect(res.status).toBe(404);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("404s an expired token", async () => {
    const token = mintEvidenceToken(EVIDENCE, TENANT, -5)!;
    const res = await viewEvidence(
      new Request(`http://x/view?token=${encodeURIComponent(token)}`),
      evidenceParams(),
    );
    expect(res.status).toBe(404);
  });

  it("404s when the row is missing or has no content (cross-tenant looks identical)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const missing = await viewEvidence(new Request("http://x/view"), evidenceParams());
    expect(missing.status).toBe(404);

    queryMock.mockResolvedValueOnce({ rows: [{ content: null, content_mime: null }] });
    const empty = await viewEvidence(new Request("http://x/view"), evidenceParams());
    expect(empty.status).toBe(404);
  });

  it("400s a non-UUID id before any auth or DB work", async () => {
    const res = await viewEvidence(new Request("http://x/view"), evidenceParams("../etc"));
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
