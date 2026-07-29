// Vitest coverage for /api/namespace/files/[id] — the filing-cabinet retention
// law (verified documents can never be deleted; DELETE → 409) and the inline
// picture rendering (raster images serve Content-Disposition: inline; SVG and
// everything else stays attachment).
//
// Run: cd mira-hub && npx vitest run "src/app/api/namespace/files/[id]"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET, DELETE } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";

const goodSession = {
  userId: "u_1",
  tenantId: "tenant-aaaa-bbbb",
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = (method: string) =>
  new Request(`https://hub.test/api/namespace/files/${VALID_UUID}`, { method });
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("GET /api/namespace/files/[id] — inline pictures, attachment for the rest", () => {
  const contentRow = (mime: string) => ({
    id: VALID_UUID,
    filename: "x.bin",
    mime_type: mime,
    content: Buffer.from([1, 2, 3]),
  });

  it("serves raster images inline (thumbnails / click-to-view)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValue(contentRow("image/png"));

    const res = await GET(makeReq("GET"), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
  });

  it("keeps SVG (scriptable) and PDFs as attachment downloads", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    for (const mime of ["image/svg+xml", "application/pdf"]) {
      vi.mocked(withTenantContext).mockResolvedValue(contentRow(mime));
      const res = await GET(makeReq("GET"), makeParams(VALID_UUID));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    }
  });
});

describe("DELETE /api/namespace/files/[id] — verified documents are kept forever", () => {
  it("refuses to delete a verified document (409 verified_retention)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValue("verified");

    const res = await DELETE(makeReq("DELETE"), makeParams(VALID_UUID));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("verified_retention");
  });

  it("deletes an unverified document", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValue("deleted");

    const res = await DELETE(makeReq("DELETE"), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
  });

  it("404s when the file does not exist for this tenant", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockResolvedValue("not_found");

    const res = await DELETE(makeReq("DELETE"), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await DELETE(makeReq("DELETE"), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });
});
