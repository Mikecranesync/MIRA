/**
 * Job sheet template importer — turns pasted spreadsheet text into an
 * `ImportPreview` the UI shows before anything is saved. Pure, no I/O: the
 * route (`job-sheets/import/preview/route.ts`) calls this and returns the
 * result directly; nothing here touches the database.
 *
 * Two source layouts (TASK-S4 §SSoT):
 *   - "five_tab": Mike's original 4-tab spreadsheet (Jobs / Tools & parts /
 *     Torque & settings / Steps), pasted as the four tabs concatenated, each
 *     preceded by a line `### <Tab name>`. Row 1 is headers (skipped), row 2
 *     is grey help text (skipped by phrase match), yellow EXAMPLE rows
 *     (Job ID `EXAMPLE-LW-01`) are refused.
 *   - "job_card": the Gemini one-job-per-tab layout, label in column A,
 *     value in column B, with ALL CAPS / ⚠️-prefixed section headers for the
 *     parts/torque/steps tables and the return-to-service list.
 *
 * Input is tab-separated (pasted from Sheets/Excel) or comma-separated
 * ("CSV per tab") — `splitRow` picks whichever a line actually uses.
 *
 * The importer never invents values (TASK-S4 §Import rules, rule 8): every
 * output field traces to a cell, or is null with a warning explaining why.
 *
 * Two deliberate departures from the literal rule text, forced by the S1
 * `JobSheetBody`/`JobSheetItem`/`JobSheetStep` shapes this module reuses
 * as-is (never redefines):
 *   - Rule 5 says unknown Kind/Type/Check-off text maps to "the closest enum
 *     or null". `jobType` IS nullable (`JobType | null`) so it does exactly
 *     that. `JobSheetItem.kind` and `JobSheetStep.checkoff` are NOT nullable
 *     in types.ts — there is no null to fall back to — so those two default
 *     to "part" / "none" (the most conservative member of each enum) with a
 *     warning instead of a null.
 *   - Neither layout's "Source" / "Revision date" (Jobs tab) nor "Photo /
 *     drawing" (Steps) have a dedicated field on `JobSheetBody`/
 *     `JobSheetStep`. Rather than drop the cell, its content is folded into
 *     the nearest free-text field (`notes`, or `source` on the step) with an
 *     explicit label, so nothing the sheet said is lost.
 */
import {
  JOB_ITEM_KINDS,
  JOB_STEP_CHECKOFFS,
  JOB_TYPES,
  type JobItemKind,
  type JobSheetBody,
  type JobSheetItem,
  type JobSheetStep,
  type JobSheetTorque,
  type JobStepCheckoff,
  type JobType,
} from "./types";
import { validateJobSheetBody } from "./validate";

export type ImportLayout = "five_tab" | "job_card";

export type ImportJobResult = {
  body: JobSheetBody;
  sourceJobId: string | null;
  warnings: string[];
};

export type ImportRefusal = { reason: string; row: string };

export type ImportPreview = {
  jobs: ImportJobResult[];
  refused: ImportRefusal[];
  layout: ImportLayout;
};

// ---------------------------------------------------------------------------
// Low-level cell helpers
// ---------------------------------------------------------------------------

function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());
  // Simple CSV split with basic double-quote support — fixtures are our own
  // ASCII text, not a full RFC 4180 parser.
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function toRows(text: string): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .map(splitRow)
    .filter((cells) => cells.some((c) => c !== ""));
}

/** A cell that is ENTIRELY a bracket hint, e.g. "(manual + page)" or
 *  "[3.5 hrs]". A cell that merely contains a bracket ("breaker [B12]") is
 *  real content and must never be touched — rule 7 (verbatim). */
function isBracketPlaceholder(v: string): boolean {
  const t = v.trim();
  if (t.length < 2) return false;
  return (t.startsWith("[") && t.endsWith("]")) || (t.startsWith("(") && t.endsWith(")"));
}

/** Non-empty text, bracket-placeholder-aware. Never reformats real content —
 *  this is the one function every verbatim text field goes through. */
function cellText(raw: string | undefined, field: string, warnings: string[]): string | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  if (isBracketPlaceholder(v)) {
    warnings.push(`${field} looks like a placeholder — left blank`);
    return null;
  }
  return v;
}

function cellNumber(raw: string | undefined, field: string, warnings: string[]): number | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  if (isBracketPlaceholder(v)) {
    warnings.push(`${field} looks like a placeholder — left blank`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) {
    warnings.push(`${field} "${v}" is not numeric — left blank`);
    return null;
  }
  return n;
}

