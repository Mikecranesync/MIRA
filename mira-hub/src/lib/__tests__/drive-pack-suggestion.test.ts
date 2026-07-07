// Coverage for the drive-pack bridge → ai_suggestions ingestion seam.
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/drive-pack-suggestion.test.ts
//
// Seams under test:
//   1. candidateToSuggestion(record) — pure transform of a bridge candidate
//      record (mira-crawler/drive_pack_bridge.py::build_candidate_record) into
//      the ai_suggestions row shape. No IO.
//   2. insertDrivePackSuggestion(tenantId, suggestion) — insert + idempotency
//      (dedup on registry_manual_id + pdf_sha256), asserted via a mock client.

import { describe, it, expect, vi } from "vitest";
import {
  candidateToSuggestion,
  insertDrivePackSuggestion,
  InvalidCandidateError,
} from "@/lib/drive-pack-suggestion";

vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
import { withTenantContext } from "@/lib/tenant-context";

// A real bridge candidate record, as produced by build_candidate_record() and
// verified end-to-end in the step-1 bridge proof (change_state=changed_by_hash).
const CANDIDATE = {
  kind: "drive_pack_update_candidate",
  created_by: "kb_growth_bridge",
  review_only: true,
  promoted: false,
  trust_status: "candidate",
  change_state: "changed_by_hash",
  registry_manual_id: "rockwell_powerflex_525_520-um001",
  manual_source: {
    manufacturer: "Allen-Bradley",
    model: "PowerFlex 525",
    manual_id: "rockwell_powerflex_525_520-um001",
    vendor: "Rockwell Automation",
    product_family: "PowerFlex 525",
    publication: "520-UM001O-EN-E",
    revision: "O",
    source_url: "https://literature.rockwellautomation.com/…/520-um001_-en-e.pdf",
    source_classification: ["official", "downloadable_pdf", "requires_login"],
  },
  pdf_sha256: "ba2bd0f55a12cec73db09279994a0060fa09e37f4b4741308e5c29f765fd02b7",
  previously_registered_sha256:
    "b9445a63c78865037d22238ddedbb785b4309c9798da9da35029d628658636a6",
  ingest_timestamp: "2026-07-07T00:40:00",
  local_pdf_path: "/opt/mira/manuals/Rockwell/PowerFlex 525/pf525_520-um001.pdf",
  next_step:
    "python tools/drive-pack-extract/registry/update_candidate.py --manual /opt/mira/manuals/Rockwell/PowerFlex 525/pf525_520-um001.pdf --id rockwell_powerflex_525_520-um001",
  note: "REVIEW-ONLY. A changed/new manual creates this candidate; it does NOT replace a trusted pack.",
};

describe("candidateToSuggestion", () => {
  it("maps a changed-by-hash candidate to a drive_pack_update suggestion row", () => {
    const s = candidateToSuggestion(CANDIDATE);

    expect(s.suggestionType).toBe("drive_pack_update");
    expect(s.riskLevel).toBe("low");
    // A doc-change candidate is a review item, not a graded claim → neutral band.
    expect(s.confidence).toBe(0.5);
    // Human-readable headline names the drive family + that it changed.
    expect(s.title).toBe("Drive-pack update: PowerFlex 525 manual changed");
    // The body must carry the review-only doctrine and the exact next step.
    expect(s.body).toContain("REVIEW-ONLY");
    expect(s.body).toContain(CANDIDATE.next_step);
    // extracted_data carries the provenance the reviewer needs (schema-on-read).
    expect(s.extractedData.registry_manual_id).toBe(
      "rockwell_powerflex_525_520-um001",
    );
    expect(s.extractedData.pdf_sha256).toBe(CANDIDATE.pdf_sha256);
    expect(s.extractedData.previously_registered_sha256).toBe(
      CANDIDATE.previously_registered_sha256,
    );
    expect(s.extractedData.change_state).toBe("changed_by_hash");
    expect(s.extractedData.review_only).toBe(true);
    expect(s.extractedData.next_step).toBe(CANDIDATE.next_step);
  });

  it("uses a first-extraction title for a needs_initial_candidate change state", () => {
    const s = candidateToSuggestion({
      ...CANDIDATE,
      change_state: "needs_initial_candidate",
      previously_registered_sha256: null,
    });
    expect(s.title).toBe(
      "Drive-pack update: PowerFlex 525 manual ready for first extraction",
    );
    expect(s.extractedData.change_state).toBe("needs_initial_candidate");
    expect(s.extractedData.previously_registered_sha256).toBe(null);
  });

  it("rejects a record missing the required provenance fields", () => {
    expect(() => candidateToSuggestion({ pdf_sha256: "abc" })).toThrow(
      InvalidCandidateError,
    );
    // present-but-blank required field is still invalid
    expect(() =>
      candidateToSuggestion({ ...CANDIDATE, registry_manual_id: "" }),
    ).toThrow(InvalidCandidateError);
  });
});

describe("insertDrivePackSuggestion", () => {
  // Drive a single query client through the function and assert the SQL/params,
  // mirroring the repo's route-test convention (no real DB).
  function mockClient(rows: unknown[][]) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let i = 0;
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return { rows: rows[i++] ?? [] };
      }),
    };
    vi.mocked(withTenantContext).mockImplementation(
      async (_tid: string, fn: (c: unknown) => unknown) => fn(client),
    );
    return { client, calls };
  }

  const suggestion = candidateToSuggestion(CANDIDATE);

  it("inserts a new pending row when no duplicate exists", async () => {
    const { calls } = mockClient([[], [{ id: "new-id" }]]); // dedup miss, then INSERT
    const res = await insertDrivePackSuggestion("tenant-1", suggestion);
    expect(res).toEqual({ id: "new-id", created: true });
    // second query is the INSERT with the drive_pack_update type + row payload
    expect(calls[1].sql).toContain("INSERT INTO ai_suggestions");
    expect(calls[1].sql).toContain("drive_pack_update");
    expect(calls[1].params).toContain(suggestion.title);
  });

  it("is idempotent: an existing pending candidate is returned, not duplicated", async () => {
    const { client } = mockClient([[{ id: "existing-id" }]]); // dedup hit
    const res = await insertDrivePackSuggestion("tenant-1", suggestion);
    expect(res).toEqual({ id: "existing-id", created: false });
    // only the dedup SELECT ran — no INSERT
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
