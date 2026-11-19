/**
 * The repeated-serial warning. When a technician confirms a component whose serial number is usable,
 * the same tenant's other components whose current revision carries that serial are listed so the
 * screen can say "this serial is already on another component". A warning only: it never blocks a
 * save, never merges records, and never returns or logs the serial itself.
 *
 * "Same serial" is decided by the contextualization matcher (where the folding rules and the
 * placeholder list live). One rule is added here, on the serial alone: see FILLER_SERIAL. The SQL
 * below is only a prefilter that keeps the read small.
 */
import { classifyAsset } from "@/lib/contextualization/asset-matcher";
import { withTenantContext } from "@/lib/tenant-context";
import { componentReadProjection, type ComponentRecord } from "./store";
import { componentLabel } from "./view";

export const SAME_SERIAL_LIMIT = 10;
export const SAME_SERIAL_DEADLINE_MS = 2000;

export type SameSerialCandidate = {
  componentId: string;
  notebookId: string;
  notebookName: string;
  label: string;
  retired: boolean;
};

export type SameSerialAdvisory =
  | { status: "checked"; candidates: SameSerialCandidate[]; truncated: boolean }
  | { status: "not_checked"; reason: "not_confirmed" | "no_usable_serial" | "lookup_failed" };

/** What the route answers when the lookup itself cannot be trusted. */
export const SAME_SERIAL_LOOKUP_FAILED: SameSerialAdvisory = Object.freeze({ status: "not_checked", reason: "lookup_failed" });

/**
 * The one read. Both sides are folded by the database's own lower(), so the serial travels as a bound
 * parameter and never appears in the text. Only each other component's latest revision counts: a
 * serial that was corrected away, or cleared, must not warn. Tenant isolation is two layers: the
 * caller runs this through withTenantContext (RLS) and the predicate on c.tenant_id is explicit.
 *
 * Known and accepted: a serial with a character that JavaScript lower-cases to ASCII but PostgreSQL
 * does not (Kelvin sign U+212A, dotted capital I U+0130) can be missed by this prefilter. That is a
 * missed warning, never a wrong one.
 */
export const SAME_SERIAL_SQL = `SELECT ${componentReadProjection.columns}, n.display_name AS notebook_name
  FROM notebook_components c
  JOIN equipment_notebooks n ON n.tenant_id = c.tenant_id AND n.id = c.notebook_id
  ${componentReadProjection.latestJoin}
 WHERE c.tenant_id = $1::uuid
   AND c.id <> $2::uuid
   AND regexp_replace(lower(r.serial_number), '[^a-z0-9]+', '', 'g')
     = regexp_replace(lower($3::text),         '[^a-z0-9]+', '', 'g')
 ORDER BY c.created_at DESC, c.id
 LIMIT $4`;

/**
 * A serial that is nothing but zeros, or three or more x's, is a placeholder at any length (#5661 B1).
 * The matcher's own list stops at five of each, so "000000" reached it as a real serial number. The
 * rule is kept here and not in the matcher: there it would also apply to asset numbers and paths, where
 * treating a value as absent removes a disagreement that keeps two assets apart (#5663 review F1).
 */
const FILLER_SERIAL = /^(?:0+|x{3,})$/;

/** Folded as the matcher folds a value before comparing it: lower case, letters and digits only. */
function fillerSerial(serial: string): boolean {
  return FILLER_SERIAL.test(serial.toLowerCase().replace(/[^a-z0-9]+/g, ""));
}

/** Two serials are the same when neither is filler and the matcher calls them a strong match. */
function sameSerial(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  if (fillerSerial(a) || fillerSerial(b)) return false;
  return classifyAsset({ serialNumber: a }, [{ id: "other", serialNumber: b }]).strength === "strong";
}

/** True when this serial can identify a unit: not filler, and identity-bearing to the matcher. */
export function usableSerial(serial: string | null | undefined): boolean {
  return sameSerial(serial, serial);
}

/**
 * The only thing taken from an error for the log: its code, and only when it has the five-character
 * SQLSTATE shape. A code the matcher would call the saved serial is dropped too, so the log line
 * cannot carry the serial whatever was thrown.
 */
function sqlstateOf(err: unknown, serial: string | null): string | null {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (typeof code !== "string" || !/^[0-9A-Z]{5}$/.test(code)) return null;
  return sameSerial(code, serial) ? null : code;
}

/**
 * The advisory for a component as it now stands. Never throws. The save has already committed when
 * this runs, so one overall deadline caps how long the response can be held.
 */
export async function sameSerialAdvisory(
  tenantId: string,
  component: Pick<ComponentRecord, "id" | "current">,
): Promise<SameSerialAdvisory> {
  let deadline = false;
  let serial: string | null = null;
  try {
    const current = component.current;
    if (!current || current.identityStatus !== "user_confirmed") return { status: "not_checked", reason: "not_confirmed" };
    serial = current.serialNumber;
    if (!usableSerial(serial)) return { status: "not_checked", reason: "no_usable_serial" };

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rows: Record<string, unknown>[];
    try {
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          deadline = true;
          controller.abort();
          reject(new Error("same-serial lookup deadline"));
        }, SAME_SERIAL_DEADLINE_MS);
      });
      const lookup = withTenantContext(
        tenantId,
        async (client) => {
          const res = await client.query(SAME_SERIAL_SQL, [tenantId, component.id, serial, SAME_SERIAL_LIMIT + 1]);
          return res.rows as Record<string, unknown>[];
        },
        { readOnly: true, signal: controller.signal },
      );
      // The race is what caps the wait: after an abort the lookup itself can take seconds more to
      // settle. Promise.race subscribes to both, so the loser's late rejection is still handled.
      rows = await Promise.race([lookup, expired]);
    } finally {
      clearTimeout(timer);
    }

    const kept: SameSerialCandidate[] = [];
    for (const row of rows) {
      const record = componentReadProjection.decode(row);
      if (!sameSerial(serial, record.current?.serialNumber ?? null)) continue;
      kept.push({
        componentId: record.id,
        notebookId: record.notebookId,
        notebookName: String(row.notebook_name),
        label: componentLabel(record, record.current),
        retired: record.retiredAt !== null,
      });
    }
    return { status: "checked", candidates: kept.slice(0, SAME_SERIAL_LIMIT), truncated: rows.length > SAME_SERIAL_LIMIT };
  } catch (err) {
    try {
      console.error("[bench-components] same-serial lookup failed", { componentId: component?.id, sqlstate: sqlstateOf(err, serial), deadline });
    } catch {
      // Logging must never be the thing that throws.
    }
    return SAME_SERIAL_LOOKUP_FAILED;
  }
}
