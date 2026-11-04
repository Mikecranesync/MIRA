/**
 * Red-first tests for the job sheet template importer (TASK-S4). Fixtures
 * are pasted-spreadsheet TSV strings, written inline per the task's
 * instruction ("fixtures written as TSV strings in the test file"). All
 * equipment/part/torque values are fictional light-wheel (bicycle)
 * placeholders — no real torque specs presented as real data.
 */
import { describe, expect, it } from "vitest";
import { parseJobSheetText } from "../job-sheet-import";

function tsv(...rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

// ---------------------------------------------------------------------------
// Five-tab layout fixture
// ---------------------------------------------------------------------------

const JOBS_HEADER = [
  "Job ID",
  "Job title",
  "Machine / asset tag",
  "Component",
  "Type",
  "Est. time (h)",
  "Crew size",
  "Isolation / LOTO points",
  "Cautions / hazards",
  "Return-to-service checks",
  "Source",
  "Author",
  "Revision date",
  "Notes",
];
const JOBS_HELP = [
  "Unique, e.g. LW-01",
  "Title text",
  "Same as on Jobs tab",
  "Component text",
  "Pick from list",
  "Number only",
  "Number only",
  "Text",
  "Text",
  "Text",
  "Text",
  "Text",
  "Text",
  "Text",
];
const JOBS_ROW_LW01 = [
  "LW-01",
  "Front wheel bearing service",
  "Bike-Stand-7",
  "Front hub",
  "pm",
  "1.5",
  "1",
  "None — hand tools only",
  "Wheel may be hot after a ride",
  "Spin wheel; check for play; check brake clearance",
  "Shop manual p.12",
  "A. Tech",
  "2026-01-01",
  "Use the blue grease only",
];
const JOBS_ROW_EXAMPLE = [
  "EXAMPLE-LW-01",
  "Example job",
  "Demo bike",
  "Demo hub",
  "repair",
  "1",
  "1",
  "None",
  "None",
  "Check",
  "Manual",
  "Demo",
  "2026-01-01",
  "Demo",
];

const ITEMS_HEADER = ["Job ID", "Kind", "Item", "Size / spec / part no.", "Qty", "Source", "Notes"];
const ITEMS_HELP = ["Same as on Jobs tab", "Pick from list", "Text", "Text", "Number only", "Text", "Text"];
const ITEMS_ROW_TOOL = ["LW-01", "Tool", "5mm hex wrench", "5mm", "1", "Shop toolbox", ""];
const ITEMS_ROW_PART = ["LW-01", "part", "Ball bearing set", "608-size", "2", "Bike Shop Co", "Replace as a pair"];
const ITEMS_ROW_EXAMPLE_CHILD = ["EXAMPLE-LW-01", "tool", "Demo tool", "", "1", "", ""];

const TORQUE_HEADER = ["Job ID", "What", "Value", "Unit", "Pattern / sequence", "Thread-locker", "Tool", "Source"];
const TORQUE_HELP = ["Same as on Jobs tab", "Text", "Number only", "Text", "Text", "Pick from list", "Text", "Text"];
const TORQUE_ROW_SOURCED = ["LW-01", "Axle nut", "35", "Nm", "Criss-cross", "Loctite", "17mm wrench", "Shop manual p.12"];
const TORQUE_ROW_UNSOURCED = ["LW-01", "Spoke tension", "110", "kgf", "", "", "", ""];
const TORQUE_ROW_BRACKET = ["LW-01", "Hub cone preload", "[see manual]", "", "", "", "", ""];
const TORQUE_ROW_NONNUMERIC = ["LW-01", "Brake cable tension", "snug", "", "", "", "", ""];

const STEPS_HEADER = ["Job ID", "Step #", "Instruction", "Check-off needed", "Refers to", "Photo / drawing", "Source"];
const STEPS_HELP = ["Same as on Jobs tab", "Number only", "Text", "Pick from list", "Text", "Manual name + page", "Text"];
const STEPS_ROW_TORQUE = ["LW-01", "2", "Tighten axle nut to spec", "torque", "Axle nut", "(see fig 3)", "Shop manual p.12"];
const STEPS_ROW_FIRST = ["LW-01", "1", "Remove wheel from frame", "none", "", "", ""];
const STEPS_ROW_DUP = ["LW-01", "2", "Check brake clearance", "none", "", "", ""];
const STEPS_ROW_BLANK_NUM = ["LW-01", "", "Wipe down rim", "none", "", "", ""];

function buildFiveTabText(opts: { jobsRows?: string[][]; dropItemsExample?: boolean } = {}): string {
  const jobsRows = opts.jobsRows ?? [JOBS_HEADER, JOBS_HELP, JOBS_ROW_LW01, JOBS_ROW_EXAMPLE];
  const itemRows = opts.dropItemsExample
    ? [ITEMS_HEADER, ITEMS_HELP, ITEMS_ROW_TOOL, ITEMS_ROW_PART]
    : [ITEMS_HEADER, ITEMS_HELP, ITEMS_ROW_TOOL, ITEMS_ROW_PART, ITEMS_ROW_EXAMPLE_CHILD];
  return [
    "### Jobs",
    tsv(...jobsRows),
    "### Tools & parts",
    tsv(...itemRows),
    "### Torque & settings",
    tsv(TORQUE_HEADER, TORQUE_HELP, TORQUE_ROW_SOURCED, TORQUE_ROW_UNSOURCED, TORQUE_ROW_BRACKET, TORQUE_ROW_NONNUMERIC),
    "### Steps",
    tsv(STEPS_HEADER, STEPS_HELP, STEPS_ROW_TORQUE, STEPS_ROW_FIRST, STEPS_ROW_DUP, STEPS_ROW_BLANK_NUM),
  ].join("\n");
}

const FIVE_TAB_TEXT = buildFiveTabText();

// ---------------------------------------------------------------------------
// Job-card layout fixture
// ---------------------------------------------------------------------------

const JOB_CARD_TEXT = tsv(
  ["Job ID", "LW-02"],
  ["Job title", "Rear derailleur adjustment"],
  ["Machine / asset tag", "Bike-Stand-3"],
  ["Component", "Rear derailleur"],
  ["Type", "adjustment"],
  ["Est. hours", "0.5"],
  ["Crew size", "1"],
  ["Author", "B. Mechanic"],
  ["Revision date", "2026-02-02"],
  ["Isolation / LOTO points", "None — hand tools only"],
  ["Cautions / hazards", "Chain may pinch fingers"],
  ["⚠️ BRING TO THE JOB"],
  ["Kind", "Item", "Size / spec / part no.", "Qty", "Source", "Notes"],
  ["tool", "Phillips screwdriver", "#2", "1", "Shop toolbox", ""],
  ["part", "Derailleur hanger bolt", "M10", "1", "Bike Shop Co", "Only if bent"],
  ["Torque & settings"],
  ["What", "Value", "Unit", "Pattern / sequence", "Thread-locker", "Tool", "Source"],
  ["Hanger bolt", "8", "Nm", "", "", "4mm hex", "Shop manual p.5"],
  ["Limit screw", "[finger tight]", "", "", "", "", ""],
  ["Steps"],
  ["Step #", "Instruction", "Check-off", "Refers to torque row", "Photo / drawing", "Source"],
  ["2", "Test shift through all gears", "none", "", "", "Shop manual p.5"],
  ["1", "Set high/low limit screws", "none", "", "fig 2", "Shop manual p.5"],
  ["Return-to-service checks"],
  // Sheets paste of a single-column list arrives with trailing empty cells
  // (col A has the text, col B/C are "" not undefined) — exercises the
  // `??` vs empty-string bug directly.
  ["Shift through full range with no chain rub", "", ""],
  ["Confirm no chain drop on either end", "", ""],
  ["Notes"],
  ["Use light lube on pivot points only", ""],
);

const JOB_CARD_EXAMPLE_TEXT = tsv(
  ["Job ID", "EXAMPLE-LW-02"],
  ["Job title", "Example job"],
  ["Machine / asset tag", "Demo bike"],
  ["Component", "Demo"],
  ["Type", "repair"],
  ["Est. hours", "1"],
  ["Crew size", "1"],
  ["Author", "Demo"],
  ["Revision date", "2026-01-01"],
);

// ---------------------------------------------------------------------------
// five_tab layout
// ---------------------------------------------------------------------------

describe("parseJobSheetText — five_tab layout", () => {
  it("imports the one real job, refuses the EXAMPLE job and its child rows", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    expect(preview.layout).toBe("five_tab");
    expect(preview.jobs).toHaveLength(1);
    expect(preview.jobs[0]!.sourceJobId).toBe("LW-01");
    expect(preview.jobs[0]!.body.title).toBe("Front wheel bearing service");

    // Exactly one refusal row is reported (the Jobs-tab EXAMPLE row); its
    // child row in Tools & parts is dropped silently, not listed again.
    expect(preview.refused).toHaveLength(1);
    expect(preview.refused[0]!.reason).toBe("Example row — not imported");
    expect(preview.refused[0]!.row).toContain("EXAMPLE-LW-01");
  });

  it("skips the row-2 grey help line (it never becomes a job or a warning)", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    const job = preview.jobs[0]!;
    // The help row's Job-ID cell was "Unique, e.g. LW-01" — if it had been
    // treated as data it would have produced a second (bogus) job keyed on
    // that string, or at minimum extra warnings. Neither happens.
    expect(preview.jobs).toHaveLength(1);
    expect(job.warnings.some((w) => w.includes("Unique, e.g."))).toBe(false);
  });

  it("copies Isolation/LOTO text verbatim, never edited or summarized", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    expect(preview.jobs[0]!.body.isolationPoints).toBe("None — hand tools only");
  });

  it("maps a bracket placeholder torque value to null with a warning, never strips the brackets", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    const torque = preview.jobs[0]!.body.torques.find((t) => t.what === "Hub cone preload")!;
    expect(torque.value).toBeNull();
    expect(preview.jobs[0]!.warnings.some((w) => w.includes("placeholder"))).toBe(true);
  });

  it("treats a non-numeric torque value as null with a warning (not a value)", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    const torque = preview.jobs[0]!.body.torques.find((t) => t.what === "Brake cable tension")!;
    expect(torque.value).toBeNull();
    expect(preview.jobs[0]!.warnings.some((w) => w.includes('"snug" is not numeric'))).toBe(true);
  });

  it("imports a non-null torque value with no source, flagged unverified", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    const torque = preview.jobs[0]!.body.torques.find((t) => t.what === "Spoke tension")!;
    expect(torque.value).toBe(110);
    expect(torque.source).toBeNull();
    expect(preview.jobs[0]!.warnings.some((w) => w.includes("Spoke tension") && w.includes("unverified"))).toBe(true);
  });

  it("sorts steps by Step #, keeps file order on a duplicate, and warns", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    const steps = preview.jobs[0]!.body.steps;
    expect(steps.map((s) => s.text)).toEqual([
      "Remove wheel from frame", // 1
      "Tighten axle nut to spec", // 2, file-order-first among the duplicates
      "Check brake clearance", // 2, file-order-second
      "Wipe down rim", // blank Step # sorts last, not first
    ]);
    expect(preview.jobs[0]!.warnings.some((w) => w.includes("Duplicate step number"))).toBe(true);
  });

  it("does not treat a blank Step # as step 0 (regression: Number('') === 0)", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    const steps = preview.jobs[0]!.body.steps;
    // If the blank Step # were coerced to 0 it would sort FIRST, ahead of
    // step 1 ("Remove wheel from frame"). It must sort last instead.
    expect(steps[0]!.text).toBe("Remove wheel from frame");
    expect(steps[steps.length - 1]!.text).toBe("Wipe down rim");
  });

  it("imports tools and parts with their Kind normalized", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT, { layout: "five_tab" });
    const items = preview.jobs[0]!.body.items;
    expect(items.find((i) => i.item === "5mm hex wrench")!.kind).toBe("tool");
    expect(items.find((i) => i.item === "Ball bearing set")!.kind).toBe("part");
  });
});

