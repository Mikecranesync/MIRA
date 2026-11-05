/**
 * Drawing connection packet (#4982 follow-on) — pure `WorkPacket` builder for one connection read
 * off an engineering drawing's photos, no I/O, no model calls.
 *
 * Reuses the Work Packet V2 contract (`./types.ts`) and trust boundary (`./verify.ts`) verbatim:
 * `buildConnectionPacket` calls `verifyPacket` on the assembled packet exactly as `buildDraftPacket`
 * (`./draft.ts`) does, and downgrades (never drops) any field `verifyPacket` flags.
 *
 * Input is `DrawingSheet[]` from `./drawing.ts::mergeDrawingPhotos`, plus `docs: DocText[]` — the
 * notebook's kept source text for each photo (`renderDrawingSourceText` output, stored the way
 * `photo-source.ts::buildPhotoSourceText` stores a reviewed/unreviewed photo reading). `docs` is
 * what lets a value read off a REVIEWED photo cite an exact line and earn "verified".
 *
 * Labels (HARD RULES, task spec):
 *   - A value read from an UNREVIEWED photo → "proposed"; basis names the photo's fileId and says
 *     to check it against the photo. (It may still carry a `source` line for traceability — a
 *     citable line does not by itself make a value "verified"; only a reviewed transcription does.)
 *   - A value read from a technician-REVIEWED photo, found verbatim on a line of its kept source
 *     text → "verified" with that `SourceRef`.
 *   - A cell containing "[?]", missing, or printed two different ways across photos → "unknown",
 *     value null, plain basis sentence. Never invented.
 *   - Isolation/lockout, torque-stripe practice and tools are SITE items: unknown/proposed, never
 *     verified.
 *   - Steps are always "proposed" — a drawing has no step sequence; each step's basis says so.
 *
 * `DraftRefusal` is a closed union (`./types.ts`); rather than extend it, the two refusals this
 * builder needs reuse existing values that are semantically close enough to avoid any edit to
 * `types.ts`: no sheet carries a drawing → "no_documents"; the requested ref is on no sheet →
 * "model_not_in_documents".
 */

import type {
  DocText,
  DraftRefusal,
  DraftResult,
  Field,
  Identity,
  PacketDocument,
  PacketMeasurement,
  PacketPart,
  PacketStep,
  WorkOrderInput,
  WorkPacket,
} from "./types";
import { collectFields, verifyPacket } from "./verify";
import type {
  DrawingBomRow,
  DrawingCallout,
  DrawingConnectionBlock,
  DrawingConnectionRow,
  DrawingSheet,
  DrawingSheetPhoto,
  ReconciledCell,
} from "./drawing";
import { drawingIdKey, reconcileConnectionRows } from "./drawing";

const DISCLAIMER =
  "DRAFT prepared from an engineering drawing photographed on site. It is not an approved " +
  "procedure and not a diagnosis. A qualified person must review every line before work starts. " +
  "Your site owns isolation, lockout and torque-stripe practice.";

export interface ConnectionPacketInput {
  notebookId: string;
  packetId: string;
  now: string;
  identity: Identity;
  workOrder: WorkOrderInput;
  sheets: readonly DrawingSheet[];
  /** "C7" (the whole connection) or "C7-B1" (one of its rows) — either form drafts a packet for
   *  the whole connection's hardware. */
  connectionRef: string;
  /** Which drawing the connection is on: the document number (any punctuation; compared by its
   *  digits, the same key photos are grouped by). Required only when the connection id appears on
   *  more than one attached drawing (Codex #5204 F2). */
  drawing?: string | null;
  docs: readonly DocText[];
  /** Hazard flags the route already classified for this work order (Codex #5204 F5). */
  hazardFlags?: readonly string[];
}

/** The connection id a ref names: "C7" from either "C7" or "C7-B1". */
function connectionIdOf(ref: string): string {
  return ref.includes("-") ? ref.slice(0, ref.indexOf("-")) : ref;
}

function refuse(reason: DraftRefusal, message: string): DraftResult {
  return { ok: false, reason, message };
}

function normalizeForSearch(s: string): string {
  return s.trim().toUpperCase();
}

/** Finds `needle` as a substring of one line of `docId`'s kept source text and cites that line.
 *  Mirrors `draft.ts`'s private `firstVerbatimSource` pattern (not exported, so reimplemented here)
 *  against the canonical LINE text `renderDrawingSourceText` produces. */
