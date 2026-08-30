/**
 * Machine-history provenance — PURE, no DB, no framework imports.
 *
 * The ONE place a replay row's 033/037 provenance columns become a
 * physical / simulated / unknown verdict (PRD §9.2). The truth set lives in
 * `tests/fixtures/machine-history-provenance.v1.json` (shared with the Python
 * preflight/observer suites); the Hub history route test consumes it.
 *
 * The contract is POSITIVE. A row is physical only when it says so three
 * times over: a recognised physical producer, `simulated === false`, AND a
 * non-empty connection id. `simulated:false` alone proves nothing (it is the
 * column default — an arbitrary or unrecognised source with the default flag
 * is UNKNOWN, never physical). A synthetic source outranks a spoofed flag.
 */

/** Producers that can only be physical ingest (033 header). */
export const PHYSICAL_SOURCE_SYSTEMS: ReadonlySet<string> = new Set(["ignition", "plc_bridge", "relay"]);

/** Producers that are synthetic by construction (033 header + SimLab). */
export const SYNTHETIC_SOURCE_SYSTEMS: ReadonlySet<string> = new Set(["simulator", "simlab", "synthetic", "demo_simulator"]);

/**
 * The CV-101 production proof is stricter than generic Replay: the exact
 * approved producer + connection pair, until Mike changes it. Generic
 * admission does NOT require this pair.
 */
export const CV101_APPROVED_PROVENANCE = Object.freeze({
  source_system: "ignition",
  source_connection_id: "cv101-bench-gw",
});

export type Provenance = "physical" | "simulated" | "unknown";

export interface ProvenanceFields {
  source_system: string | null | undefined;
  source_connection_id: string | null | undefined;
  simulated: boolean | null | undefined;
}

function normalizedSource(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return s === "" ? null : s;
}

function nonEmptyConnection(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Classify one raw row. Order (PRD §9.2):
 *   1. explicit `simulated === true`, or a synthetic source system → simulated
 *   2. recognised physical source + `simulated === false` + non-empty
 *      connection id → physical
 *   3. anything else → unknown
 */
export function classifyProvenance(row: ProvenanceFields): Provenance {
  const src = normalizedSource(row.source_system);
  if (row.simulated === true || (src != null && SYNTHETIC_SOURCE_SYSTEMS.has(src))) return "simulated";
  if (
    src != null &&
    PHYSICAL_SOURCE_SYSTEMS.has(src) &&
    row.simulated === false &&
    nonEmptyConnection(row.source_connection_id) != null
  )
    return "physical";
  return "unknown";
}

/** The strict CV-101 proof pair: physical AND exactly the approved pair. */
export function isCv101ApprovedProvenance(row: ProvenanceFields): boolean {
  return (
    classifyProvenance(row) === "physical" &&
    normalizedSource(row.source_system) === CV101_APPROVED_PROVENANCE.source_system &&
    nonEmptyConnection(row.source_connection_id) === CV101_APPROVED_PROVENANCE.source_connection_id
  );
}
