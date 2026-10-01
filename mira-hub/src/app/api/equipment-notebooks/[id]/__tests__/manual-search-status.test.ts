// GET /api/equipment-notebooks/[id] — the `manualSearch` field (T2 #4189 F4/F6).
//
// Computed FRESH on every read via `currentManualSearchStatus` — never read
// from a persisted turn snapshot (that would go stale the instant the search
// finishes after the turn was written). Both the Hub (`hub-host.tsx`'s
// `loadDetail`, already called after every send and after an identity
// confirm) and mobile (`getNotebookDetail`) reuse THIS one computation on
// their existing post-turn/post-confirm refetch.
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/__tests__/manual-search-status"
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  deleteNotebook: vi.fn(),
  getNotebook: vi.fn(),
  listSources: vi.fn(),
  listTurns: vi.fn(),
  listThreads: vi.fn(async () => []),
  updateNotebook: vi.fn(),
  normalizeNotebookThreadId: vi.fn((v: string) => v),
}));
vi.mock("@/lib/workspace-files", () => ({ listFilesForTarget: vi.fn(async () => []) }));

const currentManualSearchStatus = vi.hoisted(() => vi.fn());
vi.mock("@/capabilities/notebook-manual-acquisition", () => ({ currentManualSearchStatus }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const req = { nextUrl: { searchParams: new URLSearchParams() } } as unknown as NextRequest;
const params = { params: Promise.resolve({ id: NB }) };

const NOTEBOOK = {
  id: NB,
  displayName: "Conveyor 1",
  identityStatus: "unconfirmed",
  manufacturer: null,
  model: null,
  catalogNumber: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT, email: "x@y", status: "trial", trialExpiresAt: null, role: "owner" } as never);
  vi.mocked(getNotebook).mockResolvedValue(NOTEBOOK as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
  vi.mocked(listTurns).mockResolvedValue([] as never);
  currentManualSearchStatus.mockResolvedValue(null);
});

describe("GET /api/equipment-notebooks/[id] — manualSearch (T2 #4189)", () => {
  it("returns the computed status verbatim", async () => {
    currentManualSearchStatus.mockResolvedValue({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true });
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manualSearch).toEqual({ manufacturer: "SMC", model: "SS5Y3-DUW01302", running: true });
  });

  it("passes the notebook's own confirmed identity fields through", async () => {
    vi.mocked(getNotebook).mockResolvedValue({
      ...NOTEBOOK,
      identityStatus: "user_confirmed",
      manufacturer: "SMC",
      model: "SS5Y3-DUW01302",
      catalogNumber: "",
    } as never);
    await GET(req, params);
    expect(currentManualSearchStatus).toHaveBeenCalledWith(
      TENANT,
      NB,
      { identityStatus: "user_confirmed", manufacturer: "SMC", model: "SS5Y3-DUW01302", catalogNumber: "" },
      null,
    );
  });

  it("extracts the most recent persisted identity_proposal from turns as the fallback proposed identity", async () => {
    vi.mocked(listTurns).mockResolvedValue([
      { id: "t1", evidence: [{ kind: "identity_proposal", manufacturer: "Rockwell", model: "PowerFlex 525" }] },
      { id: "t2", evidence: [{ kind: "identity_proposal", manufacturer: "SMC", model: "SS5Y3-DUW01302" }] },
      { id: "t3", evidence: [] },
    ] as never);
    await GET(req, params);
    const call = currentManualSearchStatus.mock.calls[0]!;
    expect(call[3]).toEqual({ manufacturer: "SMC", model: "SS5Y3-DUW01302" });
  });

  it("passes null for the proposed identity when no turn carries one", async () => {
    vi.mocked(listTurns).mockResolvedValue([{ id: "t1", evidence: [{ kind: "identity_dispute" }] }] as never);
    await GET(req, params);
    expect(currentManualSearchStatus).toHaveBeenCalledWith(TENANT, NB, expect.anything(), null);
  });

  it("degrades to manualSearch:null (not a 500) when the computation throws", async () => {
    currentManualSearchStatus.mockRejectedValue(new Error("db down"));
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manualSearch).toBeNull();
    expect(body.notebook).toBeTruthy();
  });
});
