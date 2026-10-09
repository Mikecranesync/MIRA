import { describe, expect, it } from "vitest";
import { buildRetrievalQuery } from "@/lib/notebook-query";

const photo = "Teal handheld. LCD display shows 'PERI', 'RD', and '1'. Buttons read MODE and PRG. A brown surface is behind it.";
describe("current photo retrieval focus", () => {
  it("retrieves literal display text for a referential first question", () => {
    const q = buildRetrievalQuery("Does this help?", [], photo);
    expect(q).toContain("PERI");
    expect(q).toContain("RD");
    expect(q).not.toContain("PRG");
    expect(q).not.toContain("brown");
  });
  it("does not let a previous photo subject displace the current readout", () => {
    const q = buildRetrievalQuery("Does this help?", [{ role: "user", content: "What is Ethernet parameter P042?" }], photo);
    expect(q).toContain("PERI");
    expect(q).not.toContain("P042");
  });
  it("keeps an explicitly named fault question focused", () => {
    expect(buildRetrievalQuery("What does F004 mean?", [], photo)).toBe("What does F004 mean?");
  });
  it("preserves no-photo history behavior", () => {
    expect(buildRetrievalQuery("Where is it?", [{ role: "user", content: "Ethernet P042" }])).toContain("P042");
  });
  it("does not correct an uncertain mode label or turn it into a meaning", () => {
    const q = buildRetrievalQuery("Does this help?", [], "LCD display shows 'ID i', 'RD', and 'F'; label partially obscured.");
    expect(q).toContain("ID i");
    expect(q).not.toContain("ID1");
    expect(q).not.toContain("fault");
  });
});