// ---------------------------------------------------------------------------
// job_card layout
// ---------------------------------------------------------------------------

describe("parseJobSheetText — job_card layout", () => {
  it("parses header fields, tolerating the emoji/warning-sign section marker", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    expect(preview.layout).toBe("job_card");
    expect(preview.jobs).toHaveLength(1);
    const body = preview.jobs[0]!.body;
    expect(body.title).toBe("Rear derailleur adjustment");
    expect(body.machineLabel).toBe("Bike-Stand-3");
    expect(body.jobType).toBe("adjustment");
    expect(body.estHours).toBe(0.5);
    expect(body.crewSize).toBe(1);
    expect(body.author).toBe("B. Mechanic");
  });

  it("parses the BRING TO THE JOB table into items", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    const items = preview.jobs[0]!.body.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "tool", item: "Phillips screwdriver", spec: "#2", qty: 1 });
    expect(items[1]).toMatchObject({ kind: "part", item: "Derailleur hanger bolt", notes: "Only if bent" });
  });

  it("parses Torque & settings, bracket-placeholder value becomes null with a warning", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    const torques = preview.jobs[0]!.body.torques;
    const bolt = torques.find((t) => t.what === "Hanger bolt")!;
    expect(bolt.value).toBe(8);
    expect(bolt.source).toBe("Shop manual p.5");
    const limit = torques.find((t) => t.what === "Limit screw")!;
    expect(limit.value).toBeNull();
    expect(preview.jobs[0]!.warnings.some((w) => w.includes("placeholder"))).toBe(true);
  });

  it("sorts Steps by Step # even though the sheet lists them out of order", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    const steps = preview.jobs[0]!.body.steps;
    expect(steps.map((s) => s.text)).toEqual(["Set high/low limit screws", "Test shift through all gears"]);
  });

  it("folds the Photo/drawing cell into the step's source field", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    const step = preview.jobs[0]!.body.steps.find((s) => s.text === "Set high/low limit screws")!;
    expect(step.source).toContain("Shop manual p.5");
    expect(step.source).toContain("fig 2");
  });

  it("parses Return-to-service checks (one per row, text in column B) without losing a row to the ?? bug", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    expect(preview.jobs[0]!.body.returnToService).toEqual([
      "Shift through full range with no chain rub",
      "Confirm no chain drop on either end",
    ]);
  });

  it("parses the Notes section", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    expect(preview.jobs[0]!.body.notes).toContain("Use light lube on pivot points only");
  });

  it("a complete, well-formed job card produces no save-blocking warning (control case)", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    expect(preview.jobs[0]!.warnings.some((w) => w.includes("can't be saved yet"))).toBe(false);
  });

  it("refuses an EXAMPLE job card entirely", () => {
    const preview = parseJobSheetText(JOB_CARD_EXAMPLE_TEXT, { layout: "job_card" });
    expect(preview.jobs).toHaveLength(0);
    expect(preview.refused).toHaveLength(1);
    expect(preview.refused[0]!.reason).toBe("Example row — not imported");
  });
});

