// partitionVisualObservations — the client half of the visual trust loop
// (Slice 2 confirm / Slice 3 correct). Pure, so every branch is asserted here
// without the screen: the pre-edit reading must never be confirmed, and the two
// output sets must be disjoint.
import { describe, expect, it } from "vitest";
import { partitionVisualObservations } from "../nameplate-flow";
import { EMPTY_COMPONENT_IDENTITY } from "../../api/resources";

const OBS = [
  { observationId: "o-mfr", field: "manufacturer", value: "DURApulse" },
  { observationId: "o-model", field: "model", value: "GS10" },
  { observationId: "o-serial", field: "serialNumber", value: "SN-1" },
  { observationId: "o-cert", field: "certification", value: "UL" }, // not an identity field
];

describe("partitionVisualObservations", () => {
  it("unchanged → observationIds; edited → corrections; the sets are disjoint", () => {
    const identity = { ...EMPTY_COMPONENT_IDENTITY, manufacturer: "DURApulse", model: "GS20", serialNumber: "SN-1" };
    const out = partitionVisualObservations(identity, OBS);
    expect(out.observationIds).toEqual(["o-mfr", "o-serial"]);
    expect(out.corrections).toEqual([{ observationId: "o-model", value: "GS20" }]);
    const both = out.observationIds.filter((id) => out.corrections.some((c) => c.observationId === id));
    expect(both).toEqual([]);
  });

  it("an edited field's id is NEVER in observationIds (pre-edit reading is not confirmed)", () => {
    const identity = { ...EMPTY_COMPONENT_IDENTITY, manufacturer: "WEG", model: "GS10" };
    const out = partitionVisualObservations(identity, OBS);
    expect(out.observationIds).not.toContain("o-mfr");
    expect(out.corrections).toEqual([{ observationId: "o-mfr", value: "WEG" }]);
  });

  it("trims whitespace before comparing — surrounding spaces are not a correction", () => {
    const identity = { ...EMPTY_COMPONENT_IDENTITY, manufacturer: "  DURApulse ", model: " GS10" };
    const out = partitionVisualObservations(identity, OBS);
    expect(out.observationIds).toEqual(["o-mfr", "o-model"]);
    expect(out.corrections).toEqual([]);
  });

  it("an EMPTIED field is neither confirmed nor corrected (left as a candidate)", () => {
    const identity = { ...EMPTY_COMPONENT_IDENTITY, manufacturer: "DURApulse", model: "", serialNumber: "   " };
    const out = partitionVisualObservations(identity, OBS);
    expect(out.observationIds).toEqual(["o-mfr"]);
    expect(out.corrections).toEqual([]);
  });

  it("a field that is not on the identity form is ignored entirely", () => {
    const out = partitionVisualObservations({ ...EMPTY_COMPONENT_IDENTITY, manufacturer: "DURApulse" }, OBS);
    expect(out.observationIds).not.toContain("o-cert");
    expect(out.corrections.some((c) => c.observationId === "o-cert")).toBe(false);
  });

  it("no persisted observations (unbound notebook) → nothing to send", () => {
    expect(partitionVisualObservations({ ...EMPTY_COMPONENT_IDENTITY, manufacturer: "X", model: "Y" }, [])).toEqual({
      observationIds: [],
      corrections: [],
    });
  });
});
