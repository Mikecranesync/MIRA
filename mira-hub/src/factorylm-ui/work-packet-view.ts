/**
 * Work Packet phone panel (#4982 section E) — pure helpers.
 *
 * No I/O, no React, no fetch: everything here is a plain function that takes data in and returns
 * a value, so it is tested without a browser or a server. `WorkPacketPanel.tsx` wires these to
 * fetch, component state, and rendering; it never duplicates the logic that lives here.
 */
import type { Label, PacketDocument, SourceRef, WorkOrderInput, WorkPacket, WorkPacketAvailability } from "@/capabilities/work-packet/types";

// ───────────────────────────────────────────── label → badge text

const BADGE_TEXT: Record<Label, string> = {
  verified: "Verified",
  proposed: "Proposed",
  unknown: "Unknown",
};

/** The three-state badge text shown on every field ("verified" / "proposed" / "unknown"). */
export function badgeText(label: Label): string {
  return BADGE_TEXT[label];
}

// ───────────────────────────────────────── field → dotted edit path (PacketEdit.path grammar)
//
// Mirrors the grammar documented on `PacketEdit.path` in types.ts — e.g. "parts[2].qty",
// "tools[0]", "steps[3].text", "measurements[1].value" — so every call site builds the SAME path
// shape `applyEdit`/`verifyPacket` (agent C) expect, rather than hand-formatting a string per field.

export function equipmentFieldPath(field: "manufacturer" | "model" | "serial"): string {
  return `equipment.${field}`;
}

export function scopeFieldPath(index: number): string {
  return `scope[${index}]`;
}

export function cautionFieldPath(index: number): string {
  return `safety.cautions[${index}]`;
}

/** Site isolation is a single Field (not an array) and is always "unknown" by contract —
 *  the panel shows it, but never offers edit controls on it (types.ts: "this tool never writes it"). */
export const SITE_ISOLATION_PATH = "safety.siteIsolation";

export function partFieldPath(index: number, field: "partNumber" | "description" | "qty"): string {
  return `parts[${index}].${field}`;
}

export function toolFieldPath(index: number): string {
  return `tools[${index}]`;
}

export function stepFieldPath(index: number): string {
  return `steps[${index}].text`;
}

export function measurementFieldPath(index: number, field: "name" | "value" | "tool"): string {
  return `measurements[${index}].${field}`;
}

export function unknownFieldPath(index: number): string {
  return `unknowns[${index}]`;
}

// ───────────────────────────────────────────── source chip ("p.N filename")

/** The chip label a field's citation renders as, e.g. "p.6 35FR2Svc.pdf". Null when the field has
 *  no source (an unknown field, or one struck with nothing to cite). */
export function sourceChipLabel(source: SourceRef | null): string | null {
  if (!source) return null;
  return `p.${source.page} ${source.filename ?? "document"}`;
}

// ───────────────────────────────── nameplate recognition confidence, as a percentage

/** `0.0–1.0` (or absent) → the percentage string the Equipment step shows next to a recognized
 *  nameplate candidate. Out-of-range values are clamped; a missing/non-finite confidence reports
 *  honestly rather than claiming a number the provider never gave. */
export function confidencePercent(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) {
    return "confidence not reported";
  }
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

// ───────────────────────────────────────────── synthetic demo work order

/**
 * Fills a clearly SYNTHETIC CAT Pumps 3520 reseal order (task §E step 3) so a technician can try
 * the whole flow without a real work order. `id` is supplied by the caller (e.g.
 * `crypto.randomUUID()`) so this stays pure and deterministic under test — it never mints its own
 * id or timestamp.
 */
export function syntheticDemoWorkOrder(id: string): WorkOrderInput {
  return {
    id,
    title: "SYNTHETIC — 3520 reseal",
    description:
      "SYNTHETIC demo work order (not a real job). The CAT Pumps 3520 is leaking at the shaft — " +
      "reseal the pump per the manufacturer's service procedure.",
    assetTag: "DEMO-3520",
    site: "Demo site",
    synthetic: true,
  };
}

// ───────────────────────────────────────────── print title (Export PDF / window.print())

/**
 * The title the browser's print dialog / Save-as-PDF shows — and the first thing a reader sees if
 * they only glance at the exported file name. Always carries the work order's SYNTHETIC marker so
 * an exported demo packet can never be mistaken for a real job.
 */