// ---------------------------------------------------------------------------
// F25 (egm-review/verdict.md) — quoted multiline cells
// ---------------------------------------------------------------------------

describe("parseJobSheetText — F25 quoted multiline cells", () => {
  // CSV per tab: a caution pasted from a cell with a soft-return inside it
  // arrives quoted, with a literal newline between the quotes. The old
  // `toRows` split the raw text at every newline BEFORE any quote was ever
  // seen, so the quoted cell was truncated at "fingers" and its
  // continuation ("wear gloves...") fell through as an unrecognized row —
  // silently dropped, never surfacing in `cautions` or anywhere else.
  const CSV_MULTILINE_CAUTION_TEXT = [
    "Job ID,LW-03",
    "Job title,Multiline caution test",
    "Machine / asset tag,Bike-Stand-4",
    "Component,Rear derailleur",
    "Type,adjustment",
    "Est. hours,0.5",
    "Crew size,1",
    "Author,B. Mechanic",
    "Revision date,2026-02-03",
    "Isolation / LOTO points,None - hand tools only",
    'Cautions / hazards,"Chain may pinch fingers\nwear gloves when adjusting"',
    "BRING TO THE JOB",
    "Kind,Item,Size / spec / part no.,Qty,Source,Notes",
    "tool,Phillips screwdriver,#2,1,Shop toolbox,",
  ].join("\n");

  it("a CSV quoted multiline caution stays ONE cell, newline intact", () => {
    const preview = parseJobSheetText(CSV_MULTILINE_CAUTION_TEXT, { layout: "job_card" });
    expect(preview.jobs).toHaveLength(1);
    const job = preview.jobs[0]!;
    expect(job.body.cautions).toBe("Chain may pinch fingers\nwear gloves when adjusting");
  });

  // Control, not a red test for F25: against the pre-fix code this already
  // passed (the stray continuation row happened to get silently dropped as
  // unrecognized without disturbing the items section that follows). Kept
  // to pin that the fix doesn't regress item parsing after a multiline cell.
  it("control: the next section still parses after a multiline caution (not RED-discriminating — passed pre-fix too)", () => {
    const preview = parseJobSheetText(CSV_MULTILINE_CAUTION_TEXT, { layout: "job_card" });
    const job = preview.jobs[0]!;
    expect(job.body.items).toHaveLength(1);
    expect(job.body.items[0]!.item).toBe("Phillips screwdriver");
  });

  // Same shape, tab-delimited: `splitRow`'s TSV branch previously had NO
  // quote handling at all (only the comma branch did), so a TSV paste got
  // the newline-truncation bug AND no quote-escape support.
  const TSV_MULTILINE_CAUTION_TEXT = tsv(
    ["Job ID", "LW-04"],
    ["Job title", "Multiline caution TSV test"],
    ["Machine / asset tag", "Bike-Stand-5"],
    ["Component", "Rear derailleur"],
    ["Type", "adjustment"],
    ["Est. hours", "0.5"],
    ["Crew size", "1"],
    ["Author", "B. Mechanic"],
    ["Revision date", "2026-02-04"],
    ["Isolation / LOTO points", "None - hand tools only"],
    ["Cautions / hazards", '"Chain may pinch fingers\nwear gloves when adjusting"'],
    ["BRING TO THE JOB"],
    ["Kind", "Item", "Size / spec / part no.", "Qty", "Source", "Notes"],
    ["tool", "Phillips screwdriver", "#2", "1", "Shop toolbox", ""],
  );

  it("a TSV quoted multiline caution ALSO stays one cell (TSV previously had no quote parsing at all)", () => {
    const preview = parseJobSheetText(TSV_MULTILINE_CAUTION_TEXT, { layout: "job_card" });
    expect(preview.jobs).toHaveLength(1);
    const job = preview.jobs[0]!;
    expect(job.body.cautions).toBe("Chain may pinch fingers\nwear gloves when adjusting");
    expect(job.body.items).toHaveLength(1);
  });

  it("control: an UNQUOTED cell containing a literal comma-like dash is unaffected (unquoted behavior unchanged)", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT, { layout: "job_card" });
    expect(preview.jobs[0]!.body.cautions).toBe("Chain may pinch fingers");
  });
});

