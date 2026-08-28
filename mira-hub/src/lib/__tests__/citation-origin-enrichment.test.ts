// Pure half of the Invariant-3 read path (085): persisted evidence citations
// gain their canonical origin from the (superseded-inclusive) origin map,
// without ever overwriting an origin the server already stamped.
//
// Run: cd mira-hub && npx vitest run src/lib/__tests__/citation-origin-enrichment

import { describe, it, expect } from "vitest";
import { enrichCitationsWithOrigin } from "../equipment-notebooks";

const DOC = "d0000000-0000-4000-8000-000000000001";
const PHOTO = "f0000000-0000-4000-8000-000000000001";
const OTHER = "f0000000-0000-4000-8000-000000000002";

describe("enrichCitationsWithOrigin", () => {
  it("adds the origin to a pre-085 citation that lacks one", () => {
    const out = enrichCitationsWithOrigin(
      [{ citationId: "1", docId: DOC, fileId: "txt-file" }],
      new Map([[DOC, PHOTO]]),
    ) as Array<{ originFileId?: string }>;
    expect(out[0].originFileId).toBe(PHOTO);
  });

  it("never overwrites an origin already present", () => {
    const out = enrichCitationsWithOrigin(
      [{ citationId: "1", docId: DOC, originFileId: OTHER }],
      new Map([[DOC, PHOTO]]),
    ) as Array<{ originFileId?: string }>;
    expect(out[0].originFileId).toBe(OTHER);
  });

  it("leaves ordinary-document citations and malformed entries untouched", () => {
    const plain = { citationId: "2", docId: "unmapped-doc", fileId: "pdf-file" };
    const out = enrichCitationsWithOrigin(
      [plain, null, "junk", { noDocId: true }],
      new Map([[DOC, PHOTO]]),
    );
    expect(out[0]).toBe(plain); // same reference — untouched, no originFileId invented
    expect(out[1]).toBeNull();
    expect(out[2]).toBe("junk");
    expect(out[3]).toEqual({ noDocId: true });
  });
});

describe("machine evidence entries (Sensor S4, D5) ride in evidence[] and are skipped", () => {
  const machine = {
    kind: "machine_evidence",
    assetId: "a1",
    anchorAt: "2026-08-27T23:16:31.000Z",
    pre: 5,
    post: 2,
    rowCount: 7,
    freshness: "stale",
  };

  it("enrichCitationsWithOrigin passes a machine entry through untouched (no docId → never enriched)", () => {
    const out = enrichCitationsWithOrigin(
      [{ citationId: "1", docId: DOC, fileId: "txt-file" }, machine],
      new Map([[DOC, PHOTO]]),
    ) as Array<Record<string, unknown>>;
    expect(out[0].originFileId).toBe(PHOTO);
    expect(out[1]).toBe(machine); // same reference — not a citation, not touched
    expect(out[1]).not.toHaveProperty("originFileId");
  });

  it("passes ANY docId-less entry through untouched — a visual_observation (S5 D3) included", () => {
    const visual = { kind: "visual_observation", fileId: PHOTO, capturedAt: "2026-08-27T23:14:21.000Z", provenance: "phone_photo" };
    const out = enrichCitationsWithOrigin([visual, { citationId: "1", docId: DOC }], new Map([[DOC, PHOTO]])) as Array<Record<string, unknown>>;
    expect(out[0]).toBe(visual);
    expect(out[1].originFileId).toBe(PHOTO);
  });
});
