import { describe, expect, it } from "vitest";
import { searchJobSheets, draftBadge, previewRows } from "./job-sheet-library-logic";
import type { JobSheetSummary } from "@/capabilities/living-sheet/job-sheet-store";
import type { ImportPreview } from "@/capabilities/living-sheet/job-sheet-import";
import type { JobSheetBody } from "@/capabilities/living-sheet/types";

function body(over: Partial<JobSheetBody> = {}): JobSheetBody {
  return {
    title: "Front wheel bearing service",
    machineLabel: "Bike-Stand-7",
    component: "Front hub",
    jobType: "pm",
    estHours: null,
    crewSize: null,
    isolationPoints: null,
    cautions: null,
    returnToService: [],
    items: [],
    torques: [],
    steps: [],
    author: null,
    notes: null,
    ...over,
  };
}

function summary(id: string, over: Partial<JobSheetBody> = {}, status: "draft" | "reviewed" = "draft"): JobSheetSummary {
  return {
    jobSheetId: id,
    latest: {
      id: `${id}-rev`,
      jobSheetId: id,
      revision: 1,
      status,
      body: body(over),
      createdBy: "tech1",
      createdAt: "2026-11-03T00:00:00.000Z",
      reviewedBy: status === "reviewed" ? "tech1" : null,
      reviewedAt: status === "reviewed" ? "2026-11-03T00:00:00.000Z" : null,
    },
    latestReviewed: null,
  };
}

describe("searchJobSheets", () => {
  const list = [
    summary("1", { title: "Front wheel bearing service", machineLabel: "Bike-Stand-7", component: "Front hub" }),
    summary("2", { title: "Chain tension check", machineLabel: "Bike-Stand-3", component: null }),
    summary("3", { title: "Brake pad swap", machineLabel: "Bike-Stand-7", component: "Rear brake" }),
  ];

  it("a blank query returns the full list, unchanged order", () => {
    expect(searchJobSheets(list, "")).toEqual(list);
    expect(searchJobSheets(list, "   ")).toEqual(list);
  });

  it("matches by title, case-insensitively", () => {
    const result = searchJobSheets(list, "BEARING");
    expect(result.map((s) => s.jobSheetId)).toEqual(["1"]);
  });

  it("matches by machine label, pulling in every sheet on that machine", () => {
    const result = searchJobSheets(list, "bike-stand-7");
    expect(result.map((s) => s.jobSheetId)).toEqual(["1", "3"]);
  });

  it("matches by component", () => {
    const result = searchJobSheets(list, "rear brake");
    expect(result.map((s) => s.jobSheetId)).toEqual(["3"]);
  });

  it("a null component on a sheet never crashes the search and never false-matches", () => {
    expect(() => searchJobSheets(list, "null")).not.toThrow();
    expect(searchJobSheets(list, "null").map((s) => s.jobSheetId)).toEqual([]);
  });

  it("no match returns an empty list", () => {
    expect(searchJobSheets(list, "transmission overhaul")).toEqual([]);
  });
});

describe("draftBadge", () => {
  it("a draft revision shows the DRAFT badge", () => {
    expect(draftBadge("draft")).toBe("DRAFT");
  });

  it("a reviewed revision shows no badge", () => {
    expect(draftBadge("reviewed")).toBeNull();
  });
});

describe("previewRows", () => {
  function importedJob(over: Partial<JobSheetBody> = {}, warnings: string[] = [], sourceJobId: string | null = "LW-01") {
    return { body: body(over), sourceJobId, warnings };
  }

  it("a clean job (no warnings) is status ok", () => {
    const preview: ImportPreview = { layout: "five_tab", jobs: [importedJob()], refused: [] };
    const rows = previewRows(preview);
    expect(rows).toEqual([{ status: "ok", title: "Front wheel bearing service", sourceJobId: "LW-01", warnings: [] }]);
  });

  it("a job with warnings is status warning and carries every warning", () => {
    const preview: ImportPreview = {
      layout: "five_tab",
      jobs: [importedJob({}, ["Step # is missing — kept in file order", "This template can't be saved yet: title is required (title)"])],
      refused: [],
    };
    const rows = previewRows(preview);
    expect(rows[0]!.status).toBe("warning");
    expect(rows[0]!.status === "warning" && rows[0].warnings).toHaveLength(2);
  });

  it("an untitled job shows a placeholder title, not a blank string", () => {
    const preview: ImportPreview = { layout: "job_card", jobs: [importedJob({ title: "" })], refused: [] };
    const rows = previewRows(preview);
    expect(rows[0]!.title).toBe("(untitled)");
  });

  it("a refused row carries the refusal reason and the raw row text, with no warnings field", () => {
    const preview: ImportPreview = {
      layout: "five_tab",
      jobs: [],
      refused: [{ reason: "EXAMPLE row", row: "LW-EX\tEXAMPLE job\t..." }],
    };
    const rows = previewRows(preview);
    expect(rows).toEqual([{ status: "refused", title: "LW-EX\tEXAMPLE job\t...", reason: "EXAMPLE row" }]);
  });

  it("jobs are listed before refusals, each preserving its own parse order", () => {
    const preview: ImportPreview = {
      layout: "five_tab",
      jobs: [importedJob({ title: "Job A" }, [], "LW-01"), importedJob({ title: "Job B" }, [], "LW-02")],
      refused: [
        { reason: "EXAMPLE row", row: "row-1" },
        { reason: "bracket placeholder", row: "row-2" },
      ],
    };
    const rows = previewRows(preview);
    expect(rows.map((r) => r.title)).toEqual(["Job A", "Job B", "row-1", "row-2"]);
  });

  it("an empty preview (no jobs, no refusals) yields an empty row list", () => {
    expect(previewRows({ layout: "job_card", jobs: [], refused: [] })).toEqual([]);
  });
});