// ---------------------------------------------------------------------------
// Validator reuse (TASK-S4 §Files: "reuse JobSheetBody and its validator")
// ---------------------------------------------------------------------------

describe("parseJobSheetText — reuses the write-path validator", () => {
  it("warns when the sheet left the Job title blank (would fail validateJobSheetBody on save)", () => {
    const blankTitleRow = [...JOBS_ROW_LW01];
    blankTitleRow[1] = ""; // Job title
    const text = buildFiveTabText({ jobsRows: [JOBS_HEADER, JOBS_HELP, blankTitleRow] });
    const preview = parseJobSheetText(text, { layout: "five_tab" });
    expect(preview.jobs).toHaveLength(1);
    expect(preview.jobs[0]!.body.title).toBe("");
    expect(preview.jobs[0]!.warnings.some((w) => w.includes("can't be saved yet"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layout auto-detection
// ---------------------------------------------------------------------------

describe("parseJobSheetText — layout auto-detection", () => {
  it("detects five_tab from the '### <Tab name>' markers", () => {
    const preview = parseJobSheetText(FIVE_TAB_TEXT);
    expect(preview.layout).toBe("five_tab");
  });

  it("detects job_card when there are no '### ' markers", () => {
    const preview = parseJobSheetText(JOB_CARD_TEXT);
    expect(preview.layout).toBe("job_card");
  });
});
