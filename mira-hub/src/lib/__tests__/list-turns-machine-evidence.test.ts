// Sensor S4 (D5): a persisted turn's evidence[] may carry a
// `{kind:"machine_evidence"}` entry next to its citations. listTurns must
// return it intact and must NOT treat it as a citation — the origin
// enrichment keys on docId, so a machine entry contributes no doc id, no
// origin lookup, and no crash.
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/list-turns-machine-evidence

import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantMock = vi.hoisted(() => ({
  withTenantContext: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => tenantMock);
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

import { listTurns } from "../equipment-notebooks";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC = "d0000000-0000-4000-8000-000000000001";
const PHOTO = "f0000000-0000-4000-8000-000000000001";

const machine = {
  kind: "machine_evidence",
  assetId: "a1",
  anchorAt: "2026-08-27T23:16:31.000Z",
  pre: 5,
  post: 2,
  rowCount: 7,
  freshness: "stale",
  runId: null,
  windowId: "w1",
};

function wire(rows: unknown[], originRows: unknown[] = []) {
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/FROM equipment_notebook_turns/.test(sql)) return { rows };
      if (/origin_file_id/.test(sql)) return { rows: originRows };
      return { rows: [] };
    }),
  };
  tenantMock.withTenantContext.mockImplementation(async (_t: string, fn: (c: unknown) => unknown) => fn(client));
  return calls;
}

beforeEach(() => vi.clearAllMocks());

describe("listTurns with machine evidence in evidence[]", () => {
  it("returns the machine entry intact beside the enriched citation", async () => {
    wire(
      [
        {
          id: "t1",
          question: "what happened?",
          answer_status: "answered",
          answer_text: "The photo eye went ON then the drive faulted.",
          evidence: [{ citationId: "1", docId: DOC, fileId: "txt" }, machine],
          basis: "machine_history",
          created_at: "2026-08-27T23:20:00.000Z",
        },
      ],
      [{ doc_id: DOC, origin_file_id: PHOTO }],
    );
    const turns = await listTurns(TENANT, NB);
    expect(turns).toHaveLength(1);
    expect(turns[0].basis).toBe("machine_history");
    expect(turns[0].evidence[0]).toEqual({ citationId: "1", docId: DOC, fileId: "txt", originFileId: PHOTO });
    expect(turns[0].evidence[1]).toEqual(machine);
  });

  it("a visual_observation entry (S5 D3) rides beside the citation intact and is never enriched", async () => {
    const visual = { kind: "visual_observation", fileId: PHOTO, capturedAt: "2026-08-27T23:14:21.000Z", provenance: "phone_photo" };
    wire(
      [
        {
          id: "t3",
          question: "what is this LED?",
          answer_status: "answered",
          answer_text: "Run indicator.",
          evidence: [{ citationId: "1", docId: DOC, fileId: "txt" }, machine, visual],
          basis: "oem_documentation",
          created_at: "2026-08-27T23:22:00.000Z",
        },
      ],
      [{ doc_id: DOC, origin_file_id: PHOTO }],
    );
    const turns = await listTurns(TENANT, NB);
    expect(turns[0].evidence).toEqual([{ citationId: "1", docId: DOC, fileId: "txt", originFileId: PHOTO }, machine, visual]);
  });

  it("a turn whose ONLY evidence is machine evidence skips the origin lookup entirely", async () => {
    const calls = wire([
      {
        id: "t2",
        question: "why did it stop?",
        answer_status: "answered",
        answer_text: "…",
        evidence: [machine],
        basis: "live_machine_evidence",
        created_at: "2026-08-27T23:21:00.000Z",
      },
    ]);
    const turns = await listTurns(TENANT, NB);
    expect(turns[0].evidence).toEqual([machine]);
    // Only the turns SELECT ran — no origin query for a doc-less evidence set.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/FROM equipment_notebook_turns/);
  });
});