function citeLine(docs: readonly DocText[], docId: string, fileId: string | null, needle: string): import("./types").SourceRef | null {
  const doc = docs.find((d) => d.docId === docId);
  if (!doc) return null;
  const n = normalizeForSearch(needle);
  if (!n) return null;
  for (const p of doc.pages) {
    for (const rawLine of p.text.split("\n")) {
      if (normalizeForSearch(rawLine).includes(n)) {
        return { docId: doc.docId, fileId: doc.fileId ?? fileId, filename: doc.filename, page: p.page, line: rawLine.trim() };
      }
    }
  }
  return null;
}

/** A value read off a photo: cited whenever a line names it (citation is independent of review
 *  status — it is just "where did this text come from"), but only a REVIEWED photo's citation
 *  earns the "verified" label (HARD RULE). An unreviewed photo's value is always "proposed", basis
 *  naming the fileId, even when a source line was found. */
function photoField(photo: DrawingSheetPhoto, docs: readonly DocText[], value: string, needle: string, basisWhenVerified: string): Field {
  const source = citeLine(docs, photo.docId, photo.fileId, needle);
  if (photo.reviewed && source) {
    return { value, label: "verified", source, basis: basisWhenVerified };
  }
  return {
    value,
    label: "proposed",
    source,
    basis: `read from photo ${photo.fileId ?? photo.docId} by a vision model; check it against the photo`,
  };
}

/** A drawing cell: "[?]" or missing → unknown/null (HARD RULE, never invented). Otherwise a
 *  `photoField`. */
function cellField(photo: DrawingSheetPhoto, docs: readonly DocText[], raw: string | null, needle: string, basisWhenVerified: string): Field {
  if (raw === null || raw.includes("[?]")) {
    return {
      value: null,
      label: "unknown",
      source: null,
      basis: raw === null ? "not in this photo" : `printed as '${raw}' on the drawing — illegible`,
    };
  }
  return photoField(photo, docs, raw, needle, basisWhenVerified);
}

/** A value composed from several drawing cells (e.g. a part description from type+spec+strength):
 *  unknown if any contributing cell is "[?]" or missing, otherwise a `photoField` of the composed
 *  value. */
function compositeCellField(
  photo: DrawingSheetPhoto,
  docs: readonly DocText[],
  parts: readonly (string | null)[],
  compose: (parts: string[]) => string,
  needle: string,
  basisWhenVerified: string,
): Field {
  if (parts.some((p) => p === null)) {
    return {
      value: null,
      label: "unknown",
      source: null,
      basis: "one of the cells that make up this value is not in this photo",
    };
  }
  if (parts.some((p) => (p as string).includes("[?]"))) {
    return {
      value: null,
      label: "unknown",
      source: null,
      basis: "one of the cells that make up this value is illegible on the drawing",
    };
  }
  return photoField(photo, docs, compose(parts as string[]), needle, basisWhenVerified);
}

/** The most distinctive token on a connection row's line, used to locate that exact line: prefer
 *  the Art. No. (unique per row in practice), else the printed pos, else the hardware type. */
function rowNeedle(row: DrawingConnectionRow): string {
  return row.artNo ?? row.pos ?? row.type ?? "";
}

function drawingRevisionField(photo: DrawingSheetPhoto, docs: readonly DocText[]): Field {
  const d = photo.t.drawing;
  if (!d) return { value: null, label: "unknown", source: null, basis: "this photo is not a drawing" };
  if (d.revision === null) {
    return { value: null, label: "unknown", source: null, basis: "the drawing's revision is not in this photo" };
  }
  // "<documentNo> | <revision>" is the exact substring the DOCUMENT line's render carries, and is
  // specific enough (unlike the bare revision letter) to locate that one line, not an unrelated one.
  const needle = d.documentNo !== null ? `${d.documentNo} | ${d.revision}` : d.revision;
  return photoField(photo, docs, d.revision, needle, "drawing title block revision");
}

type FindResult =
  | { ok: true; sheet: DrawingSheet; sightings: { connection: DrawingConnectionBlock; photo: DrawingSheetPhoto }[] }
  | { ok: false; reason: "missing" | "ambiguous" | "drawing_not_found"; candidates: (string | null)[] };

/** Finds the ONE sheet carrying this connection id. More than one drawing carrying it is
 *  ambiguous unless `drawing` names one (Codex #5204 F2); source order never picks the winner. */
