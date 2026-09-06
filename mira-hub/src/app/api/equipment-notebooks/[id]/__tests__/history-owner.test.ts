/**
 * GET /api/equipment-notebooks/[id] — history is read AS the authenticated
 * technician. The same endpoint serves Mobile and Web, so this is the one
 * place "your conversation, on any device" is decided.
 *
 * Run: cd mira-hub && npx vitest run src/app/api/equipment-notebooks/\[id\]/__tests__/history-owner
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  deleteNotebook: vi.fn(),
  getNotebook: vi.fn(),
  listSources: vi.fn(),
  listTurns: vi.fn(),
  updateNotebook: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({ listFilesForTarget: vi.fn(async () => []) }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources, listTurns } from "@/lib/equipment-notebooks";

const NB = "11111111-2222-3333-4444-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";
const USER_A = "user-a";
const req = {} as unknown as NextRequest;
const params = { params: Promise.resolve({ id: NB }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue({ userId: USER_A, tenantId: TENANT, email: "a@x", status: "trial", trialExpiresAt: null, role: "technician" } as never);
  vi.mocked(getNotebook).mockResolvedValue({ id: NB, displayName: "Conveyor 1" } as never);
  vi.mocked(listSources).mockResolvedValue([] as never);
  vi.mocked(listTurns).mockResolvedValue([
    { id: "t-legacy", question: "old", answerStatus: "answered", answerText: "x", evidence: [], basis: null, createdAt: "2026-08-01T00:00:00Z", ownerUserId: null, sharedLegacy: true },
    { id: "t-a", question: "mine", answerStatus: "answered", answerText: "y", evidence: [], basis: null, createdAt: "2026-09-01T00:00:00Z", ownerUserId: USER_A, sharedLegacy: false },
  ] as never);
});

describe("GET history — viewer-scoped turns", () => {
  it("asks listTurns for the SESSION user's view (never a client-chosen user)", async () => {
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    expect(listTurns).toHaveBeenCalledTimes(1);
    const args = vi.mocked(listTurns).mock.calls[0] as unknown[];
    expect(args[0]).toBe(TENANT);
    expect(args[1]).toBe(NB);
    const opts = args.find((a) => typeof a === "object" && a !== null && "viewerUserId" in (a as object)) as { viewerUserId?: string } | undefined;
    expect(opts?.viewerUserId).toBe(USER_A);
  });

  it("returns legacy ownerless turns explicitly labeled as shared history", async () => {
    const res = await GET(req, params);
    const body = (await res.json()) as { turns: { id: string; sharedLegacy?: boolean; ownerUserId?: string | null }[] };
    expect(body.turns.map((t) => [t.id, t.sharedLegacy])).toEqual([
      ["t-legacy", true],
      ["t-a", false],
    ]);
  });
});
