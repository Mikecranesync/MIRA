// Vitest coverage for citation-relevance filtering on the public quickstart path.
//
// Run: cd mira-hub && npx vitest run src/lib/manual-rag
//
// PURE function — no DB. Guards the GTM RED #2 fix: BM25's tenant-wide fallback
// can surface a chunk from the wrong vendor (e.g. a Siemens manual for a Danfoss
// question). filterCitationsByRelevance drops those before they reach the model.

import { describe, it, expect } from "vitest";
import { filterCitationsByRelevance, type ManualChunk } from "./manual-rag";

function chunk(partial: Partial<ManualChunk>): ManualChunk {
  return {
    content: "",
    manufacturer: "",
    modelNumber: "",
    sourceUrl: "",
    sourcePage: null,
    title: "",
    rank: 0,
    ...partial,
  };
}

describe("filterCitationsByRelevance", () => {
  const danfoss = chunk({ manufacturer: "Danfoss", modelNumber: "VLT 2800" });
  const siemens = chunk({ manufacturer: "Siemens", modelNumber: "SINAMICS G120" });
  const generic = chunk({ manufacturer: "", title: "How a VFD works" });

  it("drops the wrong-vendor chunk when a manufacturer is asked", () => {
    const out = filterCitationsByRelevance([danfoss, siemens], "Danfoss");
    expect(out).toEqual([danfoss]);
  });

  it("keeps generic (no-manufacturer) chunks as educational carve-outs", () => {
    const out = filterCitationsByRelevance([siemens, generic], "Danfoss");
    expect(out).toEqual([generic]);
  });

  it("passes everything through when no manufacturer is asked", () => {
    const all = [danfoss, siemens, generic];
    expect(filterCitationsByRelevance(all, null)).toEqual(all);
    expect(filterCitationsByRelevance(all, "")).toEqual(all);
  });

  it("matches case- and spacing-insensitively", () => {
    const rockwell = chunk({ manufacturer: "Rockwell Automation" });
    expect(filterCitationsByRelevance([rockwell], "rockwell")).toEqual([rockwell]);
    expect(filterCitationsByRelevance([rockwell], "ROCKWELL AUTOMATION")).toEqual([
      rockwell,
    ]);
  });

  it("recovers the vendor from model number or source URL when the manufacturer field is mislabeled", () => {
    // Non-blank manufacturer that does NOT match the asked vendor, but the real
    // vendor is encoded in the model number / source URL — must be rescued, not
    // dropped (this is the branch past the blank-manufacturer carve-out).
    const byModel = chunk({ manufacturer: "OEM Docs", modelNumber: "Danfoss VLT 2800" });
    const byUrl = chunk({ manufacturer: "Distributor", sourceUrl: "https://danfoss.com/vlt.pdf" });
    const out = filterCitationsByRelevance([byModel, byUrl, siemens], "Danfoss");
    expect(out).toEqual([byModel, byUrl]);
  });

  it("never mutates the input array", () => {
    const input = [danfoss, siemens];
    filterCitationsByRelevance(input, "Danfoss");
    expect(input).toHaveLength(2);
  });
});
