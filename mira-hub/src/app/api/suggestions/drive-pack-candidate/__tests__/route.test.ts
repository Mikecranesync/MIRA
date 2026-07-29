// Coverage for POST /api/suggestions/drive-pack-candidate.
//
// Run: cd mira-hub && npx vitest run src/app/api/suggestions/drive-pack-candidate
//
// Mocks the session helper and the DB insert; keeps candidateToSuggestion real
// so the invalid-record → 400 path is exercised end-to-end.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/drive-pack-suggestion", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/drive-pack-suggestion")>();
  return { ...actual, insertDrivePackSuggestion: vi.fn() };
});

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { insertDrivePackSuggestion } from "@/lib/drive-pack-suggestion";

const TENANT_ID = "tenant-aaaa-bbbb";
const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
  role: "admin",
};

const CANDIDATE = {
  registry_manual_id: "rockwell_powerflex_525_520-um001",
  pdf_sha256: "ba2bd0f55a12cec73db09279994a0060fa09e37f4b4741308e5c29f765fd02b7",
  previously_registered_sha256:
    "b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6",
  change_state: "changed_by_hash",
  manual_source: { vendor: "Rockwell Automation", product_family: "PowerFlex 525" },
  next_step: "python tools/drive-pack-extract/registry/update_candidate.py --manual x --id y",
  local_pdf_path: "/opt/mira/manuals/x.pdf",
};

const makeReq = (body: unknown) =>
  new Request("https://hub.test/api/suggestions/drive-pack-candidate", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("POST /api/suggestions/drive-pack-candidate", () => {
  it("returns 503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await POST(makeReq(CANDIDATE));
    expect(res.status).toBe(503);
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq(CANDIDATE));
    expect(res.status).toBe(401);
    expect(insertDrivePackSuggestion).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the candidate record is missing required provenance", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq({ pdf_sha256: "abc" }));
    expect(res.status).toBe(400);
    expect(insertDrivePackSuggestion).not.toHaveBeenCalled();
  });

  it("inserts the candidate and returns 200 with the new id (created)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(insertDrivePackSuggestion).mockResolvedValue({ id: "sug-1", created: true });
    const res = await POST(makeReq(CANDIDATE));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, id: "sug-1", created: true });
    // the insert ran for the caller's tenant with a drive_pack_update suggestion
    const [tid, suggestion] = vi.mocked(insertDrivePackSuggestion).mock.calls[0];
    expect(tid).toBe(TENANT_ID);
    expect(suggestion.suggestionType).toBe("drive_pack_update");
  });

  it("returns 200 with created=false when the candidate already exists (idempotent)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(insertDrivePackSuggestion).mockResolvedValue({ id: "sug-1", created: false });
    const res = await POST(makeReq(CANDIDATE));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, id: "sug-1", created: false });
  });
});