export function printTitle(packet: Pick<WorkPacket, "workOrder" | "equipment">): string {
  const mfr = packet.equipment.manufacturer.value ?? "Unknown manufacturer";
  const model = packet.equipment.model.value ?? "unknown model";
  const synthetic = packet.workOrder.synthetic ? " — SYNTHETIC" : "";
  return `DRAFT Work Packet — ${mfr} ${model} — WO ${packet.workOrder.id}${synthetic}`;
}

/** The revisions the technician just confirmed, exactly as shown on screen. Nothing is sent until
 *  the confirm box is ticked — the route then refuses `revision_not_confirmed`. `revision?.` tolerates
 *  an availability payload from before revisions existed (the route still refuses it). */
export function confirmedRevisionsPayload(
  confirmed: boolean,
  docs: Pick<PacketDocument, "docId" | "revision">[],
): { docId: string; revision: string | null }[] {
  if (!confirmed) return [];
  return docs.map((d) => ({ docId: d.docId, revision: d.revision?.value ?? null }));
}

// ───────────────────────────────────────────── notebook ownership + document snapshot (Codex #5062 F4/F5)

/** A saved or freshly built packet is shown only under the notebook it was built for — never
 *  under another machine's identity (a late response, or a stale draft under the wrong key). */
export function packetForNotebook(packet: WorkPacket | null, notebookId: string): WorkPacket | null {
  return packet && packet.notebookId === notebookId ? packet : null;
}

/** Which documents (and which revisions) the technician is confirming. When this changes, the
 *  earlier "revisions match my paper copy" tick no longer applies and is cleared. */
export function documentsSignature(docs: Pick<PacketDocument, "docId" | "revision">[]): string {
  return docs.map((d) => `${d.docId}@${d.revision?.value ?? ""}`).join("|");
}

/** The "matches my paper copy" tick holds only for the exact document list it was given for — a
 *  newly attached manual or a changed revision voids it (Codex #5062 F5). */
export function revisionTickHolds(tickedFor: string | null, currentSignature: string): boolean {
  return tickedFor !== null && tickedFor === currentSignature;
}

/** Why a saved packet no longer matches the notebook it is shown under, or null when it still does
 *  (Codex #5062 F13). A packet restored from this device was built from the documents and identity
 *  of that moment; if a manual was replaced, removed or re-revised since, or the machine was
 *  re-identified, the old packet is not exported as current. Edits are kept on screen. */
export function packetStaleReason(
  packet: Pick<WorkPacket, "documents" | "identitySnapshot">,
  avail: Pick<WorkPacketAvailability, "identity" | "documents">,
): string | null {
  const sig = (docs: Pick<PacketDocument, "docId" | "revision">[]) =>
    documentsSignature([...docs].sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0)));
  if (sig(packet.documents) !== sig(avail.documents)) {
    return "the notebook's documents or their revisions have changed since this packet was built";
  }
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const snap = packet.identitySnapshot;
  if (!snap) return "this packet was saved before it recorded the identity it was built for";
  if (norm(snap.manufacturer) !== norm(avail.identity.manufacturer)) {
    return "the machine's confirmed manufacturer has changed since this packet was built";
  }
  if (norm(snap.model) !== norm(avail.identity.model)) {
    return "the machine's confirmed model has changed since this packet was built";
  }
  // The catalog number can decide which torque rows and procedures apply (Codex #5062 F13).
  if (norm(snap.catalogNumber) !== norm(avail.identity.catalogNumber)) {
    return "the machine's confirmed catalog number has changed since this packet was built";
  }
  return null;
}

// ───────────────────────────────────────────── job header (screen + paper, Codex #5062 F6)

/** The work order and machine a packet belongs to, as label/value rows. Printed at the top of the
 *  PDF so the paper copy says which job and which pump it is without relying on browser headers. */
export function packetHeaderRows(packet: Pick<WorkPacket, "workOrder" | "equipment">): { label: string; value: string }[] {
  const wo = packet.workOrder;
  const eq = packet.equipment;
  const rows: { label: string; value: string }[] = [
    { label: "Work order", value: wo.id },
    { label: "Title", value: wo.title || "(none)" },
    { label: "Job", value: wo.description || "(none)" },
    { label: "Asset tag", value: wo.assetTag ?? "(none)" },
    { label: "Site", value: wo.site ?? "(none)" },
    { label: "Manufacturer", value: eq.manufacturer.value ?? "(unknown)" },
    { label: "Model", value: eq.model.value ?? "(unknown)" },
    { label: "Serial", value: eq.serial.value ?? "(unknown)" },
  ];
  return rows;
}
