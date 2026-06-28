import { describe, expect, it } from "vitest";
import { reportToExtractions, type ParseReport } from "../parse-source";

const IDS = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  projectId: "22222222-2222-2222-2222-222222222222",
  sourceId: "33333333-3333-3333-3333-333333333333",
};

describe("reportToExtractions", () => {
  it("maps one row per tag, pulling UNS path/confidence/evidence from the matching candidate", () => {
    const report: ParseReport = {
      detection: { fmt: "l5x" },
      tag_dictionary: [
        { name: "Conv_Run", roles: ["output"], used_in: ["MainRoutine"], confidence: "high" },
      ],
      uns_candidates: [
        {
          tag: "Conv_Run",
          path: "enterprise/site/area/line/conveyor/run",
          confidence: "medium",
          evidence: "VFD signal role",
        },
      ],
    };

    const rows = reportToExtractions(report, IDS);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.tagName).toBe("Conv_Run");
    expect(r.roles).toEqual(["output"]);
    expect(r.unsPath).toBe("enterprise/site/area/line/conveyor/run");
    expect(r.i3xElementId).toBe(r.unsPath);
    // uns_candidate confidence (medium) wins over the tag's (high)
    expect(r.confidence).toBe(0.6);
    expect(r.evidence).toMatchObject({
      source_format: "l5x",
      used_in: ["MainRoutine"],
      confidence_source: "medium",
      uns_evidence: "VFD signal role",
    });
    expect(r.tenantId).toBe(IDS.tenantId);
    expect(r.projectId).toBe(IDS.projectId);
    expect(r.sourceId).toBe(IDS.sourceId);
  });

  it("falls back to the tag's own confidence and null UNS when no candidate matches", () => {
    const report: ParseReport = {
      detection: { fmt: "csv" },
      tag_dictionary: [{ name: "Spare_Bit", roles: [], confidence: "low" }],
      uns_candidates: [],
    };

    const rows = reportToExtractions(report, IDS);
    expect(rows).toHaveLength(1);
    expect(rows[0].unsPath).toBeNull();
    expect(rows[0].i3xElementId).toBeNull();
    expect(rows[0].confidence).toBe(0.3);
    expect(rows[0].evidence).toMatchObject({ confidence_source: "low", uns_evidence: null });
  });

  it("skips tags with no name and truncates used_in to 6 entries", () => {
    const report: ParseReport = {
      tag_dictionary: [
        { name: "", roles: [] },
        {
          name: "Busy_Tag",
          roles: ["input"],
          used_in: ["a", "b", "c", "d", "e", "f", "g", "h"],
        },
      ],
    };

    const rows = reportToExtractions(report, IDS);
    expect(rows).toHaveLength(1);
    expect(rows[0].tagName).toBe("Busy_Tag");
    expect((rows[0].evidence.used_in as string[]).length).toBe(6);
  });

  it("returns [] for an empty report", () => {
    expect(reportToExtractions({}, IDS)).toEqual([]);
  });

  it("assigns a unique id per row", () => {
    const report: ParseReport = {
      tag_dictionary: [{ name: "A" }, { name: "B" }],
    };
    const rows = reportToExtractions(report, IDS);
    expect(rows[0].id).not.toBe(rows[1].id);
  });
});
