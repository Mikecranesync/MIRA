/**
 * Work Packet (#4982) — packet verifier, pure (no I/O).
 *
 * `verifyPacket` is the trust boundary this capability promises in `./types.ts`'s header comment:
 * every "verified" value is either read verbatim from a cited line, or it isn't verified. This
 * module is what makes that a checked invariant instead of a convention — `buildDraftPacket`
 * (`./draft.ts`) calls it on every packet it assembles and downgrades anything it flags, so a
 * caller never receives a packet this function would complain about.
 *
 * Problems are returned as `"<path>: <message>"` strings, where `<path>` is exactly the dotted/
 * bracket path `applyEdit` (`./edits.ts`) accepts for that same field — so a caller can locate and
 * fix (or downgrade) the offending field without re-deriving the path.
 */

import type { Field, WorkPacket } from "./types";

export interface FieldLocation {
  path: string;
  field: Field;
}

/** Every `Field` in a `WorkPacket`, paired with the dotted/bracket path that addresses it. */
export function collectFields(packet: WorkPacket): FieldLocation[] {
  const out: FieldLocation[] = [];
  out.push({ path: "equipment.manufacturer", field: packet.equipment.manufacturer });
  out.push({ path: "equipment.model", field: packet.equipment.model });
  out.push({ path: "equipment.serial", field: packet.equipment.serial });
  packet.scope.forEach((f, i) => out.push({ path: `scope[${i}]`, field: f }));
  packet.safety.cautions.forEach((f, i) => out.push({ path: `safety.cautions[${i}]`, field: f }));
  out.push({ path: "safety.siteIsolation", field: packet.safety.siteIsolation });
  packet.parts.forEach((p, i) => {
    out.push({ path: `parts[${i}].partNumber`, field: p.partNumber });
    out.push({ path: `parts[${i}].description`, field: p.description });
    out.push({ path: `parts[${i}].qty`, field: p.qty });
  });
  packet.tools.forEach((f, i) => out.push({ path: `tools[${i}]`, field: f }));
  packet.steps.forEach((s, i) => {
    out.push({ path: `steps[${i}].text`, field: s.text });
    if (s.applicability) out.push({ path: `steps[${i}].applicability`, field: s.applicability });
    if (s.inclusion) out.push({ path: `steps[${i}].inclusion`, field: s.inclusion });
    (s.notes ?? []).forEach((n, j) => {
      out.push({ path: `steps[${i}].notes[${j}].text`, field: n.text });
      if (n.applicability) out.push({ path: `steps[${i}].notes[${j}].applicability`, field: n.applicability });
    });
  });
  (packet.figures ?? []).forEach((f, i) => {
    if (f.placement) out.push({ path: `figures[${i}].placement`, field: f.placement });
  });
  packet.measurements.forEach((m, i) => {
    out.push({ path: `measurements[${i}].name`, field: m.name });
    out.push({ path: `measurements[${i}].value`, field: m.value });
    out.push({ path: `measurements[${i}].tool`, field: m.tool });
    if (m.link) out.push({ path: `measurements[${i}].link`, field: m.link });
    if (m.measured) out.push({ path: `measurements[${i}].measured`, field: m.measured });
  });
  (packet.jha ?? []).forEach((r, i) => {
    out.push({ path: `jha[${i}].task`, field: r.task });
    out.push({ path: `jha[${i}].hazard`, field: r.hazard });
    out.push({ path: `jha[${i}].controls`, field: r.controls });
  });
  (packet.qualifications ?? []).forEach((f, i) => out.push({ path: `qualifications[${i}]`, field: f }));
  (packet.restoration ?? []).forEach((f, i) => out.push({ path: `restoration[${i}]`, field: f }));
  packet.unknowns.forEach((f, i) => out.push({ path: `unknowns[${i}]`, field: f }));
  (packet.blockers ?? []).forEach((f, i) => out.push({ path: `blockers[${i}]`, field: f }));
  (packet.leftOut ?? []).forEach((f, i) => out.push({ path: `leftOut[${i}]`, field: f }));
  return out;
}

