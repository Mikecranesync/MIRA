/**
 * Validation for a POST body recording an observation. Mirrors the DB CHECKs
 * in db/proposed/113_asset_observations.sql so a rejected body never reaches
 * Postgres. The body must be complete except for the field under test; the
 * order below is the order a client sees errors in.
 */
import { FACT_KEYS, FACT_VALUES, type FactKey, type FactValue } from "./parse";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW_REPORT_MAX = 1000;
/** Clock skew tolerated between the technician's device and the server. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

export type ValidatedObservationInput = {
  factKey: FactKey;
  factValue: FactValue;
  observedAt: string;
  rawReport: string;
  clientRequestId: string;
  sourceTurnId: string | null;
  supersedesId: string | null;
  verificationMethod: "self_reported";
};

export type ValidateObservationResult =
  | { ok: true; value: ValidatedObservationInput }
  | { ok: false; error: string };

function uuidOrNull(raw: unknown): string | null | undefined {
  // undefined = invalid, null = absent, string = valid lowercase UUID
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) return undefined;
  return raw.toLowerCase();
}

export function validateObservationInput(body: unknown, opts: { now: Date }): ValidateObservationResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;

  if (b.confirmed !== true) return { ok: false, error: "confirmation_required" };

  if (typeof b.factKey !== "string" || !(FACT_KEYS as readonly string[]).includes(b.factKey)) {
    return { ok: false, error: "invalid_fact_key" };
  }
  if (typeof b.factValue !== "string" || !(FACT_VALUES as readonly string[]).includes(b.factValue)) {
    return { ok: false, error: "invalid_fact_value" };
  }

  if (typeof b.observedAt !== "string") return { ok: false, error: "observed_at_required" };
  const observed = new Date(b.observedAt);
  if (Number.isNaN(observed.getTime())) return { ok: false, error: "invalid_observed_at" };
  if (observed.getTime() > opts.now.getTime() + FUTURE_SKEW_MS) {
    return { ok: false, error: "observed_at_in_future" };
  }

  if (typeof b.rawReport !== "string") return { ok: false, error: "raw_report_required" };
  const rawReport = b.rawReport.trim();
  if (!rawReport) return { ok: false, error: "raw_report_required" };
  if (rawReport.length > RAW_REPORT_MAX) return { ok: false, error: "raw_report_too_long" };

  if (b.clientRequestId === undefined || b.clientRequestId === null) {
    return { ok: false, error: "client_request_id_required" };
  }
  const clientRequestId = uuidOrNull(b.clientRequestId);
  if (!clientRequestId) return { ok: false, error: "invalid_client_request_id" };

  const sourceTurnId = uuidOrNull(b.sourceTurnId);
  if (sourceTurnId === undefined) return { ok: false, error: "invalid_source_turn_id" };
  const supersedesId = uuidOrNull(b.supersedesId);
  if (supersedesId === undefined) return { ok: false, error: "invalid_supersedes_id" };

  // Only self-reported evidence is accepted by the API. attested / machine
  // are reserved in the schema and rejected here.
  if (b.verificationMethod !== undefined && b.verificationMethod !== "self_reported") {
    return { ok: false, error: "verification_method_unsupported" };
  }

  return {
    ok: true,
    value: {
      factKey: b.factKey as FactKey,
      factValue: b.factValue as FactValue,
      observedAt: observed.toISOString(),
      rawReport,
      clientRequestId,
      sourceTurnId,
      supersedesId,
      verificationMethod: "self_reported",
    },
  };
}
