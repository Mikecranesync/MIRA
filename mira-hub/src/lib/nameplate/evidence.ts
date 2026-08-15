/**
 * Nameplate evidence layer — vision produces CANDIDATES, never truth.
 *
 * Why this module exists, in one real example. A technician photographed an
 * Oriental Motor actuator whose plate reads `1.27A`. The shipped recognizer
 * returned `12A` — a 10x current error — and also returned a `RoHS` mark that
 * does not appear on the plate at all. Both were emitted with confidence 0.95.
 *
 * A recognizer that can silently turn 1.27 A into 12 A, and can invent a
 * compliance marking, must not be allowed to write canonical asset facts. So:
 *
 *   IMAGE -> observation -> evidence -> corroboration -> conflict -> human -> canonical
 *
 * Two rules carry most of the safety weight:
 *
 *  1. IDENTITY and SPECIFICATION are different tasks with different risk.
 *     Identity (manufacturer/model/catalog) only has to be good enough to drive
 *     document discovery, which has its own downstream applicability proof — a
 *     wrong guess yields a wrong manual, which the applicability assessor
 *     rejects. Specifications (current, voltage, torque, RPM...) can be acted
 *     on by a human with a meter and a wrench, so a vision-only value is NEVER
 *     promotable on its own.
 *  2. A claim about something PRINTED on the plate requires image evidence.
 *     If the recognizer says "RoHS" but no observed text supports it, the claim
 *     is `inferred`, not `observed`, and it is never rendered as if it were read
 *     off the plate.
 *
 * This module is pure (no I/O, no provider calls) so every rule above is
 * directly testable and cannot drift with a model change.
 */

// ── Provenance ───────────────────────────────────────────────────────────────

/** Where a value came from. Ordered weakest → strongest. */
export type FactSource =
  | "image_inferred" // the model asserted it, image evidence NOT found
  | "image" // read from the photo, supported by observed text
  | "oem_document" // found in an applicable OEM document
  | "technician"; // a human typed or confirmed it

/**
 * Lifecycle of a fact. `canonical` is deliberately absent: promotion to
 * canonical asset knowledge happens through the existing approval systems, not
 * by anything in this module (see .claude/rules/materialized-evidence.md #9).
 */
export type FactStatus =
  | "observed" // read from the image, nothing else says otherwise yet
  | "candidate" // asserted but unsupported — needs a human or a document
  | "corroborated" // an independent source agrees
  | "conflicting" // sources disagree — a human MUST choose
  | "technician_confirmed"
  | "rejected";

export interface Corroboration {
  source: FactSource;
  value: string;
  /** Free-text detail: the OEM page, the agreeing pass, the technician id. */
  detail?: string;
}

export interface NameplateFact {
  field: string;
  value: string | null;
  /** Parsed magnitude for numeric fields — null when not numeric/parseable. */
  normalizedValue: number | null;
  unit: string | null;
  source: FactSource;
  /** The exact text the recognizer claims to have read. Never invented. */
  rawText: string | null;
  confidence: number | null;
  status: FactStatus;
  corroboration: Corroboration[];
  conflicts: Corroboration[];
  /** True when this field can hurt someone if it is wrong. */
  safetyCritical: boolean;
  /** Technician-facing reason, always present when status needs action. */
  reason?: string;
}

// ── Field taxonomy ───────────────────────────────────────────────────────────

/** Identity fields: permissive, because discovery independently validates. */
export const IDENTITY_FIELDS = new Set([
  "manufacturer",
  "model",
  "catalogNumber",
  "serialNumber",
  "equipmentType",
  "series",
  "productFamily",
]);

/**
 * Safety-relevant numeric fields. A vision-only value here is never promotable
 * without corroboration or an explicit human decision. Deliberately broad —
 * the cost of an extra confirmation tap is far below the cost of a wrong amp
 * rating reaching someone holding a meter.
 */
