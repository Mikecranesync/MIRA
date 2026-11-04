/**
 * Work Packet V2 — reader coverage, pure (no I/O). Finding N1 (2026-11-03).
 *
 * On a two-column manual the parser can leave whole blocks out (text it cannot put in order) or keep
 * a block it cannot tie to this model. The procedure builder then lists those as open questions, but
 * the steps it did keep still look like the whole job. This module counts, per procedure heading the
 * job touches, the steps that are in the packet against the steps the manual prints there, so the
 * packet can say plainly when it is not the whole job.
 *
 * A heading counts toward the job when it is one of the requested topics, when packet steps come from
 * it, or when a packet step sends the technician to it ("as described under SERVICING THE PUMPING
 * SECTION") and none of its steps are in the packet. Text the parser could not read is counted from
 * the step lines it saw, so the total is a lower bound.
 */

import { modelScopeAdmits } from "./applicability";
import type { ManualDoc } from "./procedure";
import type { CoverageSection, PacketCoverage, PacketStep, SourceRef, Topic } from "./types";

interface Part {
  heading: string;
  notRead: number;
  reasons: string[];
  source: SourceRef | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const where = (s: { heading: string; subheading: string | null }) => (s.subheading ? `${s.heading} — ${s.subheading}` : s.heading);

export function computeCoverage(manuals: ManualDoc[], topics: Topic[], model: string, steps: PacketStep[]): PacketCoverage | undefined {
  if (manuals.length === 0) return undefined;

  const order: string[] = [];
  const parts = new Map<string, Part>();
  const counted = new Set<string>();
  let lowerBound = false;
  const touch = (heading: string): Part => {
    let p = parts.get(heading);
    if (!p) {
      p = { heading, notRead: 0, reasons: [], source: null };
      parts.set(heading, p);
      order.push(heading);
    }
    return p;
  };
  const notRead = (heading: string, key: string, n: number, reason: string, source: SourceRef | null, lower: boolean) => {
    if (counted.has(key)) return;
    counted.add(key);
    const p = touch(heading);
    p.notRead += n;
    p.reasons.push(reason);
    p.source ??= source;
    if (lower) lowerBound = true;
  };

  const readByHeading = new Map<string, number>();
  for (const s of steps) readByHeading.set(s.section, (readByHeading.get(s.section) ?? 0) + 1);
  for (const s of steps) touch(s.section);

  manuals.forEach(({ manual }, mi) => {
    const omitted = manual.omitted ?? [];
    const forJob = (t: Topic | "other") => t !== "other" && topics.includes(t);

    // (a) requested sections the reader kept but cannot tie to this model
    for (const s of manual.sections) {
      if (!forJob(s.topic)) continue;
      touch(s.heading);
      if (s.models.unresolved && s.steps.length > 0) {
        notRead(s.heading, `${mi}|s|${s.page}|${where(s)}`, s.steps.length, `"${where(s)}" (p.${s.page}): the manual limits these ${s.steps.length} steps to some models and this tool cannot tell whether this pump is one`, s.steps[0].source, false);
      }
    }
    // (b) requested sections the reader could not read in order
    for (const o of omitted) {
      if (!forJob(o.topic)) continue;
      if (!o.models.unresolved && !modelScopeAdmits(o.models, model)) continue;
      const n = o.stepsSeen ?? 0;
      notRead(o.heading, `${mi}|o|${o.page}|${where(o)}`, n, `"${where(o)}" (p.${o.page}): the text could not be read in order — at least ${n} steps not read`, o.source, true);
    }
    // (c) headings a packet step sends the technician to, none of whose steps are in the packet
    const headings = Array.from(new Set([...manual.sections.map((s) => s.heading), ...omitted.map((o) => o.heading)]));
    for (const h of headings) {
      if ((readByHeading.get(h) ?? 0) > 0) continue;
      const ref = new RegExp(`\\b(?:described\\s+(?:under|in)|refer\\s+to|see|procedure\\s+(?:for|in))\\s+(?:the\\s+)?${escapeRe(h)}\\b`, "i");
      const by = steps.find((s) => s.section !== h && ref.test(s.text.value ?? ""));
      if (!by) continue;
      const why = `a step in this packet says to do this "as described under ${h}" (p.${by.text.source?.page ?? "?"}), but none of those steps are in the packet`;
      for (const s of manual.sections) {
        if (s.heading !== h || s.steps.length === 0) continue;
        if (!s.models.unresolved && !modelScopeAdmits(s.models, model)) continue;
        notRead(h, `${mi}|s|${s.page}|${where(s)}`, s.steps.length, `"${where(s)}" (p.${s.page}): ${why}`, s.steps[0].source, false);
      }
      for (const o of omitted) {
        if (o.heading !== h) continue;
        if (!o.models.unresolved && !modelScopeAdmits(o.models, model)) continue;
        const n = o.stepsSeen ?? 0;
        notRead(h, `${mi}|o|${o.page}|${where(o)}`, n, `"${where(o)}" (p.${o.page}): ${why}; the text could not be read in order either — at least ${n} steps`, o.source, true);
      }
    }
  });

  const sections: CoverageSection[] = order.map((h) => {
    const p = parts.get(h)!;
    const read = readByHeading.get(h) ?? 0;
    const status: CoverageSection["status"] = p.notRead === 0 && p.reasons.length === 0 ? "read" : read > 0 ? "partly" : "not_read";
    return { heading: h, status, stepsRead: read, stepsNotRead: p.notRead, reasons: p.reasons, source: p.source };
  });
  const stepsRead = steps.length;
  const stepsTotal = stepsRead + sections.reduce((n, s) => n + s.stepsNotRead, 0);
  const complete = stepsRead > 0 && sections.every((s) => s.status === "read");
  const summary = complete
    ? `All ${stepsRead} steps the manual prints for this job could be read.`
    : stepsRead === 0
      ? "No steps for this job could be read from the manual; this is not the whole job."
      : `Only ${stepsRead} of ${lowerBound ? "at least " : ""}${stepsTotal} steps could be read; this is not the whole job.`;
  return { complete, stepsRead, stepsTotal, totalIsLowerBound: lowerBound, summary, sections };
}
