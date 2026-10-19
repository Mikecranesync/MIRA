// GET/POST /api/manual-harvester — the proposal list and the one-tap OK.
// Session, DB and the acquisition pipeline are mocked; the SQL itself is
// exercised read-only against staging (see .planning/demand-manuals/STATE.md).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/capabilities/manual-harvester", () => ({ loadManualProposals: vi.fn() }));
vi.mock("@/capabilities/notebook-manual-acquisition", async (orig) => {
  const real = await orig<typeof import("@/capabilities/notebook-manual-acquisition")>();
  return { ...real, startManualAcquisition: vi.fn() };
});

import { GET, POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { loadManualProposals } from "@/capabilities/manual-harvester";
import { startManualAcquisition } from "@/capabilities/notebook-manual-acquisition";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const session = { tenantId: TENANT, userId: "u1", email: "t@x.com", status: "active", trialExpiresAt: null };

let row: Record<string, unknown> | undefined;
const queries: { sql: string; params: unknown[] }[] = [];

function post(body: unknown): NextRequest {
  return new NextRequest("http://hub.test/api/manual-harvester", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  queries.length = 0;
  process.env.MIRA_NOTEBOOK_MANUAL_ACQUISITION = "1";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
  row = { id: NB, node_id: "33333333-3333-4333-8333-333333333333", manufacturer: "Siemens", model: "3RV20",
          catalog_number: null, identity_status: "user_confirmed" };
  vi.mocked(withTenantContext).mockImplementation((async (_t: string, fn: (c: unknown) => unknown) =>
    fn({ query: async (sql: string, params: unknown[]) => { queries.push({ sql, params }); return { rows: row ? [row] : [] }; } })) as never);
  vi.mocked(startManualAcquisition).mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.MIRA_NOTEBOOK_MANUAL_ACQUISITION;
});

describe("GET /api/manual-harvester", () => {
  it("returns the caller's proposals (control)", async () => {
    vi.mocked(loadManualProposals).mockResolvedValue([{ manufacturer: "Siemens" }] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).proposals).toHaveLength(1);
    expect(vi.mocked(loadManualProposals).mock.calls[0][1]).toBe(TENANT);
  });

  it("is 404 when acquisition is switched off", async () => {
    process.env.MIRA_NOTEBOOK_MANUAL_ACQUISITION = "0";
    expect((await GET()).status).toBe(404);
    expect(loadManualProposals).not.toHaveBeenCalled();
  });
});

describe("POST /api/manual-harvester (one-tap OK)", () => {
  it("starts the existing acquisition for the notebook's confirmed identity", async () => {
    const res = await POST(post({ notebookId: NB }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ started: true, notebookId: NB });
    const arg = vi.mocked(startManualAcquisition).mock.calls[0][0];
    expect(arg).toMatchObject({ tenantId: TENANT, notebookId: NB, identity: { manufacturer: "Siemens", model: "3RV20" } });
    expect(queries[0].params).toEqual([TENANT, NB]);
    expect(queries[0].sql).toMatch(/tenant_id = \$1::uuid AND id = \$2::uuid/);
  });

  it("is 404 for another tenant's notebook (no row under the caller's tenant)", async () => {
    row = undefined;
    expect((await POST(post({ notebookId: NB }))).status).toBe(404);
    expect(startManualAcquisition).not.toHaveBeenCalled();
  });

  it("refuses an unconfirmed identity instead of searching a guess", async () => {
    row = { ...row, identity_status: "candidate" };
    expect((await POST(post({ notebookId: NB }))).status).toBe(409);
    expect(startManualAcquisition).not.toHaveBeenCalled();
  });

  it("rejects a malformed id without touching the database", async () => {
    expect((await POST(post({ notebookId: "nope" }))).status).toBe(404);
    expect(queries).toHaveLength(0);
  });

  it("is 404 when acquisition is switched off", async () => {
    process.env.MIRA_NOTEBOOK_MANUAL_ACQUISITION = "0";
    expect((await POST(post({ notebookId: NB }))).status).toBe(404);
    expect(startManualAcquisition).not.toHaveBeenCalled();
  });
});
