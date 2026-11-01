import { describe, expect, it } from "vitest";
import { documentRevision } from "../revision";
import type { DocText } from "../types";

function doc(pages: string[]): DocText {
  return {
    docId: "d1", fileId: null, filename: "5CP6120_G.pdf", via: "chunks",
    pages: pages.map((text, i) => ({ page: i + 1, text })),
  };
}

describe("documentRevision", () => {
  it("reads the data-sheet footer verbatim with page and line", () => {
    const f = documentRevision(doc(["PLUNGER PUMP DATA", "Kits\n  PN 993450 Rev G 22083 5/22  "]));
    expect(f).toMatchObject({ value: "PN 993450 Rev G", label: "verified" });
    expect(f.source).toMatchObject({ page: 2, line: "PN 993450 Rev G 22083 5/22", filename: "5CP6120_G.pdf" });
  });

  it("reads a service-manual footer without a date", () => {
    expect(documentRevision(doc(["Servicing the valves", "PN 30009 Rev J 8405"])).value).toBe("PN 30009 Rev J");
  });

  it("is unknown — never guessed — when no footer exists, even if the filename carries a letter", () => {
    const f = documentRevision(doc(["Model 5CP6120 revision unclear", "Rev G is mentioned mid-sentence here"]));
    expect(f).toMatchObject({ value: null, label: "unknown", source: null });
  });

  it("ignores 'Reverse pliers' and other words that start with Rev", () => {
    expect(documentRevision(doc(["PN 30696 Reverse Pliers (Not Shown) 1"])).value).toBeNull();
  });
});
