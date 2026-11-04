/**
 * Work Packet V2 view — pure helpers (no I/O, no React) for the phased, numbered procedure, the
 * readiness summary and the measurement table. `WorkPacketPanel.tsx` renders what these return.
 *
 * HSE human-factors shape: numbered actions in the order they are done, each step carrying its own
 * notes, figure and torque value, and a short summary up front of what is still open. Nothing here
 * decides a value: it only arranges what the packet already holds.
 */
import type { Field, PacketFigure, ReviewEntry, WorkPacket } from "@/capabilities/work-packet/types";
import type { JobRecord } from "@/capabilities/work-packet/job-record";
import { stepsWithFigures } from "./work-packet-view";

type Phase = "removal" | "service" | "reinstall";

export const PHASE_TITLE: Record<Phase, string> = {
  removal: "Part A — Removal (to reach the parts being serviced)",
  service: "Part B — Service",
  reinstall: "Part C — Reinstall",
};

export interface StepView {
  /** Index into `packet.steps` (the edit path uses it). */
  index: number;
  /** The number the technician reads: 1..N across the whole packet. */
  number: number;
  /** Indexes into `packet.steps[index].notes`. */
  notes: number[];
  figures: PacketFigure[];
  /** Indexes into `packet.measurements` whose value this step uses. */
  measurements: number[];
}

export interface PhaseView {
  phase: Phase | null;
  title: string;
  /** Distinct "why these steps are included" lines (Proposed), shown once under the title. */
  inclusion: Field[];
  steps: StepView[];
}

/** Steps grouped into removal / service / reinstall, numbered 1..N. A packet saved before V2 has no
 *  phases: it is one group, with photos after a section's last step as V1 showed them. */
export function phasedSteps(packet: Pick<WorkPacket, "steps" | "figures" | "measurements">): PhaseView[] {
  const v2 = packet.steps.some((s) => s.phase);
  const measurementsFor = (i: number) =>
    packet.measurements.map((m, k) => ((m.steps ?? []).includes(i) ? k : -1)).filter((k) => k >= 0);
  const view = (i: number, figures: PacketFigure[]): StepView => ({
    index: i,
    number: i + 1,
    notes: (packet.steps[i].notes ?? []).map((_, j) => j),
    figures,
    measurements: measurementsFor(i),
  });
  if (!v2) {
    return [{ phase: null, title: "Steps", inclusion: [], steps: stepsWithFigures(packet).map(({ index, figures }) => view(index, figures)) }];
  }
  const groups: PhaseView[] = [];
  packet.steps.forEach((s, i) => {
    const phase = s.phase ?? "service";
    let g = groups[groups.length - 1];
    if (!g || g.phase !== phase) {
      g = { phase, title: PHASE_TITLE[phase], inclusion: [], steps: [] };
      groups.push(g);
    }
    if (s.inclusion && !g.inclusion.some((f) => f.basis === s.inclusion!.basis)) g.inclusion.push(s.inclusion);
    g.steps.push(view(i, (packet.figures ?? []).filter((f) => f.step === i)));
  });
  return groups;
}

/** V2 figures the builder could not match to one step — listed once by page, never attached to a
 *  guessed step. V1 packets place every figure by section, so there are none. */
export function unplacedFigures(packet: Pick<WorkPacket, "steps" | "figures">): PacketFigure[] {
  if (!packet.steps.some((s) => s.phase)) return [];
  return (packet.figures ?? []).filter((f) => f.step === null || f.step === undefined);
}

export interface Readiness {
  /** Never "ready": a packet is at best a draft until a supervisor approves it on site. */
  status: "needs_review" | "draft";
  lines: string[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What is still open, in plain words, for the top of the packet. Any open question or unknown
 *  means "needs review". It never says the equipment is safe or may return to service. */
export function readinessSummary(packet: Pick<WorkPacket, "blockers" | "unknowns" | "safety" | "approval" | "steps" | "coverage">): Readiness {
  const blockers = (packet.blockers ?? []).filter((b) => !b.struck).length;
  const unknowns = packet.unknowns.filter((u) => !u.struck).length + packet.safety.cautions.filter((c) => c.label === "unknown" && !c.struck).length;
  const struck = packet.steps.filter((s) => s.text.struck).length;
  const lines: string[] = [];
  // N1: a packet built from part of the manual says so before anything else.
  const partial = !!packet.coverage && !packet.coverage.complete;
  if (partial) lines.push(packet.coverage!.summary);
  if (blockers > 0) lines.push(`${plural(blockers, "open question", "open questions")} the documents cannot settle — a qualified person must settle them before work starts (see "Before you start").`);
  if (unknowns > 0) lines.push(`${plural(unknowns, "item is", "items are")} unknown — the documents do not give a value. Nothing has been guessed.`);
  if (struck > 0) lines.push(`${plural(struck, "step was", "steps were")} struck by a technician.`);
  lines.push("Site isolation and lockout: your site must confirm them.");
  const sup = packet.approval.supervisor;
  lines.push(sup.state === "approved" ? `Supervisor approval: approved by ${sup.by ?? "(unnamed)"}.` : "Supervisor approval: pending.");
  return { status: partial || blockers > 0 || unknowns > 0 ? "needs_review" : "draft", lines };
}

export interface MeasurementRow {
  index: number;
  item: string;
  /** The value as the packet was built from the manual. `label` is null once corrected: the edit
   *  log keeps the earlier value, not its earlier label. */
  manual: { value: string | null; label: Field["label"] | null };
  /** A technician's correction, kept apart from the manual value. */
  correction: { value: string | null; by: string; at: string } | null;
  approval: string;
  measured: { value: string; by: string; at: string } | null;
  /** Step numbers (1-based) that use this value. */
  steps: number[];
}

/** One row per torque/measurement value with the manual value, a correction, approval and the
 *  measured value in separate columns. The manual value is the one before the first correction. */
export function measurementRows(packet: Pick<WorkPacket, "measurements" | "approval">, record: JobRecord | null): MeasurementRow[] {
  const entries = packet.approval.technicianReview.entries;
  return packet.measurements.map((m, i) => {
    const path = `measurements[${i}].value`;
    // Every edit that changes the value — a correction or "mark unknown" (Codex EGM F07).
    const sets = entries.filter((e: ReviewEntry) => e.path === path && (e.action === "set" || e.action === "mark_unknown"));
    const first = sets[0];
    const last = sets[sets.length - 1];
    const sup = packet.approval.supervisor;
    return {
      index: i,
      item: m.name.value ?? "(unknown)",
      manual: first
        ? { value: typeof first.previous === "string" ? first.previous : null, label: null }
        : { value: m.value.value, label: m.value.label },
      correction: last ? { value: m.value.value, by: last.by, at: last.at } : null,
      approval: sup.state === "approved" ? `Approved by ${sup.by ?? "(unnamed)"}` : "Not approved — the site decides",
      measured: record?.measurements[i] ?? null,
      steps: (m.steps ?? []).map((s) => s + 1),
    };
  });
}
