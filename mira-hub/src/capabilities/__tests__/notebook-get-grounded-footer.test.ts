// GET /api/equipment-notebooks/[id] — tells currentManualSearchStatus when the
// newest answer is already grounded in a document, so a failed-download note
// is not pinned under it. Kept beside the capability (not under src/app) so the
// legacy-UI guard does not treat a test edit as a guarded-path change.
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/notebook-get-grounded-footer
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

import { GET } from "@/app/api/equipment-notebooks/[id]/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const req = { nextUrl: { searchParams: new URLSearchParams() } } as unknown as NextRequest;
const params = { params: Promise.resolve({ id: NB }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u_1", tenantId: TENANT, email: "x@y", status: "trial", trialExpiresAt: null, role: "owner" } as never);
  vi.mocked(getNotebook).mockResolvedValue({
    id: NB, displayName: "Drive", identityStatus: "user_confirmed", manufacturer: "Allen-Bradley", model: "525", catalogNumber: "",
  } as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
  currentManualSearchStatus.mockResolvedValue(null);
});

describe("GET /api/equipment-notebooks/[id] — grounded latest turn", () => {
  it("passes groundedTurn when the newest turn is an answered document-basis turn", async () => {
    vi.mocked(listTurns).mockResolvedValue([{ id: "t1", answerStatus: "answered", basis: "oem_documentation", evidence: [] }] as never);
    await GET(req, params);
    expect(currentManualSearchStatus).toHaveBeenCalledWith(TENANT, NB, expect.anything(), null, [], { groundedTurn: true });
  });

  it("omits it for general reasoning, a refusal, or no basis, even after an older grounded turn", async () => {
    for (const latest of [
      { id: "t2", answerStatus: "answered", basis: "general_reasoning", evidence: [] },
      { id: "t2", answerStatus: "insufficient_evidence", basis: "oem_documentation", evidence: [] },
      { id: "t2", answerStatus: "answered", basis: null, evidence: [] },
    ]) {
      currentManualSearchStatus.mockClear();
      vi.mocked(listTurns).mockResolvedValue([
        { id: "t1", answerStatus: "answered", basis: "oem_documentation", evidence: [] },
        latest,
      ] as never);
      await GET(req, params);
      expect(currentManualSearchStatus).toHaveBeenCalledWith(TENANT, NB, expect.anything(), null, []);
    }
  });
});
