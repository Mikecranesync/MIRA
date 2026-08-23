/**
 * The asset context card's state mapper (plan slice I3).
 *
 * Pure, so the tones can be asserted without a DOM — and so the "selected is
 * not confirmed" distinction is testable rather than a styling accident.
 */
import { describe, expect, it } from "vitest";
import { assetCardState } from "../notebook-asset-card";
import type { ResolvedAsset } from "../equipment-notebooks";

const RESOLVED: Extract<ResolvedAsset, { state: "resolved" }> = {
  state: "resolved",
  entityId: "ee715d08-4ea6-4b7a-b99b-958a33c39ea8",
  name: "Discharge Conveyor",
  unsPath: "enterprise.home_garage.conveyor_lab.conveyor_1",
  selectedVia: "qr",
  confirmedAt: null,
};

describe("assetCardState", () => {
  it("a scanned-but-unconfirmed binding is amber and says so", () => {
    const s = assetCardState(RESOLVED);
    expect(s.tone).toBe("unconfirmed");
    expect(s.headline).toBe("Discharge Conveyor");
    expect(s.detail).toContain("QR sticker");
    expect(s.detail).toContain("not yet confirmed");
    // Still usable — the technician can ask; they are told the identity is unproven.
    expect(s.canDiagnose).toBe(true);
  });

  it("a confirmed binding is confirmed", () => {
    const s = assetCardState({ ...RESOLVED, confirmedAt: "2026-08-23T10:00:00Z" });
    expect(s.tone).toBe("confirmed");
    expect(s.detail).not.toContain("not yet confirmed");
  });

  it("an unresolvable binding refuses diagnosis and explains the fix", () => {
    const s = assetCardState({ state: "unresolvable", entityId: "gone" });
    expect(s.tone).toBe("unresolvable");
    expect(s.canDiagnose).toBe(false);
    expect(s.detail).toContain("Re-select");
    // Never leak the raw key to a technician.
    expect(s.detail).not.toContain("gone");
  });

  it("an unbound notebook asks for a machine without implying an error", () => {
    const s = assetCardState({ state: "unbound" });
    expect(s.tone).toBe("unbound");
    expect(s.headline).toBe("No machine selected");
    expect(s.canDiagnose).toBe(true);
  });

  it("names the selection method in plain words, never the enum value", () => {
    expect(assetCardState({ ...RESOLVED, selectedVia: "nfc" }).detail).toContain("NFC tag");
    expect(assetCardState({ ...RESOLVED, selectedVia: "work_order" }).detail).toContain("work order");
    expect(assetCardState({ ...RESOLVED, selectedVia: "work_order" }).detail).not.toContain("work_order");
  });

  it("emits no colour literal — tones map to --fl-* tokens at the component edge", () => {
    const states: ResolvedAsset[] = [
      RESOLVED,
      { ...RESOLVED, confirmedAt: "2026-08-23T10:00:00Z" },
      { state: "unresolvable", entityId: "x" },
      { state: "unbound" },
    ];
    for (const st of states) {
      const rendered = JSON.stringify(assetCardState(st));
      expect(rendered).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(rendered).not.toMatch(/\b(rgb|hsl)a?\(/i);
      expect(rendered).not.toMatch(/\b(amber|green|red|gray|grey)\b/i);
    }
  });

  it("survives an asset with no name rather than rendering an empty headline", () => {
    expect(assetCardState({ ...RESOLVED, name: "" }).headline.length).toBeGreaterThan(0);
  });
});