function findConnection(sheets: readonly DrawingSheet[], connectionRef: string, drawing: string | null | undefined): FindResult {
  const id = connectionIdOf(connectionRef);
  const owners = sheets.filter((sh) => sh.connections.some((c) => c.connection.id === id));
  const wanted = drawing ? drawingIdKey(drawing) : "";
  let pick: DrawingSheet[] = owners;
  if (wanted) {
    pick = owners.filter((sh) => sh.documentKey === wanted);
    if (pick.length === 0) {
      return { ok: false, reason: owners.length === 0 ? "missing" : "drawing_not_found", candidates: owners.map((o) => o.documentKey) };
    }
  }
  if (pick.length === 0) return { ok: false, reason: "missing", candidates: [] };
  if (pick.length > 1) return { ok: false, reason: "ambiguous", candidates: pick.map((o) => o.documentKey) };
  const sheet = pick[0];
  return { ok: true, sheet, sightings: sheet.connections.filter((c) => c.connection.id === id) };
}

function conflictField(cell: string, readings: { value: string; docId: string }[]): Field {
  return {
    value: null,
    label: "unknown",
    source: null,
    basis: `${cell} is printed differently across photos: ${readings.map((r) => `'${r.value}' (photo ${r.docId})`).join(" vs ")} — check the drawing`,
  };
}

function reconciledCellField(c: ReconciledCell, cellName: string, docs: readonly DocText[], needle: string, basis: string): Field {
  if (c === null) return { value: null, label: "unknown", source: null, basis: "not in this photo" };
  if (c.kind === "conflict") return conflictField(cellName, c.readings);
  if (c.kind === "illegible") return cellField(c.photo, docs, c.raw, needle, basis);
  return photoField(c.photo, docs, c.value, needle, basis);
}

function buildParts(
  sightings: readonly { connection: DrawingConnectionBlock; photo: DrawingSheetPhoto }[],
  docs: readonly DocText[],
  bom: readonly { row: DrawingBomRow }[],
): PacketPart[] {
  return reconcileConnectionRows(sightings).map((r) => {
    const needle = rowNeedle(r.anchor.row);
    const art = r.cells.artNo && r.cells.artNo.kind === "value" ? r.cells.artNo.value : null;
    const match = art ? bom.find((b) => b.row.artNo === art) : undefined;
    const item = match && match.row.pos && /^\d+$/.test(match.row.pos.trim()) ? Number(match.row.pos.trim()) : null;
    const descCells = [r.cells.type, r.cells.spec, r.cells.strength];
    const descConflict = descCells.find((c) => c !== null && c.kind === "conflict");
    let description: Field;
    if (descConflict && descConflict.kind === "conflict") {
      description = conflictField("hardware description", descConflict.readings);
    } else if (descCells.every((c) => c !== null && c.kind === "value")) {
      const vals = descCells as { kind: "value"; value: string; photo: DrawingSheetPhoto }[];
      // Cite from one photo only when every contributing cell came from it; otherwise the composed
      // value has no single source line and stays proposed.
      const one = vals.every((v) => v.photo.docId === vals[0].photo.docId) ? vals[0].photo : null;
      description = one
        ? photoField(one, docs, vals.map((v) => v.value).join(" ").trim(), needle, "connection hardware row")
        : { value: vals.map((v) => v.value).join(" ").trim(), label: "proposed", source: null, basis: "composed from cells on more than one photo; check it against the drawing" };
    } else {
      description = compositeCellField(
        r.anchor.photo,
        docs,
        [r.anchor.row.type, r.anchor.row.spec, r.anchor.row.strength],
        (parts) => parts.join(" ").trim(),
        needle,
        "connection hardware row",
      );
    }
    return {
      kit: null,
      item,
      partNumber: reconciledCellField(r.cells.artNo, "Art. No.", docs, needle, "connection hardware row, Art. No. column"),
      description,
      qty: reconciledCellField(r.cells.qty, "Qty", docs, needle, "connection hardware row, Qty column"),
    };
  });
}

function parseTorque(raw: string): { marked: boolean; value: string } | null {
  const m = /^Ma(\*)?\s*=\s*(.+)$/i.exec(raw.trim());
  if (!m) return null;
  return { marked: !!m[1], value: m[2].trim() };
}

const SITE_TOOL_FIELD: Field = { value: null, label: "unknown", source: null, basis: "tool is a site item — the drawing does not specify the wrench" };

/** The connection's torque measurements, plus a blocker message for every torque the packet cannot
 *  state (Codex #5204 r2 F5): no callout at all, a callout with no torque printed, or a torque not
 *  in the `Ma=` form. Each of those still yields an unknown measurement, so the packet never looks
 *  complete while the torque is missing. */
