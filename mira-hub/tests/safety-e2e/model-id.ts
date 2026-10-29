/**
 * Model-id canonicalizer and generator-pin check for the e2e safety harness
 * (#4372). Same rules as tools/safety_e2e/model_id.py; both are pinned by
 * tools/safety_e2e/model_id_cases.json (model-id.test.ts here, and
 * tests/test_safety_e2e_model_id.py on the Python side).
 */

const DATED = /-\d{4}-\d{2}-\d{2}$/;

/** Lowercase, trim, strip a provider prefix (up to the last '/'), strip ':latest'. */
export function canonicalModelId(model: string): string {
  let m = (model ?? "").trim().toLowerCase();
  m = m.slice(m.lastIndexOf("/") + 1);
  if (m.endsWith(":latest")) m = m.slice(0, -":latest".length);
  return m;
}

/** The canonical id minus any ':tag' and any trailing dated-snapshot suffix. */
export function modelFamily(model: string): string {
  return canonicalModelId(model).split(":")[0].replace(DATED, "");
}

/** Pin-config entries that are not a dated snapshot OF the pin (refused at start). */
export function invalidSnapshots(pin: string, snapshots: string[]): string[] {
  const p = canonicalModelId(pin);
  return snapshots.filter((s) => {
    const c = canonicalModelId(s);
    return !(c.startsWith(p + "-") && DATED.test(c) && c.replace(DATED, "") === p);
  });
}

export type PinCheck = { ok: true } | { ok: false; reason: string };

/**
 * Every provider-reported served model id must canonicalize to the pin, or to a
 * dated snapshot EXPLICITLY listed in the pin config. A served response that
 * reported no model id cannot be verified, so it fails (the caller passes the
 * sentinel UNREPORTED for it).
 */
export const UNREPORTED = "<unreported>";
export function checkServedPin(pin: string, snapshots: string[], served: string[]): PinCheck {
  const allowed = new Set([canonicalModelId(pin), ...snapshots.map(canonicalModelId)]);
  for (const s of served) {
    if (s === UNREPORTED) return { ok: false, reason: `a served response reported no model id (pinned ${pin})` };
    if (!allowed.has(canonicalModelId(s))) return { ok: false, reason: `served ${s} != pinned ${pin}` };
  }
  return { ok: true };
}
