/**
 * Work Packet (#4982) — technician edits, pure (no I/O).
 *
 * `applyEdit` is a port of `tools/work-packet/build_packet.py::apply_edits` to this capability's
 * uniform `Field` shape (every labeled value in a `WorkPacket` is a `Field`, so an edit path always
 * resolves directly to one — there is no "which key does this node type display" problem the
 * Python port had to solve with `EDITABLE_FIELDS`).
 *
 * Semantics (contract: `./types.ts`):
 *   set          — technician supplies/corrects the value. Downgrades the field to "proposed"
 *                  (even a "verified" field — a technician-entered value is never re-labeled
 *                  verified by this function; only a cited document line earns that label).
 *   confirm      — records the review. The value is NOT changed.
 *   strike       — marks the field struck (still shown, crossed out). The value is NOT changed.
 *   mark_unknown — nulls the value and sets the label to "unknown".
 *
 * Any edit, of any action, resets `approval.supervisor` to pending (#4999: broadened from the
 * Python original, which only reset on `set`/`strike` — here EVERY edit, including a bare
 * `confirm`, invalidates a prior supervisor approval) and sets `technicianReview.state` to
 * "reviewed". An edit at a path that does not resolve to a `Field` throws.
 */

import type { EditAction, Field, PacketEdit, ReviewEntry, WorkPacket } from "./types";

const PATH_TOKEN = /([^.[\]]+)|\[(\d+)\]/g;

function tokenize(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  let m: RegExpExecArray | null;
  PATH_TOKEN.lastIndex = 0;
  while ((m = PATH_TOKEN.exec(path)) !== null) {
    out.push(m[1] !== undefined ? m[1] : Number(m[2]));
  }
  if (out.length === 0) throw new Error(`Invalid edit path: '${path}'`);
  return out;
}

function isFieldLike(v: unknown): v is Field {
  return !!v && typeof v === "object" && "value" in v && "label" in v && "basis" in v;
}

/** Walk a dotted/bracket path (e.g. "parts[2].qty", "measurements[1].value") to the Field it names. */
function resolveField(packet: WorkPacket, path: string): Field {
  const tokens = tokenize(path);
  let cur: unknown = packet;
  for (const key of tokens) {
    if (cur === null || typeof cur !== "object") {
      throw new Error(`Unknown edit path: '${path}'`);
    }
    cur = (cur as Record<string | number, unknown>)[key];
  }
  if (!isFieldLike(cur)) {
    throw new Error(`Unknown edit path: '${path}' (does not resolve to a field)`);
  }
  return cur;
}

const KNOWN_ACTIONS: readonly EditAction[] = ["set", "confirm", "strike", "mark_unknown"];

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function applyEdit(packet: WorkPacket, edit: PacketEdit, by: string, at: string): WorkPacket {
  if (!KNOWN_ACTIONS.includes(edit.action)) {
    throw new Error(`Unknown edit action: '${edit.action}' at '${edit.path}'`);
  }
  const next = cloneDeep(packet);
  const field = resolveField(next, edit.path);
  const previous = field.value;
  let nextValue = previous;

  switch (edit.action) {
    case "set":
      nextValue = edit.value ?? null;
      field.value = nextValue;
      field.label = "proposed";
      break;
    case "confirm":
      break; // value unchanged — only the review record changes
    case "strike":
      field.struck = true;
      break;
    case "mark_unknown":
      nextValue = null;
      field.value = null;
      field.label = "unknown";
      break;
  }

  const entry: ReviewEntry = { path: edit.path, action: edit.action, by, at, previous, next: nextValue };
  field.review = entry;

  next.approval.technicianReview.entries = [...next.approval.technicianReview.entries, entry];
  next.approval.technicianReview.state = "reviewed";
  // #4999: ANY edit — including a bare confirm — invalidates a standing supervisor approval.
  next.approval.supervisor = { state: "pending", by: null, at: null };

  return next;
}
