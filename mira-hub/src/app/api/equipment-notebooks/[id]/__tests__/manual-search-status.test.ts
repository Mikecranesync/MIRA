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
vi.mock("@/capabilities/notebook-manual-acquisition", async (importOriginal) => ({
  currentManualSearchStatus,
  threadNamesOtherModel: (await importOriginal<typeof import("@/capabilities/notebook-manual-acquisition")>()).threadNamesOtherModel,
}));

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
      [],
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
    expect(currentManualSearchStatus).toHaveBeenCalledWith(TENANT, NB, expect.anything(), null, []);
  });

  // Codex round 2 F10: currentManualSearchStatus derives its outcome from the
  // sources' CURRENT state — the GET route must pass the SAME sources it just
  // listed (not re-query, not pass an empty array).
  it("passes the SAME sources list it just read via listSources", async () => {
    const sources = [{ docId: "d1", enabledByDefault: true, matchState: "verified", sourceRole: "manual" }];
    vi.mocked(listSources).mockResolvedValue(sources as never);
    await GET(req, params);
    expect(currentManualSearchStatus).toHaveBeenCalledWith(TENANT, NB, expect.anything(), null, sources);
  });

  // Staging tablet walk 2026-11-21: in a project confirmed as GS11N-20P2, a
  // thread asking for GS11N-20P25 showed the GS11N-20P2 ready line and link.
  describe("thread scope", () => {
    const THREAD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const threadReq = { nextUrl: { searchParams: new URLSearchParams({ threadId: THREAD }) } } as unknown as NextRequest;
    const READY = {
      manufacturer: "AutomationDirect", model: "GS11N-20P2", running: false,
      message: "DURApulse GS10 Drive User Manual, Rev C is ready in Sources. PDF page 26 shows coverage for GS11N-20P2.",
      manualUrl: "https://app.example.test/hub/v3/source/?file=f&page=26",
    };
    const ask = (question: string) => ({ id: "t", question, evidence: [] });

    beforeEach(() => {
      vi.mocked(getNotebook).mockResolvedValue({
        ...NOTEBOOK, identityStatus: "user_confirmed", manufacturer: "AutomationDirect", model: "GS11N-20P2", catalogNumber: "",
      } as never);
      currentManualSearchStatus.mockResolvedValue(READY);
    });

    it("drops the project status in a thread that asked for a look-alike model", async () => {
      vi.mocked(listTurns).mockResolvedValue([ask("Find me the manual for AutomationDirect GS11N-20P25")] as never);
      const body = await (await GET(threadReq, params)).json();
      expect(vi.mocked(listTurns)).toHaveBeenCalledWith(TENANT, NB, 50, expect.objectContaining({ threadId: THREAD }));
      expect(body.manualSearch).toBeNull();
    });

    it("keeps it in a thread that asked for the project's own model", async () => {
      vi.mocked(listTurns).mockResolvedValue([ask("Find me the manual for AutomationDirect GS11N-20P2")] as never);
      const body = await (await GET(threadReq, params)).json();
      expect(body.manualSearch).toEqual(READY);
    });

    it("keeps it in the photo thread, whose question names no model", async () => {
      vi.mocked(listTurns).mockResolvedValue([ask("Find me the manual")] as never);
      const body = await (await GET(threadReq, params)).json();
      expect(body.manualSearch).toEqual(READY);
    });

    it("keeps it on a whole-notebook read, which spans every thread", async () => {
      vi.mocked(listTurns).mockResolvedValue([ask("Find me the manual for AutomationDirect GS11N-20P25")] as never);
      const body = await (await GET(req, params)).json();
      expect(body.manualSearch).toEqual(READY);
    });
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