function buildMeasurements(
  sheet: DrawingSheet,
  connectionId: string,
  docs: readonly DocText[],
): { measurements: PacketMeasurement[]; gaps: string[] } {
  const byRef = new Map<string, { callout: DrawingCallout; photo: DrawingSheetPhoto }[]>();
  for (const c of sheet.callouts) {
    if (connectionIdOf(c.callout.ref) !== connectionId) continue;
    const list = byRef.get(c.callout.ref) ?? [];
    list.push(c);
    byRef.set(c.callout.ref, list);
  }

  const measurements: PacketMeasurement[] = [];
  const gaps: string[] = [];
  const unknownTorque = (basis: string): Field => ({ value: null, label: "unknown", source: null, basis });
  if (byRef.size === 0) {
    const basis = `no torque callout for connection ${connectionId} on the attached photos`;
    measurements.push({
      name: { value: `${connectionId} tightening torque`, label: "proposed", source: null, basis },
      value: unknownTorque(basis),
      tool: SITE_TOOL_FIELD,
    });
    gaps.push(`No torque callout for connection ${connectionId} was found on the attached photos — confirm the torque from the drawing.`);
  }
  byRef.forEach((sightings, ref) => {
    const primary = sightings.find((s) => s.photo.reviewed) ?? sightings[0];
    const nameField = photoField(primary.photo, docs, `${ref} tightening torque`, ref, "callout reference label");
    // A photo that shows the callout without its torque says nothing about the torque; only printed
    // torques are compared.
    const printedTorque = sightings.filter((s) => s.callout.torque !== null && s.callout.torque.trim() !== "");
    const distinctTorque = Array.from(new Set(printedTorque.map((s) => s.callout.torque!.trim())));
    if (distinctTorque.length === 0) {
      measurements.push({ name: nameField, value: unknownTorque(`callout ${ref} prints no torque on the attached photos`), tool: SITE_TOOL_FIELD });
      gaps.push(`Callout ${ref} prints no torque on the attached photos — confirm the torque from the drawing.`);
      return;
    }

    if (distinctTorque.length > 1) {
      // torque_conflict: the drawing's own callouts disagree — never guess a side, null it (HARD RULE).
      measurements.push({
        name: nameField,
        value: {
          value: null,
          label: "unknown",
          source: null,
          basis: `the drawing's callouts print more than one torque for ${ref}: ${printedTorque.map((s) => `'${s.callout.torque}'`).join(" vs ")} — not used as a measurement`,
        },
        tool: SITE_TOOL_FIELD,
      });
      return;
    }

    const raw = distinctTorque[0];
    const parsed = parseTorque(raw);
    if (!parsed) {
      measurements.push({
        name: nameField,
        value: unknownTorque(`printed as '${raw}', not in the 'Ma=' form this reader states as a tightening torque — check the drawing`),
        tool: SITE_TOOL_FIELD,
      });
      gaps.push(`Callout ${ref} prints '${raw}', which is not in the 'Ma=' torque form — confirm what it means from the drawing.`);
      return;
    }

    if (parsed.marked) {
      // Ma* (asterisk): the printed value is kept, but its meaning is not on the drawing — label
      // forced to unknown regardless of the photo's review status (task spec's one named exception).
      const printed = photoField(primary.photo, docs, parsed.value, ref, "callout torque — printed value");
      measurements.push({
        name: nameField,
        value: { ...printed, label: "unknown", basis: `printed as '${raw}' — the asterisk's meaning is not on the drawing` },
        tool: SITE_TOOL_FIELD,
      });
      return;
    }

    measurements.push({
      name: nameField,
      value: cellField((printedTorque.find((s) => s.photo.reviewed) ?? printedTorque[0]).photo, docs, parsed.value, ref, "callout torque"),
      tool: SITE_TOOL_FIELD,
    });
  });

  return { measurements, gaps };
}

/** Every note the drawing prints for this connection's callouts, and every drawing-wide note on the
 *  sheet, each kept word for word and cited to the photo it was read from (reviewed photos first).
 *  Nothing is inferred from a note's wording — "Do not lubricate" stays exactly that — and no note
 *  is dropped because another came first (Codex #5204 r2 F4). Identical wording is listed once. */