export const SAFETY_CRITICAL_FIELDS = new Set([
  "ratedCurrent",
  "current",
  "voltage",
  "power",
  "horsepower",
  "frequency",
  "rpm",
  "speed",
  "torque",
  "pressure",
  "temperature",
  "ambientTemperature",
  "load",
  "fuseRating",
  "breakerRating",
  "wireSize",
  "safetyCategory",
  "hazardousAreaClass",
  "protectionRating",
  "insulationClass",
  "stepAngle",
  "resolution",
]);

export function isSafetyCritical(field: string): boolean {
  return SAFETY_CRITICAL_FIELDS.has(field);
}

export function isIdentityField(field: string): boolean {
  return IDENTITY_FIELDS.has(field);
}

/**
 * Compliance / certification marks. These are the hallucination-prone class:
 * a model that knows "industrial actuators usually carry CE and RoHS" will
 * happily assert both. A mark claim with no image evidence is refused outright
 * rather than downgraded, because a fabricated certification is a compliance
 * statement, not a guess.
 */
export const COMPLIANCE_MARKS = new Set([
  "ce",
  "ul",
  "csa",
  "rohs",
  "reach",
  "atex",
  "iecex",
  "ukca",
  "uk ca",
  "tuv",
  "vde",
  "fcc",
  "ccc",
  "kc",
  "eac",
]);

export function isComplianceMark(token: string): boolean {
  return COMPLIANCE_MARKS.has(token.trim().toLowerCase());
}

// ── Numeric parsing ──────────────────────────────────────────────────────────

/**
 * Parse a magnitude + unit out of nameplate text.
 *
 * The decimal point is the whole game here: `1.27A`, `12A`, `12.7A` and `127A`
 * are four different machines' worth of difference, and OCR drops or moves the
 * separator constantly. We therefore parse STRICTLY — a comma decimal
 * (`1,27A`, common on EU plates) is honored, but we never "repair" a value by
 * inserting a separator we did not see.
 */
export function parseMeasurement(raw: string | null | undefined): {
  value: number | null;
  unit: string | null;
} {
  if (!raw) return { value: null, unit: null };
  const text = String(raw).trim();
  // Number: optional sign, digits, optional single . or , decimal group.
  const m = text.match(/(-?\d+(?:[.,]\d+)?)\s*([a-zA-ZΩ°µμ/%]+(?:\s*\/\s*[a-zA-Z]+)?)?/);
  if (!m) return { value: null, unit: null };
  const numRaw = m[1].replace(",", ".");
  const value = Number(numRaw);
  if (!Number.isFinite(value)) return { value: null, unit: null };
  const unit = m[2] ? m[2].replace(/\s+/g, "") : null;
  return { value, unit };
}

/**
 * Do two measurements agree? Requires BOTH the magnitude and the unit to match.
 * `1.27 A` and `12 A` must never compare equal — that is the exact failure this
 * whole module exists to catch — so there is no tolerance band on magnitude
 * beyond floating-point noise, and a differing unit is a disagreement even when
 * the numbers match (`40°C` vs `40A`).
 */
export function measurementsAgree(a: string | null, b: string | null): boolean {
  const pa = parseMeasurement(a);
  const pb = parseMeasurement(b);
  if (pa.value === null || pb.value === null) return false;
  if (Math.abs(pa.value - pb.value) > 1e-9) return false;
  const ua = (pa.unit ?? "").toLowerCase();
  const ub = (pb.unit ?? "").toLowerCase();
  if (ua && ub && ua !== ub) return false;
  return true;
}

// ── Image-evidence gate ──────────────────────────────────────────────────────