/** Alphanumeric tokens that contain at least one digit — numbers and part numbers. */
function numericTokens(value: string): string[] {
  const raw = value.match(/[A-Za-z0-9][A-Za-z0-9.\-/]*/g) ?? [];
  const withDigits = raw.filter((t) => /\d/.test(t));
  return Array.from(new Set(withDigits));
}

/** Tokens in `value` that do NOT appear verbatim as a substring of `line`. */
function tokensNotOnLine(value: string, line: string): string[] {
  return numericTokens(value).filter((t) => !line.includes(t));
}

const MEASUREMENT_VALUE_PATH = /^measurements\[\d+\]\.value$/;
const JHA_CONTROLS_PATH = /^jha\[\d+\]\.controls$/;
const QUALIFICATION_PATH = /^qualifications\[\d+\]$/;
// V2 judgements the manual does not state — applicability, inclusion, step links, photo placement,
// a technician's measured reading — are never verified; a blocker stays open until a person settles it.
const NEVER_VERIFIED_PATH = /^(?:steps\[\d+\]\.(?:applicability|inclusion|notes\[\d+\]\.applicability)|measurements\[\d+\]\.(?:link|measured)|figures\[\d+\]\.placement|blockers\[\d+\])$/;

export function verifyPacket(packet: WorkPacket): string[] {
  const problems: string[] = [];

  // N1: a packet built from part of the manual's procedure fails its own check, whatever it holds.
  if (packet.coverage && !packet.coverage.complete) problems.push(`coverage: ${packet.coverage.summary}`);

  const all = collectFields(packet);
  const byPath = new Map(all.map((l) => [l.path, l.field]));

  for (const { path, field } of all) {
    // A copy shown in a second section must match its original (Codex #5062 F18).
    if (field.copyOf) {
      const original = byPath.get(field.copyOf);
      if (!original) {
        problems.push(`${path}: copy of '${field.copyOf}', which is not in the packet`);
      } else if (original.value !== field.value || original.label !== field.label || !!original.struck !== !!field.struck) {
        problems.push(`${path}: differs from its original '${field.copyOf}'`);
      }
    }

    if (field.label === "verified" && packet.coverage && !packet.coverage.complete) {
      problems.push(`${path}: verified in a packet that is not the whole job`);
    }

    if (field.label === "verified") {
      if (!field.source) {
        problems.push(`${path}: verified without a source`);
      } else if (field.value !== null) {
        const bad = tokensNotOnLine(field.value, field.source.line);
        if (bad.length > 0) {
          problems.push(`${path}: verified value '${field.value}' has numbers/part numbers not verbatim on its source line: ${bad.join(", ")}`);
        }
      }
    }

    if (path === "safety.siteIsolation" && field.label !== "unknown") {
      problems.push(`${path}: site isolation must stay unknown — the site owns isolation and lockout`);
    }

    // Hazard controls and qualifications are site decisions: the tool never writes them. A technician
    // may type the site's answer (an edit makes it "proposed"); nothing may present one as verified.
    if ((JHA_CONTROLS_PATH.test(path) || QUALIFICATION_PATH.test(path)) && field.label === "verified") {
      problems.push(`${path}: hazard controls and qualifications come from the site, never verified from manufacturer documents`);
    }

    if (NEVER_VERIFIED_PATH.test(path) && field.label === "verified") {
      problems.push(`${path}: applicability, inclusion, links, placement, readings and blockers are never verified from manufacturer documents`);
    }

    // A measurement's value carries real numbers a technician will torque to — hold it to the
    // line-level check even if (through a bug or an edit) its label isn't "verified".
    if (MEASUREMENT_VALUE_PATH.test(path) && field.label !== "unknown") {
      if (!field.source) {
        problems.push(`${path}: measurement value is not sourced to one line`);
      } else if (field.value !== null) {
        const bad = tokensNotOnLine(field.value, field.source.line);
        if (bad.length > 0) {
          problems.push(`${path}: measurement value '${field.value}' is not from one source line (mismatched: ${bad.join(", ")})`);
        }
      }
    }
  }

  return problems;
}
