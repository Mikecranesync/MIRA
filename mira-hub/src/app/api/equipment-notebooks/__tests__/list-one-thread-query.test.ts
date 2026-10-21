/**
 * GET /api/equipment-notebooks reads every notebook's threads in ONE query.
 *
 * It used to call listThreads once per notebook: 63 notebooks took ~4.9 s on
 * staging (2026-10-21), and /v3 showed "No projects in this workspace" for
 * that long, which read as a chat that would not load until a reload.
 *
 * Run: npx vitest run src/app/api/equipment-notebooks/__tests__/list-one-thread-query.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));
const thread = (notebookId: string, id: string) => ({
  id, notebookId, title: id, createdAt: "c", updatedAt: "u", turnCount: 1, sharedLegacy: false,
});
const domain = vi.hoisted(() => ({
  createNotebook: vi.fn(),
  listNotebooks: vi.fn(),
  listThreads: vi.fn(),
  listThreadsByNotebook: vi.fn(),
}));
vi.mock("@/lib/equipment-notebooks", () => domain);
vi.mock("@/capabilities/notebook-manual-acquisition", () => ({ startManualAcquisition: vi.fn() }));

import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  domain.listNotebooks.mockResolvedValue([{ id: "nb-1" }, { id: "nb-2" }, { id: "nb-3" }]);
  domain.listThreads.mockImplementation(async (_t: string, nb: string) => [thread(nb, `${nb}-t`)]);
  domain.listThreadsByNotebook.mockResolvedValue(
    new Map([
      ["nb-1", [thread("nb-1", "a"), thread("nb-1", "b")]],
      ["nb-3", [thread("nb-3", "c")]],
    ]),
  );
});

describe("GET /api/equipment-notebooks", () => {
  it("reads all notebooks' threads with one call, not one per notebook", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(domain.listThreads).not.toHaveBeenCalled();
    expect(domain.listThreadsByNotebook).toHaveBeenCalledTimes(1);
    expect(domain.listThreadsByNotebook).toHaveBeenCalledWith(TENANT, ["nb-1", "nb-2", "nb-3"], 20, { viewerUserId: "u1" });
  });

  it("attaches each notebook's own threads, and an empty list to a notebook with none", async () => {
    const body = (await (await GET()).json()) as { notebooks: { id: string; threads: { id: string }[] }[] };
    expect(body.notebooks.map((n) => [n.id, n.threads.map((t) => t.id)])).toEqual([
      ["nb-1", ["a", "b"]],
      ["nb-2", []],
      ["nb-3", ["c"]],
    ]);
  });
});