function buildNoteCautions(sheet: DrawingSheet, connectionId: string, docs: readonly DocText[]): Field[] {
  const order = (a: DrawingSheetPhoto, b: DrawingSheetPhoto) =>
    a.reviewed === b.reviewed ? a.docId.localeCompare(b.docId) : a.reviewed ? -1 : 1;
  const seen = new Set<string>();
  const out: Field[] = [];
  const add = (note: string, photo: DrawingSheetPhoto, basis: string) => {
    const text = note.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    out.push(photoField(photo, docs, text, text, basis));
  };
  const callouts = sheet.callouts
    .filter((c) => connectionIdOf(c.callout.ref) === connectionId)
    .sort((a, b) => order(a.photo, b.photo) || a.callout.ref.localeCompare(b.callout.ref));
  for (const c of callouts) for (const n of c.callout.notes) add(n, c.photo, `note printed at callout ${c.callout.ref}`);
  for (const photo of [...sheet.photos].sort(order)) {
    for (const n of photo.t.drawing?.notes ?? []) add(n, photo, "note printed on the drawing");
  }
  return out;
}

function buildSteps(
  connection: DrawingConnectionBlock,
  opts: { hasNotes: boolean; torqueKnown: boolean },
): { steps: PacketStep[]; tightenIndex: number } {
  const section = `Connection ${connection.id}`;
  const mk = (text: string, phase: NonNullable<PacketStep["phase"]>, basis: string): PacketStep => ({
    section,
    topic: "other",
    phase,
    // Steps are always "proposed" — a drawing has no step sequence (HARD RULE; basis says so).
    text: { value: text, label: "proposed", source: null, basis },
  });

  const steps: PacketStep[] = [];
  steps.push(
    mk(
      "Make the connection safe to work on per your site's isolation/lockout procedure.",
      "removal",
      "standard bolted-connection job order; isolation/lockout is a site procedure, not printed on the drawing",
    ),
  );
  steps.push(
    mk(
      `Check that the fasteners listed for connection ${connection.id} are present and match the drawing.`,
      "removal",
      "standard bolted-connection job order; a drawing has no step sequence",
    ),
  );
  // Never repeat article numbers here: the Parts section carries them with their conflicts and
  // citations, and a raw copy could re-state a number the Parts section rejected (Codex #5204 r2 F3).
  steps.push(
    mk(
      "Replace with the hardware listed under Parts.",
      "service",
      "standard bolted-connection job order; a drawing has no step sequence",
    ),
  );
  if (opts.hasNotes) {
    // The notes themselves are listed, cited and unreworded under Cautions (Codex #5204 r2 F4).
    steps.push(
      mk(
        "Read and follow the drawing notes listed under Cautions before tightening.",
        "service",
        "the drawing prints notes for this connection; their wording is kept under Cautions",
      ),
    );
  }
  const tightenIndex = steps.length;
  steps.push(
    mk(
      opts.torqueKnown
        ? "Tighten to the torque below."
        : "Tighten to the drawing's torque. This packet cannot state it from these photos (see Measurements): confirm it from the drawing first.",
      "service",
      "standard bolted-connection job order; a drawing has no step sequence",
    ),
  );
  steps.push(
    mk(
      "Apply a new torque stripe across the fastener and mating part per your site's torque-stripe practice.",
      "reinstall",
      "standard bolted-connection job order; torque-stripe practice is a site item, not printed on the drawing",
    ),
  );
  steps.push(
    mk(
      "Record the torque applied and the wrench used, per your site's practice.",
      "reinstall",
      "standard bolted-connection job order; a drawing has no step sequence",
    ),
  );
  return { steps, tightenIndex };
}

function fieldFromIdentity(value: string | null, basis: string): Field {
  return value ? { value, label: "proposed", source: null, basis } : { value: null, label: "unknown", source: null, basis: "not provided" };
}

/** Builds a `WorkPacket` for one drawing connection ("C7" or one of its rows, "C7-B1"), reusing the
 *  Work Packet V2 contract and trust boundary. Refuses (`ok:false`) when no sheet carries a drawing
 *  at all, or when the requested connection is on no sheet. `verifyPacket` is run on the assembled
 *  packet and any flagged field is downgraded (never dropped), exactly as `buildDraftPacket` does. */
