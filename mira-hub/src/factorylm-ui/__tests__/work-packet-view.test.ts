// Work Packet phone panel (#4982 section E) — pure helpers. No fetch, no DOM: see
// work-packet-view.ts's own header. Run: cd mira-hub && npx vitest run src/factorylm-ui/__tests__/work-packet-view
import { describe, expect, it } from "vitest";
import type { Field, SourceRef, WorkPacket } from "@/capabilities/work-packet/types";
import {
  badgeText,
  cautionFieldPath,
  confirmedRevisionsPayload,
  confidencePercent,
  equipmentFieldPath,
  measurementFieldPath,
  partFieldPath,
  printTitle,
  scopeFieldPath,
  SITE_ISOLATION_PATH,
  sourceChipLabel,
  stepFieldPath,
  syntheticDemoWorkOrder,
  toolFieldPath,
  unknownFieldPath,
} from "../work-packet-view";

const SOURCE: SourceRef = { docId: "doc-1", fileId: null, filename: "3520_J.pdf", page: 4, line: "Crankcase Capacity 4.2 qts 4 l" };

function field(label: Field["label"], value: string | null = "x"): Field {
  return { value, label, source: label === "unknown" ? null : SOURCE, basis: "test" };
}

describe("badgeText", () => {
  it("maps every Label to its display text", () => {
    expect(badgeText("verified")).toBe("Verified");
    expect(badgeText("proposed")).toBe("Proposed");
    expect(badgeText("unknown")).toBe("Unknown");
  });
});

describe("field edit paths (PacketEdit.path grammar)", () => {
  it("equipmentFieldPath — no index, dotted under equipment", () => {
    expect(equipmentFieldPath("manufacturer")).toBe("equipment.manufacturer");
    expect(equipmentFieldPath("model")).toBe("equipment.model");
    expect(equipmentFieldPath("serial")).toBe("equipment.serial");
  });
  it("scopeFieldPath — bare array index (scope is Field[])", () => {
    expect(scopeFieldPath(0)).toBe("scope[0]");
    expect(scopeFieldPath(3)).toBe("scope[3]");
  });
  it("cautionFieldPath — nested under safety.cautions", () => {
    expect(cautionFieldPath(2)).toBe("safety.cautions[2]");
  });
  it("SITE_ISOLATION_PATH — the one non-array safety field", () => {
    expect(SITE_ISOLATION_PATH).toBe("safety.siteIsolation");
  });
  it("partFieldPath — index plus the exact sub-field named in types.ts' own example", () => {
    expect(partFieldPath(2, "qty")).toBe("parts[2].qty");
    expect(partFieldPath(0, "partNumber")).toBe("parts[0].partNumber");
    expect(partFieldPath(1, "description")).toBe("parts[1].description");
  });
  it("toolFieldPath — bare array index (tools is Field[]), matches types.ts' example", () => {
    expect(toolFieldPath(0)).toBe("tools[0]");
  });
  it("stepFieldPath — always .text, matches types.ts' example", () => {
    expect(stepFieldPath(3)).toBe("steps[3].text");
  });
  it("measurementFieldPath — index plus sub-field, matches types.ts' example for 'value'", () => {
    expect(measurementFieldPath(1, "value")).toBe("measurements[1].value");
    expect(measurementFieldPath(1, "name")).toBe("measurements[1].name");
    expect(measurementFieldPath(1, "tool")).toBe("measurements[1].tool");
  });
  it("unknownFieldPath — bare array index (unknowns is Field[])", () => {
    expect(unknownFieldPath(5)).toBe("unknowns[5]");
  });
});

describe("sourceChipLabel", () => {
  it("renders 'p.N filename'", () => {
    expect(sourceChipLabel(SOURCE)).toBe("p.4 3520_J.pdf");
  });
  it("falls back to 'document' when the source has no filename (chunk-sourced doc)", () => {
    expect(sourceChipLabel({ ...SOURCE, filename: null })).toBe("p.4 document");
  });
  it("is null when there is no source (an unknown field)", () => {
    expect(sourceChipLabel(null)).toBeNull();
  });
});

describe("confidencePercent", () => {
  it("formats 0..1 as a rounded percentage", () => {
    expect(confidencePercent(0.87)).toBe("87%");
    expect(confidencePercent(1)).toBe("100%");
    expect(confidencePercent(0)).toBe("0%");
  });
  it("clamps an out-of-range value instead of printing a nonsense percentage", () => {
    expect(confidencePercent(1.4)).toBe("100%");
    expect(confidencePercent(-0.2)).toBe("0%");
  });
  it("reports honestly when the provider gave no confidence (never invents a number)", () => {
    expect(confidencePercent(null)).toBe("confidence not reported");
    expect(confidencePercent(undefined)).toBe("confidence not reported");
    expect(confidencePercent(Number.NaN)).toBe("confidence not reported");
  });
});

describe("syntheticDemoWorkOrder", () => {
  const wo = syntheticDemoWorkOrder("demo-id-1");
  it("is stamped synthetic:true, visible per the task's acceptance criterion", () => {
    expect(wo.synthetic).toBe(true);
  });
  it("names the CAT Pumps 3520 reseal scenario", () => {
    expect(wo.title).toMatch(/3520/);
    expect(wo.description).toMatch(/3520/i);
    expect(wo.description).toMatch(/SYNTHETIC/);
  });
  it("uses exactly the id the caller supplied — it never mints its own", () => {
    expect(wo.id).toBe("demo-id-1");
    expect(syntheticDemoWorkOrder("other-id").id).toBe("other-id");
  });
});

describe("printTitle", () => {
  const base: Pick<WorkPacket, "workOrder" | "equipment"> = {
    workOrder: { id: "wo-1", title: "t", description: "d", assetTag: null, site: null, synthetic: false },
    equipment: {
      manufacturer: field("verified", "CAT Pumps"),
      model: field("verified", "3520"),
      serial: field("unknown", null),
      identityStatus: "user_confirmed",
    },
  };
  it("carries manufacturer, model and the work order id", () => {
    expect(printTitle(base)).toBe("DRAFT Work Packet — CAT Pumps 3520 — WO wo-1");
  });
  it("marks a synthetic work order so an exported demo can't be mistaken for a real job", () => {
    const synthetic: typeof base = { ...base, workOrder: { ...base.workOrder, synthetic: true } };
    expect(printTitle(synthetic)).toBe("DRAFT Work Packet — CAT Pumps 3520 — WO wo-1 — SYNTHETIC");
  });
  it("names the gap honestly when identity isn't known yet (never invents a model)", () => {
    const blank: typeof base = {
      ...base,
      equipment: { ...base.equipment, manufacturer: field("unknown", null), model: field("unknown", null) },
    };
    expect(printTitle(blank)).toBe("DRAFT Work Packet — Unknown manufacturer unknown model — WO wo-1");
  });
});

describe("confirmedRevisionsPayload", () => {
  const docs = [
    { docId: "d1", revision: field("verified", "PN 993450 Rev G") },
    { docId: "d2", revision: field("unknown", null) },
  ];
  it("sends nothing until the technician ticks the confirm box", () => {
    expect(confirmedRevisionsPayload(false, docs)).toEqual([]);
  });
  it("sends every shown document with the exact revision on screen, null when unknown", () => {
    expect(confirmedRevisionsPayload(true, docs)).toEqual([
      { docId: "d1", revision: "PN 993450 Rev G" },
      { docId: "d2", revision: null },
    ]);
  });
});
