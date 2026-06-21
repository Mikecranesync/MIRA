import { describe, it, expect } from "vitest";
import {
  viewFromImportResponse,
  proposalsCreated,
  confidenceTone,
  type PlcParsedView,
} from "../plc-import-view";

const parsedBody = {
  report: {
    schema: "mira-plc-parser/report@1",
    detection: { fmt: "rockwell_l5x", confidence: "high", reason: "found <RSLogix5000Content>", needs_export: "" },
    handled: true,
    controller: "ConveyorControl",
    vendor: "Rockwell Automation",
    counts: {
      tags: 12, programs: 1, routines: 2, rungs: 6,
      fault_candidates: 4, asset_candidates: 3, vfd_signal_candidates: 4,
      review_required: 1, uns_candidates: 12,
    },
    review_required: [{ name: "E_Stop", detail: "safety/e-stop pattern", confidence: "review", evidence: [] }],
    uns_candidates: [
      { tag: "Conv_Fault", data_type: "BOOL", path: "enterprise/site1/area1/conveyorcontrol/conv/fault",
        signal: "fault", asset: "conv", standardized: true, confidence: "high", evidence: "VFD signal role + asset 'conv'" },
      { tag: "Misc_Bit", data_type: "", path: "enterprise/site1/area1/conveyorcontrol/misc_bit",
        signal: "misc_bit", asset: "", standardized: false, confidence: "low", evidence: "tag name" },
    ],
    warnings: ["1 variable(s) inferred from ST assignments"],
  },
};

describe("viewFromImportResponse", () => {
  it("maps a parsed report into the parsed view (controller, counts, candidates)", () => {
    const v = viewFromImportResponse(200, parsedBody) as PlcParsedView;
    expect(v.kind).toBe("parsed");
    expect(v.controller).toBe("ConveyorControl");
    expect(v.vendor).toBe("Rockwell Automation");
    expect(v.fmt).toBe("rockwell_l5x");
    expect(v.counts.tags).toBe(12);
    expect(v.counts.unsCandidates).toBe(12);
    expect(v.candidates).toHaveLength(2);
    expect(v.candidates[0]).toMatchObject({
      tag: "Conv_Fault", dataType: "BOOL",
      path: "enterprise/site1/area1/conveyorcontrol/conv/fault", confidence: "high", standardized: true,
    });
    expect(v.reviewRequired[0]).toMatchObject({ name: "E_Stop" });
    expect(v.warnings).toContain("1 variable(s) inferred from ST assignments");
  });

  it("maps a 422 closed-project response to export guidance", () => {
    const v = viewFromImportResponse(422, {
      report: { handled: false, detection: { fmt: "rockwell_acd", needs_export: "Export it to L5X and resend the .L5X." } },
    });
    expect(v).toEqual({ kind: "export_needed", fmt: "rockwell_acd", guidance: "Export it to L5X and resend the .L5X." });
  });

  it("maps handled:false with only a warning to unsupported", () => {
    const v = viewFromImportResponse(200, { report: { handled: false, detection: { fmt: "unknown" }, warnings: ["unrecognized format"] } });
    expect(v).toEqual({ kind: "unsupported", reason: "unrecognized format" });
  });

  it("maps 413 / 503 to friendly unsupported messages", () => {
    expect(viewFromImportResponse(413, {}).kind).toBe("unsupported");
    expect((viewFromImportResponse(413, {}) as { reason: string }).reason).toMatch(/size limit/i);
    expect((viewFromImportResponse(503, {}) as { reason: string }).reason).toMatch(/available/i);
  });

  it("tolerates a bare report (no sidecar envelope)", () => {
    const v = viewFromImportResponse(200, parsedBody.report) as PlcParsedView;
    expect(v.kind).toBe("parsed");
    expect(v.controller).toBe("ConveyorControl");
  });

  it("never throws on garbage input", () => {
    expect(viewFromImportResponse(200, null).kind).toBe("unsupported");
    expect(viewFromImportResponse(200, undefined).kind).toBe("unsupported");
  });
});

describe("proposalsCreated", () => {
  it("returns the count when committed", () => {
    expect(proposalsCreated({ committed: true, proposalsCreated: 12 })).toBe(12);
  });
  it("returns null when not committed", () => {
    expect(proposalsCreated({ committed: false })).toBeNull();
    expect(proposalsCreated({})).toBeNull();
  });
});

describe("confidenceTone", () => {
  it("bands high/medium/low (default medium)", () => {
    expect(confidenceTone("high")).toBe("high");
    expect(confidenceTone("LOW")).toBe("low");
    expect(confidenceTone("medium")).toBe("medium");
    expect(confidenceTone("")).toBe("medium");
    expect(confidenceTone("weird")).toBe("medium");
  });
});
