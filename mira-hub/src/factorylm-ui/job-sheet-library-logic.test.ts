import { describe, expect, it } from "vitest";
import {
  searchJobSheets,
  draftBadge,
  previewRows,
  torqueDisplayRows,
  shouldReuseSaveIds,
  indicesToRetry,
  allRowsSaved,
} from "./job-sheet-library-logic";
import type { JobSheetSummary } from "@/capabilities/living-sheet/job-sheet-store";
import type { ImportPreview } from "@/capabilities/living-sheet/job-sheet-import";
import type { JobSheetBody, JobSheetTorque } from "@/capabilities/living-sheet/types";

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

describe("torqueDisplayRows — F12: the reviewer must see value + source, never invented", () => {
  function torque(over: Partial<JobSheetTorque> = {}): JobSheetTorque {
    return { id: "t1", what: "Bearing cap bolts", value: 85, unit: "ft-lb", pattern: "star pattern", threadLocker: null, tool: "Torque wrench", source: "Shop sheet C3-LW", ...over };
  }

  it("shows the value with its unit and the recorded source", () => {
    expect(torqueDisplayRows([torque()])).toEqual([
      { what: "Bearing cap bolts", value: "85 ft-lb", pattern: "star pattern", threadLocker: null, source: "Shop sheet C3-LW" },
    ]);
  });

  it("a null value says so plainly instead of being blank", () => {
    expect(torqueDisplayRows([torque({ value: null, unit: null, source: null })])[0]).toMatchObject({
      value: "not written on the job sheet",
      source: "no source — unverified",
    });
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

/**
 * R2-21 — property: a failed import-save row must be retryable with the
 * SAME request id, only successful rows become permanently disabled, and
 * re-previewing the SAME pasted text must never mint fresh ids for rows
 * whose save may already have succeeded server-side. The reviewer's own
 * counterexample (disables after ANY result, including failure) is covered
 * by the `allRowsSaved`/`indicesToRetry` cases below; the `shouldReuseSaveIds`
 * cases cover the re-preview half of the finding.
 */
describe("shouldReuseSaveIds — R2-21: a recovery re-preview must not mint fresh ids", () => {
  it.each([
    { label: "first preview ever (no prior text)", last: null, next: "a\tb", existing: 0, jobs: 2, expected: false },
    { label: "same text, same job count ⇒ reuse", last: "a\tb", next: "a\tb", existing: 2, jobs: 2, expected: true },
    { label: "same text, but id count no longer matches the new job count ⇒ fresh", last: "a\tb", next: "a\tb", existing: 2, jobs: 3, expected: false },
    { label: "a genuinely different paste ⇒ fresh, even with the same job count", last: "a\tb", next: "c\td", existing: 2, jobs: 2, expected: false },
    { label: "whitespace-only difference IS a different string (caller trims before calling) ⇒ fresh", last: "a\tb", next: "a\tb ", existing: 2, jobs: 2, expected: false },
    { label: "same text but the new preview parsed to zero jobs ⇒ never reuse an empty set", last: "a\tb", next: "a\tb", existing: 0, jobs: 0, expected: false },
  ])("$label", ({ last, next, existing, jobs, expected }) => {
    expect(shouldReuseSaveIds(last, next, existing, jobs)).toBe(expected);
  });
});

describe("indicesToRetry — R2-21: only non-succeeded rows are retried", () => {
  const CASES: { label: string; jobCount: number; success: Record<number, boolean>; expected: number[] }[] = [
    { label: "no attempts yet: every row is retryable", jobCount: 3, success: {}, expected: [0, 1, 2] },
    { label: "all succeeded: nothing left to retry", jobCount: 3, success: { 0: true, 1: true, 2: true }, expected: [] },
    { label: "a mix: only the failed/untried rows retry", jobCount: 3, success: { 0: true, 1: false }, expected: [1, 2] },
    { label: "a single job, failed", jobCount: 1, success: { 0: false }, expected: [0] },
    { label: "zero jobs: nothing to retry", jobCount: 0, success: {}, expected: [] },
  ];
  it.each(CASES)("$label", ({ jobCount, success, expected }) => {
    expect(indicesToRetry(jobCount, success)).toEqual(expected);
  });
});

describe("allRowsSaved — R2-21: disable only once EVERY row has succeeded", () => {
  const CASES: { label: string; jobCount: number; success: Record<number, boolean>; expected: boolean }[] = [
    { label: "no attempts yet ⇒ not done (stays actionable, not the bug's 'disable on any result')", jobCount: 2, success: {}, expected: false },
    { label: "one succeeded, one failed ⇒ not done (the exact reviewer counterexample)", jobCount: 2, success: { 0: true, 1: false }, expected: false },
    { label: "one succeeded, one never attempted ⇒ not done", jobCount: 2, success: { 0: true }, expected: false },
    { label: "every row succeeded ⇒ done", jobCount: 2, success: { 0: true, 1: true }, expected: true },
    { label: "zero jobs ⇒ never 'done' (nothing was ever saved)", jobCount: 0, success: {}, expected: false },
  ];
  it.each(CASES)("$label", ({ jobCount, success, expected }) => {
    expect(allRowsSaved(jobCount, success)).toBe(expected);
  });
});
