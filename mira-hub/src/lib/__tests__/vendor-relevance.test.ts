import { describe, expect, it } from "vitest";
import {
  resolveVendor,
  stripConflictingVendors,
  type VendorTaggable,
} from "../vendor-relevance";

const chunk = (manufacturer: string): VendorTaggable & { content: string } => ({
  manufacturer,
  content: `manual chunk for ${manufacturer || "<untagged>"}`,
});

describe("resolveVendor", () => {
  it("resolves canonical vendor names and aliases", () => {
    expect(resolveVendor("Danfoss")).toBe("Danfoss");
    expect(resolveVendor("Siemens")).toBe("Siemens");
    expect(resolveVendor("Allen-Bradley")).toBe("Rockwell Automation");
    expect(resolveVendor("PowerFlex 525")).toBe("Rockwell Automation");
    expect(resolveVendor("Rockwell Automation")).toBe("Rockwell Automation");
  });

  it("infers the vendor from a free-text question", () => {
    expect(resolveVendor("Why is my Danfoss aqua drive faulting?")).toBe("Danfoss");
    expect(resolveVendor("sinamics overvoltage on power-up")).toBe("Siemens");
  });

  it("returns null when no known vendor is mentioned", () => {
    expect(resolveVendor("the conveyor keeps stopping")).toBeNull();
    expect(resolveVendor("")).toBeNull();
    expect(resolveVendor(null)).toBeNull();
  });

  it("does not fire short aliases on substrings of unrelated words", () => {
    // "ab" (Rockwell), "sew" (SEW-Eurodrive), "delta" must be word-bounded.
    expect(resolveVendor("please grab the manual")).toBeNull();
    expect(resolveVendor("the question was answered")).toBeNull();
  });

  it("prefers the longest/most-specific alias", () => {
    expect(resolveVendor("Rockwell Automation PowerFlex")).toBe("Rockwell Automation");
    expect(resolveVendor("Bosch Rexroth")).toBe("Bosch Rexroth");
  });
});

describe("stripConflictingVendors", () => {
  it("strips a Siemens chunk from a Danfoss query (the core case)", () => {
    const chunks = [chunk("Danfoss"), chunk("Siemens"), chunk("Danfoss")];
    const out = stripConflictingVendors(chunks, "Danfoss");
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.manufacturer === "Danfoss")).toBe(true);
  });

  it("infers the query vendor from question text when no explicit vendor", () => {
    const chunks = [chunk("Siemens"), chunk("Danfoss")];
    const out = stripConflictingVendors(chunks, "my Danfoss VLT is tripping");
    expect(out).toHaveLength(1);
    expect(out[0].manufacturer).toBe("Danfoss");
  });

  it("keeps untagged / generic chunks", () => {
    const chunks = [chunk("Danfoss"), chunk(""), chunk("Siemens")];
    const out = stripConflictingVendors(chunks, "Danfoss");
    // Danfoss kept, untagged kept, Siemens dropped
    expect(out.map((c) => c.manufacturer)).toEqual(["Danfoss", ""]);
  });

  it("keeps chunks tagged with an unknown vendor (cannot prove a conflict)", () => {
    const chunks = [chunk("Danfoss"), chunk("Acme Custom Drives")];
    const out = stripConflictingVendors(chunks, "Danfoss");
    expect(out).toHaveLength(2);
  });

  it("keeps alias-family matches (Allen-Bradley for a PowerFlex query)", () => {
    const chunks = [chunk("Allen-Bradley"), chunk("Siemens")];
    const out = stripConflictingVendors(chunks, "PowerFlex 525 fault F004");
    expect(out).toHaveLength(1);
    expect(out[0].manufacturer).toBe("Allen-Bradley");
  });

  it("strips a wrong-vendor chunk sharing the same fault code (#1875 code-pass leak guard)", () => {
    // The #1875 fault-code pass can surface another vendor's F004 chunk; the
    // route runs this strip on the merged set, so the wrong vendor never leaks
    // into the answer/citations for an Allen-Bradley question.
    const chunks = [chunk("Rockwell Automation"), chunk("Siemens")];
    const out = stripConflictingVendors(
      chunks,
      "My Allen-Bradley PowerFlex 525 is showing fault F004",
    );
    expect(out).toHaveLength(1);
    expect(out[0].manufacturer).toBe("Rockwell Automation");
  });

  it("does not strip when the query resolves to no known vendor", () => {
    const chunks = [chunk("Danfoss"), chunk("Siemens")];
    const out = stripConflictingVendors(chunks, "the drive keeps tripping");
    expect(out).toHaveLength(2);
  });

  it("strips to empty when every chunk is a different known vendor (#2183)", () => {
    // The public quickstart cited Rockwell PowerMonitor pages for a "Yaskawa
    // GS20 F030" question because the never-empty guard kept wrong-vendor
    // chunks when no Yaskawa chunk existed. Returning [] lets the cite-or-refuse
    // prompt refuse honestly instead of fabricating a wrong-manufacturer cite.
    const chunks = [chunk("Siemens"), chunk("ABB")];
    const out = stripConflictingVendors(chunks, "Danfoss");
    expect(out).toHaveLength(0);
  });

  it("strips Rockwell+AutomationDirect for a Yaskawa question — the #2183 scenario", () => {
    const chunks = [chunk("Rockwell Automation"), chunk("AutomationDirect")];
    const out = stripConflictingVendors(
      chunks,
      "Yaskawa GS20 showing fault code F030, trips 3 seconds after startup",
    );
    expect(out).toHaveLength(0);
  });

  it("keeps generic/untagged chunks even when all tagged chunks conflict", () => {
    // The strip never empties a result that had any usable (generic/unknown)
    // chunk — only positively-different known vendors are dropped.
    const chunks = [chunk("Siemens"), chunk(""), chunk("Acme Custom Drives")];
    const out = stripConflictingVendors(chunks, "Danfoss");
    expect(out.map((c) => c.manufacturer)).toEqual(["", "Acme Custom Drives"]);
  });

  it("returns the input unchanged for an empty chunk list", () => {
    expect(stripConflictingVendors([], "Danfoss")).toEqual([]);
  });
});
