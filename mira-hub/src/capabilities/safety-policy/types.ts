/**
 * Safety policy — Phase 1 (#4372, design doc §4.1–§4.2, §6): typed hazard-critical numbers and
 * the L3 evidence verifier. Pure and deterministic: no I/O, no model call, no route wiring.
 *
 * A hazard-critical number reaches the technician only when an APPLICABLE source for the bound
 * asset states the same value in the sentence the answer cites (NUM-1); when the sources state
 * several values, only the most conservative one, or one carrying the source's own condition,
 * passes (NUM-2); anything that cannot be classified fails closed (SYS-2).
 *
 * Owner decision 4 (2026-10-29): no generic discharge wait. An applicable source is a retrieved
 * manual passage or photo observation for the bound asset — never `vendor_fallback`, never the
 * technician's own message.
 */

/** Hazard-critical quantities the extractor recognises. */
export const QUANTITIES = [
  "discharge_time",
  "residual_voltage",
  "approach_boundary",
  "incident_energy",
  "torque",
  "pressure",
] as const;
export type Quantity = (typeof QUANTITIES)[number];

/**
 * Quantities the Phase 1 verdict enforces: the DC-bus slice (the discharge wait and the meter
 * threshold that must follow it) plus, since round 2, the approach boundary, the incident energy
 * and pressure. Torque stays deferred: extracted and verified, reported, never decides the turn.
 */
export const ENFORCED_QUANTITIES: readonly Quantity[] = [
  "discharge_time",
  "residual_voltage",
  "approach_boundary",
  "incident_energy",
  "pressure",
];

/** Canonical units, one per dimension; every value is stored converted to these. */
export const UNITS = ["s", "V", "mm", "cal/cm2", "N*m", "kPa"] as const;
export type Unit = (typeof UNITS)[number];

export const QUANTITY_UNIT: Record<Quantity, Unit> = {
  discharge_time: "s",
  residual_voltage: "V",
  approach_boundary: "mm",
  incident_energy: "cal/cm2",
  torque: "N*m",
  pressure: "kPa",
};

/** How the answer relates to the value (#4964): exactly ("reads 0 V"), below, at most, at least, above.
 *  Only an exact-zero measurement claim may skip the source (D2). */
export const COMPARATORS = ["eq", "lt", "le", "ge", "gt"] as const;
export type Comparator = (typeof COMPARATORS)[number];

/** A rating condition a source attaches to a value ("≤ 30hp models"). */
export interface Condition {
  op: "le" | "ge" | "eq";
  value: number;
  unit: "hp" | "kW";
}

/**
 * One typed number (§4.1 `numbers[]`). `value` is in the quantity's canonical unit.
 * `sourceChunkId` is the id of the evidence chunk the answer cites for it, or null when uncited.
 */
export interface TypedNumber {
  quantity: Quantity;
  value: number;
  unit: Unit;
  sourceChunkId: string | null;
  condition?: Condition;
  /** The comparator the answer states for the value, when it states one (#4964). */
  comparator?: Comparator;
}

/** Where an evidence chunk came from. `technician` is the technician's own text: never support. */
export type EvidenceOrigin = "manual" | "photo" | "technician";

/**
 * A retrieved passage with its provenance (lib/manual-rag.ts `ManualChunk` plus an id).
 * Route adapter contract: `id` is the citation id of the numbered block (`[n]` → `c<n>`).
 */
export interface EvidenceChunk {
  id: string;
  origin: EvidenceOrigin;
  content: string;
  docId?: string | null;
  manufacturer?: string;
  modelNumber?: string;
  sourcePage?: number | null;
  pageLabel?: string | null;
  retrievalScope?: "vendor_fallback";
  verified?: boolean;
}

/** The asset the conversation is bound to. `docIds` are documents approved for this asset. */
export interface BoundAsset {
  manufacturer: string;
  modelNumber: string;
  modelAliases?: string[];
  docIds?: string[];
  /** The asset's rating when known (nameplate): resolves a source's rating conditions (NUM-2). */
  rating?: { value: number; unit: "hp" | "kW" };
}

/** Closed vocabulary of per-number verdicts (telemetry-safe: codes, never text). */
export const NUMBER_VERDICTS = [
  "pass",
  "pass_conditioned",
  "pass_most_conservative",
  /** "confirm 0 V": verifying absence of voltage needs no source and is never unsafe. */
  "pass_absence_of_voltage",
  /** D2 (round 3): an exact-zero pressure claim ("the gauge reads 0 psi"); only comparator "eq". */
  "pass_absence_of_pressure",
  "block:schema",
  "block:unparsed",
  "block:no_source",
  "block:unknown_chunk",
  "block:technician_number",
  "block:vendor_fallback",
  "block:not_bound_asset",
  "block:unverified_source",
  "block:no_page",
  "block:not_in_cited_sentence",
  "block:not_most_conservative",
  /** The source states the value only for a rating (≤ 30 hp); the answer dropped it. */
  "block:condition_dropped",
  /** Sources state several values for a quantity with no safe direction (pressure, torque) and
   *  the answer does not carry the source's condition: no value can be chosen. */
  "block:no_safe_direction",
] as const;
export type NumberVerdict = (typeof NUMBER_VERDICTS)[number];

export interface NumberCheck {
  number: TypedNumber | null;
  verdict: NumberVerdict;
  enforced: boolean;
}

/** Turn-level verdict over ENFORCED quantities: `no_numbers` = none present, `block` = one failed. */
export type TurnVerdict = "no_numbers" | "pass" | "block";

export interface VerifyResult {
  verdict: TurnVerdict;
  checks: NumberCheck[];
}
