/**
 * What a component revision may contain, read from an untrusted request body.
 *
 * Rules (Mike 2026-11-14):
 *  - the label is kept exactly as written (raw_label), never normalized;
 *  - each identity field is its own value; a field the technician marked
 *    "Not sure" is stored empty and listed in `unresolved`, never filled in;
 *  - a catalog number keeps every letter, digit and suffix as typed. Only the
 *    dash characters a phone keyboard substitutes for "-" (and spaces around a
 *    dash) are written as a plain "-": O and 0, I and 1 stay what was typed.
 */
import type { ComponentIdentityStatus, ComponentInputKind, ComponentRevision } from "./selection";

export const IDENTITY_FIELDS = ["manufacturer", "family", "catalogNumber", "serialNumber", "hardwareRevision", "localTag"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export type ComponentRevisionInput = {
  rawLabel: string | null;
  inputKind: ComponentInputKind;
  manufacturer: string | null;
  family: string | null;
  catalogNumber: string | null;
  serialNumber: string | null;
  hardwareRevision: string | null;
  localTag: string | null;
  identityStatus: ComponentIdentityStatus;
  unresolved: IdentityField[];
  evidenceFileId: string | null;
  evidenceNote: string | null;
};

const LIMITS: Record<IdentityField, number> = {
  manufacturer: 120,
  family: 120,
  catalogNumber: 120,
  serialNumber: 120,
  hardwareRevision: 60,
  localTag: 60,
};
const INPUT_KINDS: readonly ComponentInputKind[] = ["typed", "photo", "schedule", "inventory"];
const STATUSES: readonly ComponentIdentityStatus[] = ["unknown", "candidate", "user_confirmed"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Hyphen, non-breaking hyphen, figure dash, en dash, em dash, horizontal bar, minus, small/full-width hyphen-minus.
const DASHES = /[‐‑‒–—―−﹘﹣－]/g;

/** A catalog number as stored: typed letters and digits untouched; keyboard dashes written as "-". */
export function catalogSpelling(value: string): string {
  return value.replace(DASHES, "-").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

type Invalid = { error: string };

const optionalText = (value: unknown, max: number, name: string): string | null | Invalid => {
  if (value == null) return null;
  if (typeof value !== "string") return { error: `${name}_invalid` };
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return { error: `${name}_too_long` };
  return trimmed;
};

const isInvalid = (v: unknown): v is Invalid => typeof v === "object" && v !== null && "error" in v;

/**
 * Read one revision from a request body. `confirm` is the technician's own tap on
 * Confirm: only then is the status user_confirmed. Nothing else (a schedule row,
 * a photo reading, a close match) can produce a confirmed identity.
 */
export function readRevisionInput(body: Record<string, unknown>, confirm: boolean): ComponentRevisionInput | Invalid {
  const kind = body.inputKind ?? "typed";
  if (!INPUT_KINDS.includes(kind as ComponentInputKind)) return { error: "input_kind_invalid" };
  const raw = body.rawLabel;
  if (raw != null && typeof raw !== "string") return { error: "raw_label_invalid" };
  const rawLabel = typeof raw === "string" && raw.trim() ? raw : null;
  if (rawLabel && rawLabel.length > 500) return { error: "raw_label_too_long" };
  const unresolvedIn = body.unresolved ?? [];
  if (!Array.isArray(unresolvedIn) || !unresolvedIn.every((f) => (IDENTITY_FIELDS as readonly string[]).includes(String(f)))) {
    return { error: "unresolved_invalid" };
  }
  const unresolved = [...new Set(unresolvedIn.map(String))] as IdentityField[];
  const fields = {} as Record<IdentityField, string | null>;
  for (const field of IDENTITY_FIELDS) {
    const read = optionalText(body[field], LIMITS[field], field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
    if (isInvalid(read)) return read;
    // "Not sure" wins over a value sent beside it: an unresolved field is stored empty.
    fields[field] = unresolved.includes(field) ? null : read;
  }
  if (fields.catalogNumber) fields.catalogNumber = catalogSpelling(fields.catalogNumber);
  const requested = body.identityStatus ?? (confirm ? "user_confirmed" : "candidate");
  if (!STATUSES.includes(requested as ComponentIdentityStatus)) return { error: "identity_status_invalid" };
  if (requested === "user_confirmed" && !confirm) return { error: "confirmation_required" };
  const hasAny = IDENTITY_FIELDS.some((f) => fields[f]);
  const identityStatus: ComponentIdentityStatus = confirm ? "user_confirmed" : hasAny ? (requested as ComponentIdentityStatus) : "unknown";
  // No screen attaches a photo yet. The column's foreign key is checked across
  // tenants, so a caller-supplied id would say whether another tenant's upload
  // exists; it is refused until the photo path proves the file is this tenant's.
  if (body.evidenceFileId != null) return { error: "evidence_file_id_unsupported" };
  const evidenceFileId = null;
  const note = optionalText(body.evidenceNote, 1000, "evidence_note");
  if (isInvalid(note)) return note;
  return { rawLabel, inputKind: kind as ComponentInputKind, ...fields, identityStatus, unresolved, evidenceFileId, evidenceNote: note };
}

/** Same identity: every identity field, the "not sure" list and the status match. */
export function sameIdentity(a: Pick<ComponentRevision, IdentityField | "identityStatus" | "unresolved">, b: Pick<ComponentRevisionInput, IdentityField | "identityStatus" | "unresolved">): boolean {
  return (
    IDENTITY_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null)) &&
    a.identityStatus === b.identityStatus &&
    [...a.unresolved].sort().join("|") === [...b.unresolved].sort().join("|")
  );
}

/**
 * Same saved content: the same identity, and the same label text and evidence note.
 * A correction to the label alone is a new revision, never "unchanged" (it would be
 * lost), and a reused request id with a different label is a conflict.
 */
export function sameContent(
  a: Pick<ComponentRevision, IdentityField | "identityStatus" | "unresolved" | "rawLabel"> & { evidenceNote: string | null },
  b: Pick<ComponentRevisionInput, IdentityField | "identityStatus" | "unresolved" | "rawLabel" | "evidenceNote">,
): boolean {
  return sameIdentity(a, b) && (a.rawLabel ?? null) === (b.rawLabel ?? null) && (a.evidenceNote ?? null) === (b.evidenceNote ?? null);
}

/** The identity fields that differ between two revisions (what a correction changed). */
export function changedFields(a: Pick<ComponentRevision, IdentityField>, b: Pick<ComponentRevision, IdentityField>): IdentityField[] {
  return IDENTITY_FIELDS.filter((f) => (a[f] ?? null) !== (b[f] ?? null));
}
