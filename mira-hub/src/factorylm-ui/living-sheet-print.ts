/**
 * Living Work Sheet — pure print model (S5).
 *
 * `printModel(view, opts)` turns a reduced `SheetView` snapshot into a plain,
 * typed structure a print-only renderer (LivingSheetPrint.tsx, owned by
 * another session — not touched here) can map over without re-deriving any
 * of this. No DOM, no React, no I/O — same discipline as reduce.ts.
 *
 * Content follows TASK-S5-S6-export-shift-report.md's S5 §Content list:
 * running header (job id, title, machine, change #, printed time), a draft
 * banner, safety text (verbatim or a fallback), a "bring to the job" list,
 * steps (done by/at or an empty box), readings (current + every superseded
 * value, kept and marked — reused directly from reduce.ts, which already
 * computes this), notes/questions, parts, torques (missing source prints
 * "no source — unverified"), photos, handover, and a footer disclaimer with
 * signature lines. `plainText` flattens every visible string so a banned-
 * words test can scan the whole sheet in one assertion.
 *
 * Interpretation note (see task report "deviations"): `JobSheetBody` has no
 * field literally named "safety" — `isolationPoints` (LOTO/isolation points)
 * is the closest match to the spec's "Safety ... follow your site's lockout
 * procedure" fallback, so that's what this maps to.
 */
import type {
  SheetHandoverEntry,
  SheetNoteView,
  SheetPartView,
  SheetPhotoView,
  SheetQuestionView,
  SheetReadingView,
  SheetStepView,
  SheetView,
} from "@/capabilities/living-sheet/reduce";
import type { JobSheetItem, JobSheetTorque } from "@/capabilities/living-sheet/types";

const DRAFT_BANNER_TEXT = "DRAFT job sheet — not reviewed";
const SAFETY_FALLBACK = "Not written — follow your site's lockout procedure";
const FOOTER_DISCLAIMER = "This sheet records what was reported. It does not authorize return to service.";
const NO_SOURCE_TEXT = "no source — unverified";

export type PrintTorqueLine = JobSheetTorque & { sourceText: string };

export type PrintSection =
  | { kind: "banner"; text: string }
  | { kind: "safety"; text: string }
  | { kind: "bringToJob"; items: JobSheetItem[] }
  | { kind: "steps"; items: SheetStepView[] }
  | { kind: "readings"; items: SheetReadingView[] }
  | { kind: "notes"; items: SheetNoteView[] }
  | { kind: "questions"; items: SheetQuestionView[] }
  | { kind: "parts"; items: SheetPartView[] }
  | { kind: "torques"; items: PrintTorqueLine[] }
  | { kind: "photos"; items: SheetPhotoView[] }
  | { kind: "handover"; current: SheetHandoverEntry | null; history: SheetHandoverEntry[] };

export type PrintFooter = { disclaimer: string; signatureLines: string[] };

export type PrintModel = {
  header: string;
  sections: PrintSection[];
  footer: PrintFooter;
  /** Every visible string in the sheet, newline-joined — the surface the
   *  banned-words test scans. */
  plainText: string;
};

export type PrintModelOpts = {
  printedAt: string;
  seq: number;
  machineName?: string;
  jobIdShort?: string;
};

function buildHeader(view: SheetView, opts: PrintModelOpts): string {
  const jobIdShort = opts.jobIdShort ?? view.jobId.slice(0, 8);
  const machineName = opts.machineName ?? view.machine.name ?? view.machine.entityId;
  return `JOB ${jobIdShort} · ${view.title} · ${machineName} · Snapshot at change #${opts.seq} · Printed ${opts.printedAt}`;
}

function textOfSection(section: PrintSection): string[] {
  switch (section.kind) {
    case "banner":
    case "safety":
      return [section.text];
    case "bringToJob":
      return section.items.flatMap((i) => [i.item, i.spec, i.notes].filter((v): v is string => v !== null));
    case "steps":
      return section.items.flatMap((s) => [s.text, s.note].filter((v): v is string => v !== null));
    case "readings":
      return section.items.flatMap((r) => [
        r.what,
        `${r.current.value} ${r.current.unit}`,
        ...r.history.map((h) => `${h.value} ${h.unit}`),
      ]);
    case "notes":
      return section.items.map((n) => n.text);
    case "questions":
      return section.items.flatMap((q) => [q.text, q.resolution].filter((v): v is string => v !== null));
    case "parts":
      return section.items.map((p) => p.item);
    case "torques":
      return section.items.flatMap((t) =>
        [t.what, t.pattern, t.threadLocker, t.tool, t.sourceText].filter((v): v is string => v !== null),
      );
    case "photos":
      return section.items.flatMap((p) => (p.caption !== null ? [p.caption] : []));
    case "handover":
      return [section.current, ...section.history].filter((h): h is SheetHandoverEntry => h !== null).map((h) => h.text);
  }
}

/** Pure: same view + opts in, same PrintModel out. */
export function printModel(view: SheetView, opts: PrintModelOpts): PrintModel {
  const sections: PrintSection[] = [];

  if (view.templateStatus === "draft") {
    sections.push({ kind: "banner", text: DRAFT_BANNER_TEXT });
  }

  sections.push({ kind: "safety", text: view.template.isolationPoints ?? SAFETY_FALLBACK });
  sections.push({ kind: "bringToJob", items: view.template.items });
  sections.push({ kind: "steps", items: view.steps });
  sections.push({ kind: "readings", items: view.readings });
  sections.push({ kind: "notes", items: view.notes });
  sections.push({ kind: "questions", items: view.questions });
  sections.push({ kind: "parts", items: view.parts });
  sections.push({
    kind: "torques",
    items: view.template.torques.map((t) => ({ ...t, sourceText: t.source ?? NO_SOURCE_TEXT })),
  });
  sections.push({ kind: "photos", items: view.photos });
  sections.push({ kind: "handover", current: view.handover.current, history: view.handover.history });

  const footer: PrintFooter = { disclaimer: FOOTER_DISCLAIMER, signatureLines: ["Technician", "Supervisor"] };
  const header = buildHeader(view, opts);

  const plainText = [header, ...sections.flatMap(textOfSection), footer.disclaimer, ...footer.signatureLines].join(
    "\n",
  );

  return { header, sections, footer, plainText };
}
