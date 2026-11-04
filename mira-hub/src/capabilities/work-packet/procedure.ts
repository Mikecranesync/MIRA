/**
 * Work Packet V2 — the job sequence, pure (no I/O).
 *
 * V1 printed the selected sections' steps and left the technician to find the rest. V2 builds the
 * whole applicable job in the manual's own words, in three phases:
 *   removal   — a "REMOVING THE X" section the requested work depends on (a service step names X)
 *   service   — the requested sections, for this model only
 *   reinstall — where the manual puts X back (inside another section's reassembly), from that step
 *               to the end of that block
 * Nothing is invented: every step is a manufacturer line, cited. Why a removal/reinstall step is in
 * the packet is a "proposed" note, because the manual does not say "do this for a reseal". If X is
 * taken off but the manual's reinstall steps are not found, that is a blocker, not a guess.
 *
 * Every NOTE printed inside a block rides with the step it follows. Lines and notes for other
 * models go to the left-out list; lines covering this and other models carry a proposed
 * "read your part" note; date/style/revision/application restrictions become blockers.
 */

import { modelScopeAdmits, scopedApplicability, textApplicability } from "./applicability";
import type { Applicability } from "./applicability";
import type { DocText, Field, PacketStep, ServiceManual, SmCaution, SmSection, SmStep, StepNote, Topic } from "./types";

// A note printed after a step that warns about doing that very step ("Using the reverse pliers may
// damage the bore" after "With a reverse pliers, pull out the seal") belongs before it: by the time a
// technician reads past the step, the damage is done. Cautionary wording plus a shared noun (5+
// letters) ties the warning to the step; a plain note ("the Spacer may stay in the head") stays after.
const CAUTIONARY_RE = /\b(?:may\s+damage|damage|caution|careful|avoid|do\s+not|never|injur\w*|scor\w*|support)\b/i;
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{5,}/g) ?? []));
function warnsAboutStep(kind: SmCaution["kind"], note: string, step: string): boolean {
  if (kind === "WARNING" || kind === "CAUTION") return true;
  if (!CAUTIONARY_RE.test(note)) return false;
  const w = words(step);
  return Array.from(words(note)).some((x) => w.has(x));
}

export interface ManualDoc {
  doc: DocText;
  manual: ServiceManual;
}

export interface ProcedureResult {
  steps: PacketStep[];
  leftOut: Field[];
  blockers: Field[];
  unknowns: Field[];
  /** Cautions now shown next to a step or left out with their block — not repeated in Safety. */
  placed: Set<SmCaution>;
}

const REMOVING_RE = /^REMOVING THE (.+)$/;
const REINSTALL_VERB_RE = /\b(?:replace|replaces|slip|slide|install|reinstall|reassemble|fit|refit|mount)\b/i;
const REASSEMBLY_RE = /\breassembl/i;
/** Steps that only ready the pump for putting a part back ("Rotate crankshaft by hand so …",
 *  "Lubricate the Plungers."). An allow-list of the verbs seen in those steps: any other first word stops the walk back, so work the
 *  packet was not asked for is never pulled in as "preparation". */
const PREP_VERB_RE = /^(?:rotate|turn|lubricate|oil)\b/i;
const IN_SEQUENCE_RE = /\bin (?:this|the following) (?:sequence|order)\b/i;

const blockKey = (heading: string, sub: string | null) => `${heading}\u0000${sub ?? ""}`;
const where = (s: { heading: string; subheading: string | null }) => (s.subheading ? `${s.heading} — ${s.subheading}` : s.heading);
const titleWords = (x: string) => x.toLowerCase();

function applicabilityField(a: Applicability, source: Field["source"]): Field | undefined {
  if (a.kind === "mixed") return { value: a.reason, label: "proposed", source, basis: "this line also covers other models — use only the part for this pump" };
  if (a.kind === "unresolved")
    return { value: null, label: "unknown", source, basis: `${a.reason}${a.phrase ? `: "${a.phrase}"` : ""} — a qualified person must settle this from the pump's documents` };
  return undefined;
}

/** "Verified" means the manual says this for this exact model. A line that also names other models,
 *  or is limited by a restriction the documents cannot settle, is the manual's own words but only
 *  Proposed for this pump. */
function downgrade(text: Field, a: Applicability): void {
  if (a.kind !== "mixed" && a.kind !== "unresolved") return;
  text.label = "proposed";
  text.basis += a.kind === "mixed"
    ? " — the manual's own line, but it also names other models: use only the part for this pump"
    : " — the manual's own line, limited by a restriction the documents cannot settle";
}

