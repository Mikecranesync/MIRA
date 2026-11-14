/**
 * Seed a project's checklist from a provisional bench inventory (Mike 2026-11-14:
 * "The old device schedule is the starting checklist").
 *
 * Every seeded row is saved UNCONFIRMED, with nothing filled in that a technician
 * did not read off the part: no label text, no manufacturer, no catalog number,
 * no serial. What the schedule or an earlier photo said goes in the evidence note,
 * shown on the checklist as evidence, never as an identity. The technician reads
 * the label and confirms it on the card.
 *
 * A seed is retried by running it again: each row's request id is derived from
 * the project and the row's key, so a second run finds every row already there
 * ("existing") instead of adding a copy.
 */
import { createHash } from "node:crypto";
import type { AddComponentResult, ComponentOrigin } from "./store";
import type { ComponentRevisionInput } from "./validate";

export type InventoryRow = {
  /** Stable key for the row within the inventory (the schedule tag when there is one). */
  key: string;
  /** The tag on the schedule, or null when the part has none. Never invented. */
  localTag: string | null;
  kind: string;
  origin: Extract<ComponentOrigin, "device_schedule" | "inventory">;
  /** Where this row came from and what it said. Evidence, not identity. */
  note: string;
};

export const SEED_USER = "seed:provisional-inventory";

/** A UUID (version 8 layout) fixed by the project and the row key. */
export function seedRequestId(notebookId: string, key: string): string {
  const h = createHash("sha256").update(`bench-component-seed\u0000${notebookId}\u0000${key}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type SeedInput = {
  key: string;
  clientRequestId: string;
  kind: string;
  origin: InventoryRow["origin"];
  position: number;
  revision: ComponentRevisionInput;
};

export function seedInputs(notebookId: string, rows: readonly InventoryRow[]): SeedInput[] {
  return rows.map((row, position) => ({
    key: row.key,
    clientRequestId: seedRequestId(notebookId, row.key),
    kind: row.kind,
    origin: row.origin,
    position,
    revision: {
      rawLabel: null,
      inputKind: row.origin === "device_schedule" ? "schedule" : "inventory",
      manufacturer: null,
      family: null,
      catalogNumber: null,
      serialNumber: null,
      hardwareRevision: null,
      localTag: row.localTag,
      identityStatus: "unknown",
      unresolved: [],
      evidenceFileId: null,
      evidenceNote: row.note.slice(0, 1000),
    },
  }));
}

export type SeedOutcome = { key: string; status: AddComponentResult["status"] };

/** Write the rows, in order. Stops at the first refusal so a wrong project is not half-seeded. */
export async function runSeed(
  add: (input: SeedInput) => Promise<AddComponentResult>,
  inputs: readonly SeedInput[],
): Promise<SeedOutcome[]> {
  const out: SeedOutcome[] = [];
  for (const input of inputs) {
    const r = await add(input);
    out.push({ key: input.key, status: r.status });
    if (r.status === "notebook_not_found" || r.status === "request_id_conflict") break;
  }
  return out;
}