function normalizeForEvidence(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Is `claim` actually supported by something the recognizer says it READ?
 *
 * `rawText` is the recognizer's own list of observed lines. A claim is
 * supported when its normalized form appears inside one of those lines (or a
 * line appears inside the claim — plates split values across lines). This is
 * what separates "I read this" from "I know this about the product".
 */
export function hasImageEvidence(claim: string | null | undefined, rawText: string[]): boolean {
  if (!claim) return false;
  const needle = normalizeForEvidence(claim);
  if (!needle) return false;
  return rawText.some((line) => {
    const hay = normalizeForEvidence(line);
    if (!hay) return false;
    return hay.includes(needle) || needle.includes(hay);
  });
}

// ── Fact construction ────────────────────────────────────────────────────────

export interface ObservationInput {
  field: string;
  value: string | null;
  /** The recognizer's observed text lines for this image. */
  rawText: string[];
  confidence?: number | null;
  /** Number of independent passes that produced this same value, if known. */
  agreementCount?: number;
}

/**
 * Turn one raw recognizer observation into a provenance-carrying fact.
 *
 * The rules, in the order they fire:
 *  - A compliance mark with no image evidence is REJECTED (never merely
 *    downgraded) — asserting a certification nobody can see is worse than
 *    saying nothing.
 *  - Any other claim with no image evidence becomes `image_inferred` /
 *    `candidate`: it may still be right, but it must never be rendered as if
 *    it were read off the plate.
 *  - A safety-critical numeric is ALWAYS `candidate` on image evidence alone,
 *    however confident the model was. Only corroboration or a technician moves
 *    it.
 *  - Identity fields may rest at `observed`, because discovery + applicability
 *    will independently test them.
 */
export function toFact(obs: ObservationInput): NameplateFact {
  const { field, value, rawText } = obs;
  const supported = hasImageEvidence(value, rawText);
  const parsed = parseMeasurement(value);
  const safety = isSafetyCritical(field);

  const base: NameplateFact = {
    field,
    value: value ?? null,
    normalizedValue: parsed.value,
    unit: parsed.unit,
    source: supported ? "image" : "image_inferred",
    rawText: supported ? (value ?? null) : null,
    confidence: obs.confidence ?? null,
    status: "observed",
    corroboration: [],
    conflicts: [],
    safetyCritical: safety,
  };

  if (value === null || value === "") {
    return { ...base, status: "candidate", reason: "not read from the plate" };
  }

  if (isComplianceMark(value)) {
    if (!supported) {
      return {
        ...base,
        status: "rejected",
        source: "image_inferred",
        reason:
          "a certification mark was asserted but no text on the photo supports it — refusing to record it as observed",
      };
    }
    // Supported by rawText is NOT sufficient here, and this is the subtle part.
    // `rawText` is the recognizer's OWN account of what it read, so a model that
    // hallucinates a mark also lists it among the lines it "saw" — the claim
    // corroborates itself. That is exactly what happened on the real Oriental
    // Motor photo: `RoHS` appeared in rawText and is nowhere on the plate.
    // A certification is a compliance statement about the equipment, so it
    // needs a source that is not the same model's self-report: a second
    // independent pass, an OEM document, or a technician.
    return {
      ...base,
      status: "candidate",
      reason:
        "certification marks are not accepted from a single vision pass — the recognizer's own text list cannot corroborate its own claim; needs an independent pass, the OEM document, or a technician",
    };
  }

  if (!supported) {
    return {
      ...base,
      status: "candidate",
      reason: "the recognizer asserted this but no observed text on the photo supports it",
    };
  }

  if (safety) {
    return {
      ...base,
      status: "candidate",
      reason:
        "safety-relevant value read from a photo — needs an independent source or technician confirmation before it is trusted",
    };
  }

  return base;
}

// ── Corroboration + conflict ─────────────────────────────────────────────────

/**
 * Compare a fact against an independent source. Agreement corroborates;
 * disagreement creates a CONFLICT — we never silently prefer one side, because
 * choosing quietly is how `12A` would end up in the asset record.
 *
 * Numeric fields compare by magnitude+unit; everything else compares by
 * normalized text.
 */
export function corroborate(
  fact: NameplateFact,
  other: { source: FactSource; value: string; detail?: string },
): NameplateFact {
  if (!fact.value) {
    // Nothing was read — an external source SUPPLIES the value rather than
    // corroborating one, and it is attributed to that source, not the image.
    const parsed = parseMeasurement(other.value);
    return {
      ...fact,
      value: other.value,
      normalizedValue: parsed.value,
      unit: parsed.unit,
      source: other.source,
      status: other.source === "technician" ? "technician_confirmed" : "corroborated",
      corroboration: [...fact.corroboration, other],
      reason:
        other.source === "oem_document"
          ? "supplied by the applicable OEM document; not legible on the photo"
          : undefined,
    };
  }

  const agrees =
    fact.normalizedValue !== null
      ? measurementsAgree(fact.value, other.value)
      : normalizeForEvidence(fact.value) === normalizeForEvidence(other.value);

  if (agrees) {
    return {
      ...fact,
      status: other.source === "technician" ? "technician_confirmed" : "corroborated",
      corroboration: [...fact.corroboration, other],
      reason: undefined,
    };
  }

  return {
    ...fact,
    status: "conflicting",
    conflicts: [...fact.conflicts, other],
    reason: `the photo reads ${fact.value} but ${
      other.source === "oem_document" ? "the OEM document" : "another source"
    } says ${other.value} — a human must decide`,
  };
}

/** A technician's explicit decision. Always wins, and is always recorded. */
export function confirmByTechnician(
  fact: NameplateFact,
  value: string,
  technician?: string,
): NameplateFact {
  const parsed = parseMeasurement(value);
  return {
    ...fact,
    value,
    normalizedValue: parsed.value,
    unit: parsed.unit,
    source: "technician",
    status: "technician_confirmed",
    corroboration: [
      ...fact.corroboration,
      { source: "technician", value, detail: technician },
    ],
    reason: undefined,
  };
}

// ── Promotion gate ───────────────────────────────────────────────────────────

/**
 * May this fact be written into canonical asset knowledge?
 *
 * Safety-critical values need a technician decision or an independent
 * corroborating source. Identity may pass on plain observation. Anything
 * conflicting, rejected, or merely candidate is refused with a reason the UI
 * can show verbatim.
 */
export function canPromote(fact: NameplateFact): { ok: boolean; reason?: string } {
  if (fact.status === "rejected") {
    return { ok: false, reason: fact.reason ?? "rejected" };
  }
  if (fact.status === "conflicting") {
    return { ok: false, reason: fact.reason ?? "sources disagree — needs a decision" };
  }
  if (fact.status === "technician_confirmed") return { ok: true };

  // A compliance mark needs a source other than the vision pass that claimed
  // it — see the self-corroboration note in toFact().
  if (fact.value && isComplianceMark(fact.value)) {
    const independent = fact.corroboration.some(
      (c) => c.source === "oem_document" || c.source === "technician",
    );
    if (!independent) {
      return {
        ok: false,
        reason:
          "certification mark needs independent corroboration — a single vision pass cannot establish a compliance claim",
      };
    }
    return { ok: true };
  }

  if (fact.safetyCritical) {
    const independent = fact.corroboration.some(
      (c) => c.source === "oem_document" || c.source === "technician",
    );
    if (!independent) {
      return {
        ok: false,
        reason:
          "safety-relevant value has only the photo behind it — confirm it or corroborate it first",
      };
    }
    return { ok: true };
  }

  if (fact.status === "candidate") {
    return { ok: false, reason: fact.reason ?? "unsupported candidate" };
  }
  return { ok: true };
}

/** Split a fact set into what a technician must actually look at. */
export interface ReviewSummary {
  total: number;
  autoCorroborated: NameplateFact[];
  needsReview: NameplateFact[];
  rejected: NameplateFact[];
  promotable: NameplateFact[];
}

export function summarizeForReview(facts: NameplateFact[]): ReviewSummary {
  const rejected = facts.filter((f) => f.status === "rejected");
  const autoCorroborated = facts.filter(
    (f) => f.status === "corroborated" || f.status === "technician_confirmed",
  );
  const needsReview = facts.filter(
    (f) =>
      f.status === "conflicting" ||
      (f.status === "candidate" && f.value !== null) ||
      (f.safetyCritical && !canPromote(f).ok && f.status !== "rejected"),
  );
  // De-dupe: a safety-critical candidate matches two predicates above.
  const seen = new Set<string>();
  const uniqueReview = needsReview.filter((f) =>
    seen.has(f.field) ? false : (seen.add(f.field), true),
  );
  return {
    total: facts.length,
    autoCorroborated,
    needsReview: uniqueReview,
    rejected,
    promotable: facts.filter((f) => canPromote(f).ok),
  };
}