export function buildProcedure(manuals: ManualDoc[], topics: Topic[], model: string): ProcedureResult {
  const steps: PacketStep[] = [];
  const leftOut: Field[] = [];
  const blockers: Field[] = [];
  const unknowns: Field[] = [];
  const placed = new Set<SmCaution>();
  const blockerTexts = new Map<string, Field>();

  const addBlocker = (text: string, a: Applicability & { kind: "unresolved" }, source: Field["source"]) => {
    const seen = blockerTexts.get(text);
    if (seen) {
      if (source && seen.source && source.page !== seen.source.page) seen.basis = seen.basis.replace(/ \(p\.([\d, ]+)\)/, (_m, pages) => ` (p.${pages}, ${source.page})`);
      return;
    }
    const b: Field = {
      value: null,
      label: "unknown",
      source,
      basis: `The manual says: "${text}" (p.${source?.page ?? "?"}) — ${a.reason}${a.phrase ? ` ("${a.phrase}")` : ""}. The attached documents do not settle whether it applies to this pump. A qualified person must decide before work starts; this packet does not guess.`,
    };
    blockerTexts.set(text, b);
    blockers.push(b);
  };

  for (const { doc, manual } of manuals) {
    const covered = manual.modelsCovered;
    const label = doc.filename ?? doc.docId;
    const service: PacketStep[] = [];
    const removal: PacketStep[] = [];
    const reinstall: PacketStep[] = [];
    // block → step number → the packet step built from it (for notes)
    const byBlock = new Map<string, Map<number | null, PacketStep>>();
    // blocks that are part of this job (any step of theirs is in the packet)
    const jobBlocks = new Set<string>();
    // block → step numbers this packet leaves out for scope (not for model): their notes go with them
    const scopeLeftOut = new Map<string, Set<number | null>>();

    const toStep = (section: SmSection, step: SmStep, phase: PacketStep["phase"], inclusion?: Field): PacketStep | null => {
      const a = textApplicability(step.text, model, covered);
      if (a.kind === "other_models") {
        leftOut.push({ value: step.text, label: "proposed", source: step.source, basis: `step for other models (${a.reason}) — ${where(section)}` });
        return null;
      }
      const ps: PacketStep = {
        section: section.heading,
        subheading: section.subheading,
        topic: section.topic,
        phase,
        n: step.n,
        text: { value: step.text, label: "verified", source: step.source, basis: where(section) },
        notes: [],
      };
      const af = applicabilityField(a, step.source);
      if (af) ps.applicability = af;
      downgrade(ps.text, a);
      if (a.kind === "unresolved") addBlocker(step.text, a, step.source);
      if (inclusion) ps.inclusion = inclusion;
      if (step.diagram && IN_SEQUENCE_RE.test(step.text)) {
        // The order is a picture of screw positions; copying its numbers without the layout would
        // invite a guess, so the note only says where it is.
        ps.notes!.push({
          kind: "NOTE",
          text: {
            value: `Tightening order: the manual prints it as a diagram right after this step (p.${step.diagram.page} of ${label}). It is not copied into this packet — read it from the manual.`,
            label: "proposed",
            source: step.diagram,
            basis: "the diagram's numbers are screw positions on the part; this packet does not reproduce the layout",
          },
        });
      }
      const k = blockKey(section.heading, section.subheading);
      if (!byBlock.has(k)) byBlock.set(k, new Map());
      if (!byBlock.get(k)!.has(step.n)) byBlock.get(k)!.set(step.n, ps);
      jobBlocks.add(k);
      return ps;
    };

    // ---- service: the requested sections, this model only ----
    for (const section of manual.sections) {
      if (section.topic === "other" || !topics.includes(section.topic)) continue;
      if (section.models.unresolved) {
        if (section.steps.length > 0) {
          unknowns.push({
            value: null,
            label: "unknown",
            source: section.steps[0].source,
            basis: `${section.heading} — ${section.subheading ?? "section"}: the manual limits these steps to some models or hardware variants and this tool cannot tell whether this pump is one. Steps left out; use the manual directly for this part.`,
          });
        }
        continue;
      }
      if (!modelScopeAdmits(section.models, model)) {
        if (section.steps.length > 0) leftOut.push({ value: where(section), label: "proposed", source: section.steps[0].source, basis: `block printed for other models (p.${section.page}) — not for ${model}` });
        continue;
      }
      for (const step of section.steps) {
        if (stepNamesOtherModelsLead(step.text, model)) {
          leftOut.push({ value: step.text, label: "proposed", source: step.source, basis: `step for other models — ${where(section)}` });
          continue;
        }
        const ps = toStep(section, step, "service");
        if (ps) service.push(ps);
      }
    }

    // ---- removal: "REMOVING THE X" sections the service steps depend on ----
    const serviceText = service.map((s) => (s.text.value ?? "").toLowerCase());
    const removed: { x: string; section: SmSection }[] = [];
    for (const section of manual.sections) {
      const m = REMOVING_RE.exec(section.heading);
      if (!m || section.topic !== "other" || section.steps.length === 0) continue;
      if (section.models.unresolved || !modelScopeAdmits(section.models, model)) continue;
      const x = m[1];
      const i = serviceText.findIndex((t) => t.includes(titleWords(x)) || t.includes(section.heading.toLowerCase()));
      if (i === -1) continue;
      const by = service[i];
      const inclusion: Field = {
        value: `needed to reach the work: the step "${clip(by.text.value)}" (p.${by.text.source?.page ?? "?"}) works on the ${titleCase(x)}`,
        label: "proposed",
        source: by.text.source,
        basis: `the manual prints how to take off the ${titleCase(x)} in "${section.heading}" (p.${section.page}); a qualified person confirms it is needed`,
      };
      removed.push({ x, section });
      for (const step of section.steps) {
        const ps = toStep(section, step, "removal", inclusion);
        if (ps) removal.push(ps);
      }
    }

    // ---- reinstall: where the manual puts each removed part back ----
    if (removed.length > 0) {
      const serviceBlocks = new Set(manual.sections.filter((s) => s.topic !== "other" && topics.includes(s.topic)).map((s) => blockKey(s.heading, s.subheading)));
      let found: { section: SmSection; from: number } | null = null;
      for (const section of manual.sections) {
        if (REMOVING_RE.test(section.heading) || serviceBlocks.has(blockKey(section.heading, section.subheading))) continue;
        if (!REASSEMBLY_RE.test(section.subheading ?? "")) continue;
        if (section.models.unresolved || !modelScopeAdmits(section.models, model)) continue;
        const from = section.steps.findIndex((st) => REINSTALL_VERB_RE.test(st.text) && removed.some((r) => st.text.toLowerCase().includes(titleWords(r.x))));
        if (from !== -1) {
          found = { section, from };
          break;
        }
      }
      if (found) {
        const { section, from } = found;
        const first = section.steps[from];
        const inclusion: Field = {
          value: `puts back what was taken off: the manual reinstalls it in "${where(section)}" from step ${first.n ?? "?"}`,
          label: "proposed",
          source: first.source,
          basis: `steps from "${clip(first.text)}" (p.${first.source.page}) to the end of that block; a qualified person confirms the order`,
        };
        // The manual readies the pump just before putting the part back (turn the shaft, oil the
        // plungers): those steps belong to the reinstall too (Codex EGM F01).
        let start = from;
        while (start > 0 && PREP_VERB_RE.test(section.steps[start - 1].text)) start--;
        const prepInclusion: Field = {
          value: `readies the pump for putting back what was taken off: the manual's step${from - start > 1 ? "s" : ""} just before step ${first.n ?? "?"} in "${where(section)}"`,
          label: "proposed",
          source: section.steps[start].source,
          basis: `printed right before "${clip(first.text)}" (p.${first.source.page}); a qualified person confirms they are needed`,
        };
        const earlier = section.steps.slice(0, start);
        const k = blockKey(section.heading, section.subheading);
        if (!scopeLeftOut.has(k)) scopeLeftOut.set(k, new Set());
        earlier.forEach((st) => {
          scopeLeftOut.get(k)!.add(st.n);
          leftOut.push({ value: st.text, label: "proposed", source: st.source, basis: `earlier step of "${where(section)}" — not part of putting the removed parts back; whether it is needed is an open question (see Before you start)` });
        });
        if (earlier.length > 0) {
          const nums = earlier.map((st) => st.n).filter((n): n is number => n !== null);
          const range = nums.length > 0 ? (nums.length > 1 ? `steps ${nums[0]}–${nums[nums.length - 1]}` : `step ${nums[0]}`) : "earlier steps";
          blockers.push({
            value: null,
            label: "unknown",
            source: earlier[0].source,
            basis: `"${where(section)}" (p.${earlier[0].source.page}) has ${range} before the steps that put the removed parts back. This packet leaves them out; the manual does not say whether they are needed when only those parts come off. A qualified person decides before "${clip(first.text)}".`,
          });
        }
        section.steps.slice(start, from).forEach((st) => {
          const ps = toStep(section, st, "reinstall", prepInclusion);
          if (ps) reinstall.push(ps);
        });
        for (const st of section.steps.slice(from)) {
          const ps = toStep(section, st, "reinstall", inclusion);
          if (ps) reinstall.push(ps);
        }
      } else {
        for (const r of removed) {
          blockers.push({
            value: null,
            label: "unknown",
            source: r.section.steps[0].source,
            basis: `This packet takes off the ${titleCase(r.x)} ("${r.section.heading}", p.${r.section.page}) but the manual's steps for putting it back were not found. A qualified person must supply them before work starts.`,
          });
        }
      }
    }

    // ---- notes: next to the step they follow ----
    for (const c of manual.cautions) {
      if (!c.context || c.kind !== "NOTE") continue;
      const k = blockKey(c.context.heading, c.context.subheading);
      if (!jobBlocks.has(k)) {
        // a note in a block that is in the job's sections but for other models
        const s = manual.sections.find((x) => blockKey(x.heading, x.subheading) === k);
        if (s && s.topic !== "other" && topics.includes(s.topic) && !s.models.unresolved) placed.add(c);
        continue;
      }
      placed.add(c);
      const blk = byBlock.get(k)!;
      // The step it follows; when that step is left out (another model's), the nearest kept step
      // before it in the block, else the next one — the note still applies to this pump.
      const kept = Array.from(blk.entries());
      const after = c.context.afterStep;
      if (after !== null && scopeLeftOut.get(k)?.has(after)) {
        // It follows a step this packet leaves out for scope, so it goes with that step (Codex EGM F03).
        leftOut.push({ value: c.text, label: "proposed", source: c.source, basis: `note after a step this packet leaves out — ${where(c.context)}` });
        continue;
      }
      const target =
        after === null
          ? kept[0]?.[1]
          : blk.get(after) ?? [...kept].reverse().find(([n]) => n !== null && n < after)?.[1] ?? kept.find(([n]) => n !== null && n > after)?.[1];
      const a = scopedApplicability(c.text, c.context.models, model, covered);
      if (!target || a.kind === "other_models") {
        leftOut.push({
          value: c.text,
          label: "proposed",
          source: c.source,
          basis: a.kind === "other_models" ? `note for other models (${a.reason}) — ${where(c.context)}` : `note after a step this packet leaves out — ${where(c.context)}`,
        });
        continue;
      }
      const note: StepNote = {
        kind: c.kind,
        text: { value: c.text, label: "verified", source: c.source, basis: `${c.kind} — ${label}` },
        placement: after === null || warnsAboutStep(c.kind, c.text, target.text.value ?? "") ? "before" : "after",
      };
      const af = applicabilityField(a, c.source);
      if (af) note.applicability = af;
      downgrade(note.text, a);
      if (a.kind === "unresolved") addBlocker(c.text, a, c.source);
      target.notes!.push(note);
    }

    steps.push(...removal, ...service, ...reinstall);

    // Work the manual's check-lists tie to this service ("service the regulator at each seal
    // servicing"): an open question, never added as steps (Codex EGM F04).
    for (const cw of manual.companionWork ?? []) {
      if (!topics.some((t) => t.startsWith(cw.topic))) continue;
      const quote = cw.source.line.replace(/^[*\s]+/, "");
      blockers.push({
        value: null,
        label: "unknown",
        source: cw.source,
        basis: `The manual's check-list says: "${quote}" (p.${cw.source.page}). This packet does not include that work. A qualified person decides whether it is done with this job, and by whom, before work starts.`,
      });
    }
  }

  for (const s of steps) if (s.notes && s.notes.length === 0) delete s.notes;
  return { steps, leftOut, blockers, unknowns, placed };
}

// A step inside a general section can still be limited to one model by its own wording
// ("On the model 7CP6170 remove …") — also for models the cover does not list.
const STEP_MODEL_RE = /^On (?:the )?models? ([A-Z0-9][A-Z0-9-]*(?:\s*(?:,|and|&)\s*[A-Z0-9][A-Z0-9-]*)*)\s/i;
function stepNamesOtherModelsLead(text: string, model: string): boolean {
  const m = STEP_MODEL_RE.exec(text);
  if (!m) return false;
  const named = m[1].split(/\s*(?:,|and|&)\s*/i).filter((t) => /\d/.test(t));
  const norm = (s: string) => s.toUpperCase().replace(/[\s-]+/g, "");
  return named.length > 0 && !named.some((t) => norm(t) === norm(model));
}

function clip(s: string | null): string {
  const t = s ?? "";
  return t.length > 70 ? `${t.slice(0, 67)}…` : t;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}
