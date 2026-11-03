// Work Packet wording helpers — the chip, the label legend, the technician-entry marker and the
// direct-link check. Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-wording
import { describe, expect, it } from "vitest";
import type { Field, SourceRef } from "@/capabilities/work-packet/types";
import { LABEL_LEGEND, quoteChipLabel, technicianEntryNote, wantsPacketOpen } from "../work-packet-view";

const SRC = { docId: "d1", filename: "manual.pdf", page: 6, line: "Torque 30 ft-lbs" } as unknown as SourceRef;
const AT = "2026-11-02T17:05:44.000Z";
const reviewed = (action: "set" | "confirm" | "strike" | "mark_unknown"): Pick<Field, "review"> => ({
  review: { path: "steps[0].text", action, by: "tech@x", at: AT, previous: "a", next: "b" },
});

describe("quoteChipLabel — the chip says it shows a quote, not the original page", () => {
  it("names the quote and the page", () => {
    expect(quoteChipLabel(SRC)).toBe("Show quote · p.6 manual.pdf");
  });
  it("no source, no chip", () => {
    expect(quoteChipLabel(null)).toBeNull();
  });
});

describe("LABEL_LEGEND — Verified means supported for this model, not approved", () => {
  const meaning = (l: string) => LABEL_LEGEND.find((e) => e.label === l)?.meaning ?? "";
  it("covers the three labels", () => {
    expect(LABEL_LEGEND.map((e) => e.label)).toEqual(["verified", "proposed", "unknown"]);
  });
  it("verified says this exact model and not field approval", () => {
    expect(meaning("verified")).toMatch(/exact model/);
    expect(meaning("verified")).toMatch(/not an approval for field use/);
  });
  it("unknown says nothing is guessed", () => {
    expect(meaning("unknown")).toMatch(/Nothing is guessed/);
  });
});

describe("technicianEntryNote — a technician's change never reads as manual text", () => {
  it("a correction is marked as not from the manual, with who and when", () => {
    expect(technicianEntryNote(reviewed("set"))).toBe("Technician entry by tech@x, 2026-11-02 17:05 UTC — not from the manual");
  });
  it("strike, unknown and confirm are each named", () => {
    expect(technicianEntryNote(reviewed("strike"))).toMatch(/^Struck by tech@x/);
    expect(technicianEntryNote(reviewed("mark_unknown"))).toMatch(/^Marked unknown by tech@x/);
    expect(technicianEntryNote(reviewed("confirm"))).toMatch(/^Line reviewed by tech@x/);
  });
  it("control: an untouched line has no marker", () => {
    expect(technicianEntryNote({})).toBeNull();
  });
});

describe("wantsPacketOpen — the direct link", () => {
  it("opens on workpacket=open", () => {
    expect(wantsPacketOpen("?notebook=abc&workpacket=open")).toBe(true);
  });
  it("control: other values and no parameter do not open it", () => {
    expect(wantsPacketOpen("?notebook=abc")).toBe(false);
    expect(wantsPacketOpen("?workpacket=1")).toBe(false);
  });
});