export function buildConnectionPacket(input: ConnectionPacketInput): DraftResult {
  const { notebookId, packetId, now, identity, workOrder, sheets, connectionRef, docs } = input;

  if (sheets.length === 0) {
    return refuse("no_documents", "No attached photo could be read as an engineering drawing, so a connection packet cannot be drafted.");
  }

  const located = findConnection(sheets, connectionRef, input.drawing);
  if (!located.ok) {
    if (located.reason === "ambiguous") {
      return refuse(
        "connection_ambiguous",
        `Connection "${connectionRef}" is on more than one attached drawing (${located.candidates.map((c) => c ?? "unnumbered").join(", ")}). Say which drawing number before drafting, so the hardware and torque come from the right assembly.`,
      );
    }
    if (located.reason === "drawing_not_found") {
      return refuse(
        "model_not_in_documents",
        `Connection "${connectionRef}" is not on drawing "${input.drawing}". It is on: ${located.candidates.map((c) => c ?? "unnumbered").join(", ")}.`,
      );
    }
    return refuse(
      "model_not_in_documents",
      `Connection "${connectionRef}" does not appear on any attached drawing photo, so a job packet cannot be drafted for it.`,
    );
  }
  const { sheet, sightings } = located;
  const connection = sightings[0].connection;
  const connectionId = connection.id;

  const parts = buildParts(sightings, docs, sheet.bom);
  const { measurements, gaps: torqueGaps } = buildMeasurements(sheet, connectionId, docs);
  const cautions = buildNoteCautions(sheet, connectionId, docs);
  const torqueKnown = measurements.some((m) => m.value.value !== null && m.value.label !== "unknown");

  const { steps, tightenIndex } = buildSteps(connection, { hasNotes: cautions.length > 0, torqueKnown });
  for (const m of measurements) {
    m.steps = [tightenIndex];
    m.link = {
      value: `used at step ${tightenIndex + 1} of this packet`,
      label: "proposed",
      source: null,
      basis: "the step tightens this connection's fastener",
    };
  }

  const blockers: Field[] = [];
  for (const f of sheet.findings) {
    if (f.connection !== undefined && f.connection !== connectionId) continue;
    blockers.push({ value: null, label: "unknown", source: null, basis: f.message });
  }
  for (const g of torqueGaps) blockers.push({ value: null, label: "unknown", source: null, basis: g });

  const scope: Field[] = [
    {
      value: `Loose torque stripe at ${connectionRef}: replace hardware and re-torque`,
      label: "proposed",
      source: null,
      basis: "requested connection",
    },
  ];

  const documents: PacketDocument[] = sheet.photos.map((p) => {
    const doc = docs.find((d) => d.docId === p.docId) ?? null;
    return {
      docId: p.docId,
      fileId: p.fileId,
      filename: doc?.filename ?? null,
      role: "other",
      modelFoundOn: [],
      via: doc?.via ?? "chunks",
      revision: drawingRevisionField(p, docs),
    };
  });

  const equipment = {
    manufacturer: fieldFromIdentity(identity.manufacturer, "confirmed equipment identity"),
    model: fieldFromIdentity(identity.model, "confirmed equipment identity"),
    serial: fieldFromIdentity(identity.serialNumber, "confirmed equipment identity"),
    identityStatus: identity.status,
  };

  const safety = {
    cautions,
    // Always unknown: the site owns isolation and lockout (HARD RULE).
    siteIsolation: { value: null, label: "unknown" as const, source: null, basis: "the site owns isolation and lockout" },
    hazardFlags: [...(input.hazardFlags ?? [])],
  };

  const packet: WorkPacket = {
    version: 2,
    packetId,
    generatedAt: now,
    notebookId,
    disclaimer: DISCLAIMER,
    equipment,
    workOrder,
    documents,
    scope,
    safety,
    parts,
    tools: [SITE_TOOL_FIELD],
    steps,
    measurements,
    unknowns: [],
    blockers,
    approval: {
      technicianReview: { state: "draft", entries: [] },
      supervisor: { state: "pending", by: null, at: null },
    },
  };

  const warnings: string[] = [];
  const problems = verifyPacket(packet);
  if (problems.length > 0) {
    const fieldsByPath = new Map(collectFields(packet).map((loc) => [loc.path, loc.field]));
    for (const problem of problems) {
      const sep = problem.indexOf(":");
      const path = sep === -1 ? problem : problem.slice(0, sep);
      const note = sep === -1 ? problem : problem.slice(sep + 2);
      const field = fieldsByPath.get(path);
      if (field) {
        field.value = null;
        field.label = "unknown";
        field.basis = `${field.basis} — downgraded: ${note}`;
      }
      warnings.push(problem);
    }
  }

  return { ok: true, packet, warnings };
}
