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
