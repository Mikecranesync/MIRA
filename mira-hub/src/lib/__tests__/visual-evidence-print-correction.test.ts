/**
 * Conversation-scoped print/LOOK corrections through the existing
 * `correctVisualObservations` seam. Nameplate behavior (no `conversation`)
 * must stay identical; these cases fail on the old function.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn() })),
}));
vi.mock("@/lib/workspace-files", () => ({ sha256Hex: (b: Buffer) => `sha:${b.length}` }));

import { withTenantContext } from "@/lib/tenant-context";

import {
  MAX_LOOK_CORRECTION_VALUE_CHARS,
  correctVisualObservations,
  loadRecentLookObservations,
  loadVisualEvidenceForPhoto,
} from "../visual-evidence-context";

const UUID = "64a24de7-0000-4000-8000-000000000001";
const UUID2 = "64a24de7-0000-4000-8000-000000000002";
const FILE = "f11a1111-1111-4111-8111-111111111111";
const NOTEBOOK = "22222222-2222-4222-8222-222222222222";
const TENANT = "11111111-1111-4111-8111-111111111111";

describe("correctVisualObservations — conversation-scoped print/LOOK readings", () => {
  beforeEach(() => {
    vi.mocked(withTenantContext).mockReset();
    vi.mocked(withTenantContext).mockImplementation(async (_t, fn) =>
      (fn as (c: unknown) => unknown)({ query: vi.fn(async () => ({ rows: [] })) }),
    );
  });

  const conversation = {
    notebookId: NOTEBOOK,
    ownerUserId: "u_1",
    threadId: "thread-print-a",
  };

  it("boundEntityId null WITHOUT conversation still no-ops (existing nameplate guard)", async () => {
    expect(
      await correctVisualObservations({
        tenantId: TENANT,
        boundEntityId: null,
        fileId: FILE,
        correctedBy: "u_1",
        corrections: [{ observationId: UUID2, value: "X" }],
      }),
    ).toEqual({ corrected: [], mismatched: [] });
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("boundEntityId null WITH conversation + LOOK-shaped row INSERTS technician replacement with full text including -F55.3 and /15.0", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000e";
    const reading =
      "Wire -F55.3 on terminal 7; fuse rating 2A/15.0 A; see print sheet 3";
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          id: UUID2,
          session_id: "sess",
          evidence_id: "evid",
          normalized_value: null,
          review_state: "unreviewed",
          evidence_state: "VISIBLE",
          superseded_by: null,
          extractor: "inspection_vision",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: NEW }] })
      .mockResolvedValueOnce({ rows: [{ id: UUID2 }] });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));

    const out = await correctVisualObservations({
      tenantId: TENANT,
      boundEntityId: null,
      fileId: FILE,
      correctedBy: "u_1",
      conversation,
      corrections: [{ observationId: UUID2, value: reading }],
    });

    expect(out).toEqual({ corrected: [{ supersededId: UUID2, replacementId: NEW }], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(3);

    const [insSql, insParams] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(insSql).toMatch(/INSERT INTO observation/);
    expect(insSql).toMatch(/'technician', 'corrected'/);
    expect(insParams[3]).toBe(reading);
    expect(insParams[3]).toContain("-F55.3");
    expect(insParams[3]).toContain("/15.0");
    expect(JSON.parse(insParams[4] as string)).toEqual({
      corrected_from: UUID2,
      corrected_by: "u_1",
      field: "photo_reading",
    });

    const [supSql, supParams] = query.mock.calls[2] as unknown as [string, unknown[]];
    expect(supSql).toMatch(/SET evidence_state = 'SUPERSEDED', superseded_by = \$2::uuid/);
    expect(supParams).toEqual([UUID2, NEW, TENANT]);
  });

  it("conversation SELECT uses notebook_id/created_by/thread_id, NOT asset_id::uuid", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    await correctVisualObservations({
      tenantId: TENANT,
      boundEntityId: null,
      fileId: FILE,
      correctedBy: "u_1",
      conversation,
      corrections: [{ observationId: UUID2, value: "reviewed prose" }],
    });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/vs\.asset_id IS NULL/);
    expect(sql).toMatch(/vs\.metadata->>'notebook_id' = \$3/);
    expect(sql).toMatch(/vs\.created_by = \$5/);
    expect(sql).toMatch(/vs\.metadata->>'thread_id' = \$6/);
    expect(sql).not.toMatch(/vs\.asset_id = \$3::uuid/);
    expect(params).toEqual([UUID2, TENANT, NOTEBOOK, FILE, "u_1", "thread-print-a"]);
  });

  it("oversize look value is capped at MAX_LOOK_CORRECTION_VALUE_CHARS (20000), not 200", async () => {
    const NEW = "64a24de7-0000-4000-8000-00000000000e";
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          id: UUID2,
          session_id: "s",
          evidence_id: "e",
          normalized_value: null,
          review_state: "unreviewed",
          evidence_state: "VISIBLE",
          superseded_by: null,
          extractor: "inspection_vision",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: NEW }] })
      .mockResolvedValueOnce({ rows: [{ id: UUID2 }] });
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    await correctVisualObservations({
      tenantId: TENANT,
      boundEntityId: null,
      fileId: FILE,
      correctedBy: "u_1",
      conversation,
      corrections: [{ observationId: UUID2, value: "y".repeat(25_000) }],
    });
    const [, insParams] = query.mock.calls[1] as unknown as [string, unknown[]];
    expect(MAX_LOOK_CORRECTION_VALUE_CHARS).toBe(20_000);
    expect(insParams[3]).toBe("y".repeat(20_000));
    expect((insParams[3] as string).length).toBe(20_000);
  });

  it("nameplate same-value skip still happens when conversation is omitted", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        id: UUID2,
        session_id: "s",
        evidence_id: "e",
        normalized_value: "model: GS10",
        review_state: "unreviewed",
        evidence_state: "VISIBLE",
        superseded_by: null,
      }],
    }));
    vi.mocked(withTenantContext).mockImplementationOnce(async (_t, fn) => fn({ query } as never));
    const out = await correctVisualObservations({
      tenantId: TENANT,
      boundEntityId: UUID,
      fileId: FILE,
      correctedBy: "u_1",
      corrections: [{ observationId: UUID2, value: " GS10 " }],
    });
    expect(out).toEqual({ corrected: [], mismatched: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("LOOK loaders surface technician-corrected photo_reading rows", () => {
  it("loadVisualEvidenceForPhoto SQL includes inspection_vision OR technician/corrected/photo_reading", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await loadVisualEvidenceForPhoto({ query } as never, TENANT, FILE);
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toMatch(/o\.extractor = 'inspection_vision'/);
    expect(sql).toMatch(/o\.extractor = 'technician'/);
    expect(sql).toMatch(/o\.review_state = 'corrected'/);
    expect(sql).toMatch(/o\.metadata->>'field' = 'photo_reading'/);
  });

  it("loadRecentLookObservations SQL includes inspection_vision OR technician/corrected/photo_reading", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await loadRecentLookObservations({ query } as never, TENANT, {
      notebookId: NOTEBOOK,
      ownerUserId: "u_1",
      threadId: "thread-print-a",
    });
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toMatch(/o\.extractor = 'inspection_vision'/);
    expect(sql).toMatch(/o\.extractor = 'technician'/);
    expect(sql).toMatch(/o\.review_state = 'corrected'/);
    expect(sql).toMatch(/o\.metadata->>'field' = 'photo_reading'/);
  });
});
