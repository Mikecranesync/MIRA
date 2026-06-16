/**
 * Shared validation for closing/completing work orders (#897).
 *
 * A WO can move to "completed" or "closed" only when all three fields are
 * non-empty: title, fault_description, and resolution.
 *
 * fault_description falls back to the WO's description column so legacy WOs
 * created before the column existed still pass validation if description is set.
 */

export const CLOSING_STATUSES = new Set(["completed", "closed"]);

export interface WOFields {
  title?: string | null;
  description?: string | null;
  fault_description?: string | null;
  resolution?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  missing_fields: string[];
}

export function validateWOCompletion(fields: WOFields): ValidationResult {
  const effectiveTitle = (fields.title ?? "").trim();
  const effectiveFault = (fields.fault_description ?? fields.description ?? "").trim();
  const effectiveResolution = (fields.resolution ?? "").trim();

  const missing: string[] = [];
  if (!effectiveTitle) missing.push("title");
  if (!effectiveFault) missing.push("fault_description");
  if (!effectiveResolution) missing.push("resolution");

  return { valid: missing.length === 0, missing_fields: missing };
}