function normalizeEnumToken(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** For the one field that IS nullable in types.ts (`JobSheetBody.jobType`). */
function mapEnumNullable<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  field: string,
  warnings: string[],
): T | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  if (isBracketPlaceholder(v)) {
    warnings.push(`${field} looks like a placeholder — left blank`);
    return null;
  }
  const norm = normalizeEnumToken(v);
  if ((allowed as readonly string[]).includes(norm)) return norm as T;
  warnings.push(`Unrecognized ${field} "${v}" — left blank`);
  return null;
}

/** For `JobSheetItem.kind` / `JobSheetStep.checkoff` — NOT nullable in
 *  types.ts, so an unmapped value defaults to the given fallback instead. */
function mapEnumWithDefault<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string,
  warnings: string[],
): T {
  const v = (raw ?? "").trim();
  if (v === "") return fallback;
  if (isBracketPlaceholder(v)) {
    warnings.push(`${field} looks like a placeholder — defaulted to ${fallback}`);
    return fallback;
  }
  const norm = normalizeEnumToken(v);
  if ((allowed as readonly string[]).includes(norm)) return norm as T;
  warnings.push(`Unrecognized ${field} "${v}" — defaulted to ${fallback}`);
  return fallback;
}

function buildNotes(base: string | null, extras: { label: string; value: string | null }[]): string | null {
  const parts: string[] = [];
  if (base) parts.push(base);
  for (const { label, value } of extras) {
    if (value) parts.push(`${label}: ${value}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function combineSourceAndPhoto(source: string | null, photo: string | null): string | null {
  if (source && photo) return `${source} (photo/drawing: ${photo})`;
  return source ?? photo;
}

/** Reuses the S1 write-path validator (TASK-S4 §Files: "reuse JobSheetBody
 *  and its validator") so the preview can warn about anything that would be
 *  rejected on save — a missing title/item-name/step-text/torque-what (the
 *  validator requires non-empty text; the importer defaults those to "" when
 *  the sheet left the cell blank), an out-of-range number, or a torque value
 *  with no source. The importer never *fixes* these — it only reuses the
 *  same check so the technician sees the problem before trying to save. */
function warnIfNotSaveable(body: JobSheetBody, warnings: string[]): void {
  const result = validateJobSheetBody(body);
  if (!result.ok) {
    const field = result.field ? ` (${result.field})` : "";
    warnings.push(`This template can't be saved yet: ${result.error}${field} — fix the sheet and re-import`);
  }
}

// ---------------------------------------------------------------------------
// Step ordering (rule 6: sort by Step #, duplicates warn + keep file order)
// ---------------------------------------------------------------------------

type StepBucketEntry = { num: number; step: JobSheetStep };

function finalizeSteps(entries: StepBucketEntry[], warnings: string[]): JobSheetStep[] {
  const withIndex = entries.map((e, i) => ({ ...e, i }));
  withIndex.sort((a, b) => {
    const an = Number.isFinite(a.num) ? a.num : Number.POSITIVE_INFINITY;
    const bn = Number.isFinite(b.num) ? b.num : Number.POSITIVE_INFINITY;
    if (an !== bn) return an - bn;
    return a.i - b.i; // stable: keep file order for ties
  });
  const counts = new Map<number, number>();
  for (const e of entries) {
    if (!Number.isFinite(e.num)) continue;
    counts.set(e.num, (counts.get(e.num) ?? 0) + 1);
  }
  for (const [num, count] of counts) {
    if (count > 1) warnings.push(`Duplicate step number ${num} — keeping file order`);
  }
  return withIndex.map((e) => e.step);
}

// ---------------------------------------------------------------------------
// EXAMPLE refusal (rule 1)
// ---------------------------------------------------------------------------

/** Per TASK-S4 Import rules bullet 1, verbatim: "A Job ID, title or any cell
 *  containing EXAMPLE (case-insensitive) refuses that job" — deliberately
 *  broad (every cell, not just the Job ID column). This can over-refuse a
 *  row whose free text happens to mention the word "example" (e.g. "see
 *  example in manual p.12"); kept broad because the spec text says "any
 *  cell", not "the Job ID cell". Flagged as a known tradeoff, not a bug. */
function containsExample(cells: string[]): boolean {
  return cells.some((c) => c.toUpperCase().includes("EXAMPLE"));
}

// ---------------------------------------------------------------------------
// Five-tab layout
// ---------------------------------------------------------------------------

const HELP_PHRASES = ["Unique, e.g.", "Same as on Jobs", "Pick from list", "Number only", "Manual name + page"];

function isHelpRow(cells: string[]): boolean {
  return cells.some((c) => HELP_PHRASES.some((p) => c.includes(p)));
}

function splitIntoTabs(text: string): { name: string; lines: string[] }[] {
  const lines = text.split(/\r\n|\r|\n/);
  const tabs: { name: string; lines: string[] }[] = [];
  let current: { name: string; lines: string[] } | null = null;
  for (const line of lines) {
    const m = /^###\s*(.+)$/.exec(line.trim());
    if (m) {
      current = { name: m[1]!.trim(), lines: [] };
      tabs.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return tabs;
}

function tabKindOf(name: string): "jobs" | "items" | "torques" | "steps" | null {
  const n = name.toLowerCase();
  if (n.includes("job")) return "jobs";
  if (n.includes("tool") || n.includes("part")) return "items";
  if (n.includes("torque")) return "torques";
  if (n.includes("step")) return "steps";
  return null;
}

/** Header row (row 1) always dropped; the grey help row (row 2, detected by
 *  phrase) dropped wherever it appears; blank lines already filtered. */
function dataRowsOf(lines: string[]): string[][] {
  const rows = toRows(lines.join("\n"));
  if (rows.length === 0) return [];
  const [, ...rest] = rows;
  return rest.filter((r) => !isHelpRow(r));
}

function parseFiveTab(text: string): ImportPreview {
  const tabs = splitIntoTabs(text);
  const jobsTab = tabs.find((t) => tabKindOf(t.name) === "jobs");
  const itemsTab = tabs.find((t) => tabKindOf(t.name) === "items");
  const torquesTab = tabs.find((t) => tabKindOf(t.name) === "torques");
  const stepsTab = tabs.find((t) => tabKindOf(t.name) === "steps");

  const jobRows = jobsTab ? dataRowsOf(jobsTab.lines) : [];
  const itemRows = itemsTab ? dataRowsOf(itemsTab.lines) : [];
  const torqueRows = torquesTab ? dataRowsOf(torquesTab.lines) : [];
  const stepRows = stepsTab ? dataRowsOf(stepsTab.lines) : [];

  // Pass 1: every row in every tab that contains "EXAMPLE" refuses its Job ID
  // — and every other row (any tab) sharing that Job ID goes with it.
  const refusedIds = new Map<string, string>(); // jobId (upper) -> representative raw row
  for (const r of [...jobRows, ...itemRows, ...torqueRows, ...stepRows]) {
    if (!containsExample(r)) continue;
    const jobId = (r[0] ?? "").trim();
    if (jobId === "") continue;
    const key = jobId.toUpperCase();
    if (!refusedIds.has(key)) refusedIds.set(key, r.join("\t"));
  }
  const refused: ImportRefusal[] = [...refusedIds.values()].map((row) => ({
    reason: "Example row — not imported",
    row,
  }));

  const jobsByKey = new Map<string, ImportJobResult>();
  const stepBucketByKey = new Map<string, StepBucketEntry[]>();

  for (const row of jobRows) {
    const jobIdRaw = (row[0] ?? "").trim();
    if (jobIdRaw === "") continue;
    const key = jobIdRaw.toUpperCase();
    if (refusedIds.has(key)) continue;

    const warnings: string[] = [];
    const [, jobTitleC, machineC, componentC, typeC, estHoursC, crewSizeC, isolationC, cautionsC, rtsC, sourceC, authorC, revDateC, notesC] =
      row;

    const title = cellText(jobTitleC, "Job title", warnings) ?? "";
    const machineLabel = cellText(machineC, "Machine / asset tag", warnings);
    const component = cellText(componentC, "Component", warnings);
    const jobType = mapEnumNullable(typeC, JOB_TYPES, "Type", warnings);
    const estHours = cellNumber(estHoursC, "Est. time (h)", warnings);
    const crewSize = cellNumber(crewSizeC, "Crew size", warnings);
    const isolationPoints = cellText(isolationC, "Isolation / LOTO points", warnings);
    const cautions = cellText(cautionsC, "Cautions / hazards", warnings);
    const rts = cellText(rtsC, "Return-to-service checks", warnings);
    const returnToService = rts
      ? rts
          .split(/\s*;\s*|\n/)
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : [];
    const author = cellText(authorC, "Author", warnings);
    const baseNotes = cellText(notesC, "Notes", warnings);
    const notes = buildNotes(baseNotes, [
      { label: "Source", value: cellText(sourceC, "Source", warnings) },
      { label: "Revision date", value: cellText(revDateC, "Revision date", warnings) },
    ]);

    const body: JobSheetBody = {
      title,
      machineLabel,
      component,
      jobType,
      estHours,
      crewSize,
      isolationPoints,
      cautions,
      returnToService,
      items: [],
      torques: [],
      steps: [],
      author,
      notes,
    };
    jobsByKey.set(key, { body, sourceJobId: jobIdRaw, warnings });
    stepBucketByKey.set(key, []);
  }

  let itemCounter = 0;
  for (const row of itemRows) {
    const jobIdRaw = (row[0] ?? "").trim();
    if (jobIdRaw === "") continue;
    const key = jobIdRaw.toUpperCase();
    if (refusedIds.has(key)) continue;
    const job = jobsByKey.get(key);
    if (!job) {
      refused.push({ reason: "Unknown Job ID — not imported", row: row.join("\t") });
      continue;
    }
    itemCounter++;
    const kind = mapEnumWithDefault(row[1], JOB_ITEM_KINDS, "part", "Kind", job.warnings);
    const itemName = cellText(row[2], "Item", job.warnings) ?? "";
    const spec = cellText(row[3], "Size / spec / part no.", job.warnings);
    const qty = cellNumber(row[4], "Qty", job.warnings);
    const source = cellText(row[5], "Source", job.warnings);
    const notes = cellText(row[6], "Notes", job.warnings);
    job.body.items.push({ id: `item-${itemCounter}`, kind, item: itemName, spec, qty, source, notes });
  }

  let torqueCounter = 0;
  for (const row of torqueRows) {
    const jobIdRaw = (row[0] ?? "").trim();
    if (jobIdRaw === "") continue;
    const key = jobIdRaw.toUpperCase();
    if (refusedIds.has(key)) continue;
    const job = jobsByKey.get(key);
    if (!job) {
      refused.push({ reason: "Unknown Job ID — not imported", row: row.join("\t") });
      continue;
    }
    torqueCounter++;
    const what = cellText(row[1], "What", job.warnings) ?? "";
    const unit = cellText(row[3], "Unit", job.warnings);
    const pattern = cellText(row[4], "Pattern / sequence", job.warnings);
    const threadLocker = cellText(row[5], "Thread-locker", job.warnings);
    const tool = cellText(row[6], "Tool", job.warnings);
    const source = cellText(row[7], "Source", job.warnings);
    const valueRaw = (row[2] ?? "").trim();
    let value: number | null = null;
    if (valueRaw !== "") {
      if (isBracketPlaceholder(valueRaw)) {
        job.warnings.push("Value looks like a placeholder — left blank");
      } else {
        const n = Number(valueRaw);
        if (Number.isFinite(n)) value = n;
        else job.warnings.push(`Value "${valueRaw}" is not numeric — left blank`);
      }
    }
    if (value !== null && source === null) {
      job.warnings.push(`Torque for ${what || "(unnamed)"} has no source — it will show as unverified`);
    }
    job.body.torques.push({ id: `torque-${torqueCounter}`, what, value, unit, pattern, threadLocker, tool, source });
  }

  let stepCounter = 0;
  for (const row of stepRows) {
    const jobIdRaw = (row[0] ?? "").trim();
    if (jobIdRaw === "") continue;
    const key = jobIdRaw.toUpperCase();
    if (refusedIds.has(key)) continue;
    const job = jobsByKey.get(key);
    if (!job) {
      refused.push({ reason: "Unknown Job ID — not imported", row: row.join("\t") });
      continue;
    }
    stepCounter++;
    const numRaw = (row[1] ?? "").trim();
    const instruction = cellText(row[2], "Instruction", job.warnings) ?? "";
    const checkoff = mapEnumWithDefault(row[3], JOB_STEP_CHECKOFFS, "none", "Check-off needed", job.warnings);
    const refersTo = cellText(row[4], "Refers to", job.warnings);
    const photo = cellText(row[5], "Photo / drawing", job.warnings);
    const source = combineSourceAndPhoto(cellText(row[6], "Source", job.warnings), photo);
    if (numRaw === "") job.warnings.push("Step # is missing — kept in file order");
    stepBucketByKey.get(key)!.push({
      num: numRaw === "" ? Number.POSITIVE_INFINITY : Number(numRaw),
      step: { id: `step-${stepCounter}`, text: instruction, checkoff, torqueRef: refersTo, source },
    });
  }

  for (const [key, job] of jobsByKey) {
    job.body.steps = finalizeSteps(stepBucketByKey.get(key) ?? [], job.warnings);
    warnIfNotSaveable(job.body, job.warnings);
  }

  return { jobs: [...jobsByKey.values()], refused, layout: "five_tab" };
}

// ---------------------------------------------------------------------------
// Job-card layout (one job per call)
// ---------------------------------------------------------------------------

function normalizeLabel(s: string): string {
  return s
    .replace(/^[^\p{L}\p{N}]+/u, "") // strip leading emoji / "⚠️" / punctuation
    .trim()
    .toLowerCase();
}

function isSectionMarker(cell: string): boolean {
  const n = normalizeLabel(cell);
  return (
    n.includes("bring to the job") ||
    n.includes("torque") ||
    n === "steps" ||
    n.includes("return-to-service") ||
    n.includes("return to service") ||
    n === "notes"
  );
}

function parseJobCard(text: string): ImportPreview {
  const rows = toRows(text);

  const anyExample = rows.some((r) => r.some((c) => c.toUpperCase().includes("EXAMPLE")));
  if (anyExample) {
    const jobIdRow = rows.find((r) => normalizeLabel(r[0] ?? "") === "job id");
    const row = (jobIdRow ?? rows[0] ?? []).join("\t");
    return { jobs: [], refused: [{ reason: "Example row — not imported", row }], layout: "job_card" };
  }

  const warnings: string[] = [];
  let jobIdRaw: string | null = null;
  let title = "";
  let machineLabel: string | null = null;
  let component: string | null = null;
  let jobType: JobType | null = null;
  let estHours: number | null = null;
  let crewSize: number | null = null;
  let author: string | null = null;
  let revisionDate: string | null = null;
  let isolationPoints: string | null = null;
  let cautions: string | null = null;

  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    const label = normalizeLabel(row[0] ?? "");
    const raw = row[1];
    if (label === "job id") {
      jobIdRaw = (raw ?? "").trim() || null;
    } else if (label === "job title") {
      title = cellText(raw, "Job title", warnings) ?? "";
    } else if (label === "machine / asset tag") {
      machineLabel = cellText(raw, "Machine / asset tag", warnings);
    } else if (label === "component") {
      component = cellText(raw, "Component", warnings);
    } else if (label === "type") {
      jobType = mapEnumNullable(raw, JOB_TYPES, "Type", warnings);
    } else if (label === "est. hours") {
      estHours = cellNumber(raw, "Est. hours", warnings);
    } else if (label === "crew size") {
      crewSize = cellNumber(raw, "Crew size", warnings);
    } else if (label === "author") {
      author = cellText(raw, "Author", warnings);
    } else if (label === "revision date") {
      revisionDate = cellText(raw, "Revision date", warnings);
    } else if (label === "isolation / loto points") {
      isolationPoints = cellText(raw, "Isolation / LOTO points", warnings);
    } else if (label === "cautions / hazards") {
      cautions = cellText(raw, "Cautions / hazards", warnings);
    } else {
      break; // first unrecognized label is a section marker — stop phase 1.
    }
    i++;
  }

  const items: JobSheetItem[] = [];
  const torques: JobSheetTorque[] = [];
  const stepBucket: StepBucketEntry[] = [];
  const returnToService: string[] = [];
  let notesExtra: string | null = null;
  let itemCounter = 0;
  let torqueCounter = 0;
  let stepCounter = 0;

  while (i < rows.length) {
    const row = rows[i]!;
    const label = normalizeLabel(row[0] ?? "");

    if (label.includes("bring to the job")) {
      i += 2; // marker row + header row
      while (i < rows.length && !isSectionMarker(rows[i]![0] ?? "")) {
        const r = rows[i]!;
        itemCounter++;
        const kind = mapEnumWithDefault(r[0], JOB_ITEM_KINDS, "part", "Kind", warnings);
        const itemName = cellText(r[1], "Item", warnings) ?? "";
        const spec = cellText(r[2], "Size / spec / part no.", warnings);
        const qty = cellNumber(r[3], "Qty", warnings);
        const source = cellText(r[4], "Source", warnings);
        const notes = cellText(r[5], "Notes", warnings);
        items.push({ id: `item-${itemCounter}`, kind, item: itemName, spec, qty, source, notes });
        i++;
      }
      continue;
    }

    if (label.includes("torque")) {
      i += 2;
      while (i < rows.length && !isSectionMarker(rows[i]![0] ?? "")) {
        const r = rows[i]!;
        torqueCounter++;
        const what = cellText(r[0], "What", warnings) ?? "";
        const unit = cellText(r[2], "Unit", warnings);
        const pattern = cellText(r[3], "Pattern / sequence", warnings);
        const threadLocker = cellText(r[4], "Thread-locker", warnings);
        const tool = cellText(r[5], "Tool", warnings);
        const source = cellText(r[6], "Source", warnings);
        const valueRaw = (r[1] ?? "").trim();
        let value: number | null = null;
        if (valueRaw !== "") {
          if (isBracketPlaceholder(valueRaw)) {
            warnings.push("Value looks like a placeholder — left blank");
          } else {
            const n = Number(valueRaw);
            if (Number.isFinite(n)) value = n;
            else warnings.push(`Value "${valueRaw}" is not numeric — left blank`);
          }
        }
        if (value !== null && source === null) {
          warnings.push(`Torque for ${what || "(unnamed)"} has no source — it will show as unverified`);
        }
        torques.push({ id: `torque-${torqueCounter}`, what, value, unit, pattern, threadLocker, tool, source });
        i++;
      }
      continue;
    }

    if (label === "steps") {
      i += 2;
      while (i < rows.length && !isSectionMarker(rows[i]![0] ?? "")) {
        const r = rows[i]!;
        stepCounter++;
        const numRaw = (r[0] ?? "").trim();
        const instruction = cellText(r[1], "Instruction", warnings) ?? "";
        const checkoff = mapEnumWithDefault(r[2], JOB_STEP_CHECKOFFS, "none", "Check-off needed", warnings);
        const refersTo = cellText(r[3], "Refers to torque row", warnings);
        const photo = cellText(r[4], "Photo / drawing", warnings);
        const source = combineSourceAndPhoto(cellText(r[5], "Source", warnings), photo);
        if (numRaw === "") warnings.push("Step # is missing — kept in file order");
        stepBucket.push({
          num: numRaw === "" ? Number.POSITIVE_INFINITY : Number(numRaw),
          step: { id: `step-${stepCounter}`, text: instruction, checkoff, torqueRef: refersTo, source },
        });
        i++;
      }
      continue;
    }

    if (label.includes("return-to-service") || label.includes("return to service")) {
      i++; // marker row
      while (i < rows.length && !isSectionMarker(rows[i]![0] ?? "")) {
        const r = rows[i]!;
        const cell = (r[1] ?? "").trim() !== "" ? r[1] : r[0];
        const v = cellText(cell, "Return-to-service checks", warnings);
        if (v) returnToService.push(v);
        i++;
      }
      continue;
    }

    if (label === "notes") {
      i++; // marker row
      const parts: string[] = [];
      while (i < rows.length) {
        const r = rows[i]!;
        const cell = (r[1] ?? "").trim() !== "" ? r[1] : r[0];
        const v = cellText(cell, "Notes", warnings);
        if (v) parts.push(v);
        i++;
      }
      notesExtra = parts.length > 0 ? parts.join("\n") : null;
      continue;
    }

    // An unrecognized row never throws — it's just skipped.
    i++;
  }

  const steps = finalizeSteps(stepBucket, warnings);
  const notes = buildNotes(notesExtra, [{ label: "Revision date", value: revisionDate }]);

  const body: JobSheetBody = {
    title,
    machineLabel,
    component,
    jobType,
    estHours,
    crewSize,
    isolationPoints,
    cautions,
    returnToService,
    items,
    torques,
    steps,
    author,
    notes,
  };

  warnIfNotSaveable(body, warnings);

  return { jobs: [{ body, sourceJobId: jobIdRaw, warnings }], refused: [], layout: "job_card" };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseJobSheetText(text: string, opts: { layout?: "auto" | ImportLayout } = {}): ImportPreview {
  const requested = opts.layout ?? "auto";
  const layout: ImportLayout = requested === "auto" ? (/^\s*###\s*/m.test(text) ? "five_tab" : "job_card") : requested;
  return layout === "five_tab" ? parseFiveTab(text) : parseJobCard(text);
}
