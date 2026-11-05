/**
 * Drawing connection packet (#4982 follow-on) — pure transcription parsing, a canonical
 * human-editable source-text format, and cross-photo cross-checking for one engineering-drawing
 * connection. No I/O, no model calls (`drawing-packet.ts` does the packet assembly; this module is
 * the parser + merger it builds on).
 *
 * Input contract (a vision call's transcription of one photo of an engineering drawing — already
 * specified by the task, reproduced here as the `DrawingTranscription` shape).
 *
 * Most scalar fields are `string | null`: a vision call reads a photo that may be a close-up of just
 * the connection table, with no title block in frame at all, and `null` means "not in this photo" —
 * never "not on the drawing" (the photo may simply be cropped). Never invent a value to fill one in.
 *
 * `renderDrawingSourceText` / `parseDrawingSourceText` are a canonical, human-editable LINE format:
 * one tag per line, fields separated by " | ". This is the text a technician edits in the notebook
 * (mirrors `photo-source.ts`'s "kept photo source" convention) and the text `DocText` lines in
 * `drawing-packet.ts` cite. Round-trip is exact for every shape this module produces, with one
 * accepted limitation: a field value must not itself contain "|" or a newline. `null` is encoded as
 * a reserved control-character token (`NULL_TOKEN`, below) distinct from an empty string "", so the
 * two never collapse into each other on a nullable field.
 *
 * TypeScript ES2017 target: no regex lookbehind anywhere in this file.
 */

// ---------------------------------------------------------------------------
// Transcription shape (the vision call's JSON output for one photo)
// ---------------------------------------------------------------------------

export type DrawingTranscriptionKind =
  | "drawing"
  | "nameplate"
  | "equipment"
  | "reading"
  | "job_sheet"
  | "manual_page"
  | "other";

export interface DrawingRevisionRow {
  rev: string;
  text: string;
  date: string | null;
}

export interface DrawingConnectionRow {
  name: string | null;
  type: string | null;
  pos: string | null;
  qty: string | null;
  spec: string | null;
  strength: string | null;
  artNo: string | null;
}

export interface DrawingConnectionBlock {
  id: string;
  classText: string | null;
  rows: DrawingConnectionRow[];
}

export interface DrawingCallout {
  ref: string;
  torque: string | null;
  notes: string[];
}

export interface DrawingBomRow {
  pos: string | null;
  qty: string | null;
  drawingNo: string | null;
  artNo: string | null;
  description: string | null;
  material: string | null;
  standard: string | null;
}

export interface Drawing {
  documentNo: string | null;
  revision: string | null;
  filenameShown: string | null;
  title: string | null;
  titleEnglish: string | null;
  ride: string | null;
  application: string | null;
  sheet: string | null;
  views: string[];
  revisionHistory: DrawingRevisionRow[];
  connections: DrawingConnectionBlock[];
  callouts: DrawingCallout[];
  notes: string[];
  bom: DrawingBomRow[];
}

export interface DrawingTranscription {
  kind: DrawingTranscriptionKind;
  drawing: Drawing | null;
  otherText: string[];
  unreadable: string[];
}

// ---------------------------------------------------------------------------
// parseDrawingTranscription — shape validation, tolerant of extra keys
// ---------------------------------------------------------------------------

const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "drawing",
  "nameplate",
  "equipment",
  "reading",
  "job_sheet",
  "manual_page",
  "other",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function validateRevisionRow(v: unknown): DrawingRevisionRow | null {
  if (!isRecord(v)) return null;
  const { rev, text, date } = v;
  if (!isString(rev) || !isString(text) || !isStringOrNull(date)) return null;
  return { rev, text, date };
}

function validateConnectionRow(v: unknown): DrawingConnectionRow | null {
  if (!isRecord(v)) return null;
  const { name, type, pos, qty, spec, strength, artNo } = v;
  if (
    !isStringOrNull(name) ||
    !isStringOrNull(type) ||
    !isStringOrNull(pos) ||
    !isStringOrNull(qty) ||
    !isStringOrNull(spec) ||
    !isStringOrNull(strength) ||
    !isStringOrNull(artNo)
  ) {
    return null;
  }
  return { name, type, pos, qty, spec, strength, artNo };
}

function validateConnectionBlock(v: unknown): DrawingConnectionBlock | null {
  if (!isRecord(v)) return null;
  const { id, classText, rows } = v;
  if (!isString(id) || !isStringOrNull(classText) || !Array.isArray(rows)) return null;
  const out: DrawingConnectionRow[] = [];
  for (const r of rows) {
    const row = validateConnectionRow(r);
    if (!row) return null;
    out.push(row);
  }
  return { id, classText, rows: out };
}

function validateCallout(v: unknown): DrawingCallout | null {
  if (!isRecord(v)) return null;
  const { ref, torque, notes } = v;
  if (!isString(ref) || !isStringOrNull(torque) || !isStringArray(notes)) return null;
  return { ref, torque, notes };
}

function validateBomRow(v: unknown): DrawingBomRow | null {
  if (!isRecord(v)) return null;
  const { pos, qty, drawingNo, artNo, description, material, standard } = v;
  if (
    !isStringOrNull(pos) ||
    !isStringOrNull(qty) ||
    !isStringOrNull(drawingNo) ||
    !isStringOrNull(artNo) ||
    !isStringOrNull(description) ||
    !isStringOrNull(material) ||
    !isStringOrNull(standard)
  ) {
    return null;
  }
  return { pos, qty, drawingNo, artNo, description, material, standard };
}

function validateDrawing(v: unknown): Drawing | null {
  if (!isRecord(v)) return null;
  const { documentNo, revision, filenameShown, title, titleEnglish, ride, application, sheet, views, revisionHistory, connections, callouts, notes, bom } = v;
  if (
    !isStringOrNull(documentNo) ||
    !isStringOrNull(revision) ||
    !isStringOrNull(filenameShown) ||
    !isStringOrNull(title) ||
    !isStringOrNull(titleEnglish) ||
    !isStringOrNull(ride) ||
    !isStringOrNull(application) ||
    !isStringOrNull(sheet)
  ) {
    return null;
  }
  if (!isStringArray(views)) return null;
  if (!Array.isArray(revisionHistory)) return null;
  const revHist: DrawingRevisionRow[] = [];
  for (const r of revisionHistory) {
    const row = validateRevisionRow(r);
    if (!row) return null;
    revHist.push(row);
  }
  if (!Array.isArray(connections)) return null;
  const conns: DrawingConnectionBlock[] = [];
  for (const c of connections) {
    const block = validateConnectionBlock(c);
    if (!block) return null;
    conns.push(block);
  }
  if (!Array.isArray(callouts)) return null;
  const cos: DrawingCallout[] = [];
  for (const c of callouts) {
    const co = validateCallout(c);
    if (!co) return null;
    cos.push(co);
  }
  if (!isStringArray(notes)) return null;
  if (!Array.isArray(bom)) return null;
  const bomRows: DrawingBomRow[] = [];
  for (const b of bom) {
    const row = validateBomRow(b);
    if (!row) return null;
    bomRows.push(row);
  }
  return {
    documentNo,
    revision,
    filenameShown,
    title,
    titleEnglish,
    ride,
    application,
    sheet,
    views,
    revisionHistory: revHist,
    connections: conns,
    callouts: cos,
    notes,
    bom: bomRows,
  };
}

/** Validates a vision call's transcription JSON into a `DrawingTranscription`. Tolerant of extra
 *  keys (anything beyond the known shape is ignored); returns `null` for anything that does not
 *  match — including a present-but-wrong-shaped `drawing`, `otherText` or `unreadable`. */
export function parseDrawingTranscription(json: unknown): DrawingTranscription | null {
  if (!isRecord(json)) return null;
  if (!isString(json.kind) || !KNOWN_KINDS.has(json.kind)) return null;
  const kind = json.kind as DrawingTranscriptionKind;

  const otherTextRaw = json.otherText;
  const otherText = otherTextRaw === undefined ? [] : isStringArray(otherTextRaw) ? otherTextRaw : null;
  if (otherText === null) return null;

  const unreadableRaw = json.unreadable;
  const unreadable = unreadableRaw === undefined ? [] : isStringArray(unreadableRaw) ? unreadableRaw : null;
  if (unreadable === null) return null;

  const drawingRaw = json.drawing;
  let drawing: Drawing | null;
  if (drawingRaw === undefined || drawingRaw === null) {
    drawing = null;
  } else {
    drawing = validateDrawing(drawingRaw);
    if (drawing === null) return null;
  }

  return { kind, drawing, otherText, unreadable };
}

// ---------------------------------------------------------------------------
// Canonical LINE source-text format (render / parse, exact round trip)
// ---------------------------------------------------------------------------

const SEP = " | ";

/** Escapes one field so it can never be read back as a delimiter or a line break: "\\" → "\\\\",
 *  "|" → "\\|", newline → "\\n", carriage return → "\\r". (Codex #5204 F4: an unescaped "|" inside
 *  a cell shifted every later column.) */
function escField(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

/** Splits a trimmed line into fields on UNESCAPED "|" only, trims the spaces around each field
 *  (so a technician's editor trimming trailing whitespace still round-trips), then unescapes.
 *  Returns null on a dangling or unknown escape — malformed text is refused, never guessed. */
function splitFields(trimmed: string): string[] | null {
  // Pass 1: cut on unescaped "|", keeping escapes, and trim each raw segment (padding only — an
  // escaped newline or space is still escaped here, so it survives).
  const raw: string[] = [];
  let cur = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\") {
      if (i + 1 >= trimmed.length) return null;
      cur += ch + trimmed[i + 1];
      i++;
    } else if (ch === "|") {
      raw.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  raw.push(cur.trim());
  // Pass 2: unescape. An unknown escape is malformed text — refused, never guessed.
  const out: string[] = [];
  for (const seg of raw) {
    let v = "";
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      if (ch !== "\\") { v += ch; continue; }
      const nx = seg[i + 1];
      if (nx === "\\" || nx === "|") v += nx;
      else if (nx === "n") v += "\n";
      else if (nx === "r") v += "\r";
      else return null;
      i++;
    }
    out.push(v);
  }
  return out;
}

/** Most fields a tag's line may carry (tag included). A line with MORE is refused: extra fields
 *  mean a value was split, and silently dropping them would corrupt the row. Fewer is allowed — a
 *  missing trailing field means "not in this photo". CALLOUT carries any number of notes. */
const MAX_FIELDS: Record<string, number> = {
  KIND: 2, DOCUMENT: 4, FILENAME: 2, TITLE: 2, TITLE_EN: 2, RIDE: 2, APPLICATION: 2, VIEW: 2,
  REV: 4, CONNECTION: 3, ROW: 8, NOTE: 2, BOMROW: 8, OTHER: 2, UNREADABLE: 2,
};

/** Reserved marker for an explicit `null` on a nullable field — a control character no real photo
 *  transcription will ever contain, so it cannot collide with a real value, and it is distinct from
 *  an empty string "" (which this format also supports and never confuses with "not in this photo"). */
const NULL_TOKEN = "␀";

/** Encodes a nullable field for a LINE: `null` → the reserved marker, otherwise the value as-is
 *  (including ""). */
function encN(v: string | null): string {
  return v === null ? NULL_TOKEN : v;
}

/** Decodes a nullable field read back from a LINE: a missing trailing token or the reserved marker
 *  both mean `null`; anything else (including "") is returned as-is. */
function decN(tok: string | undefined): string | null {
  if (tok === undefined || tok === NULL_TOKEN) return null;
  return tok;
}

function line(...fields: string[]): string {
  return fields.map(escField).join(SEP);
}

/** Renders a `DrawingTranscription` as the canonical notebook source text: one tag line per table
 *  row / header field. This is what gets stored as the photo's kept source and what a technician
 *  corrects; `drawing-packet.ts` cites exact lines out of it. */
export function renderDrawingSourceText(t: DrawingTranscription): string {
  const lines: string[] = [];
  lines.push(line("KIND", t.kind));
  const d = t.drawing;
  if (d) {
    lines.push(line("DOCUMENT", encN(d.documentNo), encN(d.revision), encN(d.sheet)));
    lines.push(line("FILENAME", encN(d.filenameShown)));
    lines.push(line("TITLE", encN(d.title)));
    lines.push(line("TITLE_EN", encN(d.titleEnglish)));
    lines.push(line("RIDE", encN(d.ride)));
    lines.push(line("APPLICATION", encN(d.application)));
    for (const v of d.views) lines.push(line("VIEW", v));
    for (const r of d.revisionHistory) lines.push(line("REV", r.rev, r.text, encN(r.date)));
    for (const c of d.connections) {
      lines.push(line("CONNECTION", c.id, encN(c.classText)));
      for (const row of c.rows) {
        lines.push(
          line("ROW", encN(row.name), encN(row.type), encN(row.pos), encN(row.qty), encN(row.spec), encN(row.strength), encN(row.artNo)),
        );
      }
    }
    for (const co of d.callouts) lines.push(line("CALLOUT", co.ref, encN(co.torque), ...co.notes));
    for (const n of d.notes) lines.push(line("NOTE", n));
    for (const b of d.bom) {
      lines.push(line("BOMROW", encN(b.pos), encN(b.qty), encN(b.drawingNo), encN(b.artNo), encN(b.description), encN(b.material), encN(b.standard)));
    }
  }
  for (const o of t.otherText) lines.push(line("OTHER", o));
  for (const u of t.unreadable) lines.push(line("UNREADABLE", u));
  return lines.join("\n");
}

/** Parses the canonical LINE source text back into a `DrawingTranscription`. Returns `null` on any
 *  line whose tag it does not recognize, or a ROW line before any CONNECTION header — otherwise the
 *  inverse of `renderDrawingSourceText`. */
export function parseDrawingSourceText(text: string): DrawingTranscription | null {
  let kind: DrawingTranscriptionKind | null = null;
  let hasDocument = false;
  let documentNo: string | null = null;
  let revision: string | null = null;
  let sheet: string | null = null;
  let filenameShown: string | null = null;
  let title: string | null = null;
  let titleEnglish: string | null = null;
  let ride: string | null = null;
  let application: string | null = null;
  const views: string[] = [];
  const revisionHistory: DrawingRevisionRow[] = [];
  const connections: DrawingConnectionBlock[] = [];
  const callouts: DrawingCallout[] = [];
  const notes: string[] = [];
  const bom: DrawingBomRow[] = [];
  const otherText: string[] = [];
  const unreadable: string[] = [];
  let currentConnection: DrawingConnectionBlock | null = null;

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;
    const tokens = splitFields(trimmed);
    if (!tokens) return null;
    const tag = tokens[0];
    const max = MAX_FIELDS[tag];
    if (max !== undefined && tokens.length > max) return null;
    switch (tag) {
      case "KIND":
        if (!isString(tokens[1]) || !KNOWN_KINDS.has(tokens[1])) return null;
        kind = tokens[1] as DrawingTranscriptionKind;
        break;
      case "DOCUMENT":
        hasDocument = true;
        documentNo = decN(tokens[1]);
        revision = decN(tokens[2]);
        sheet = decN(tokens[3]);
        break;
      case "FILENAME":
        filenameShown = decN(tokens[1]);
        break;
      case "TITLE":
        title = decN(tokens[1]);
        break;
      case "TITLE_EN":
        titleEnglish = decN(tokens[1]);
        break;
      case "RIDE":
        ride = decN(tokens[1]);
        break;
      case "APPLICATION":
        application = decN(tokens[1]);
        break;
      case "VIEW":
        views.push(tokens[1] ?? "");
        break;
      case "REV":
        revisionHistory.push({ rev: tokens[1] ?? "", text: tokens[2] ?? "", date: decN(tokens[3]) });
        break;
      case "CONNECTION":
        currentConnection = { id: tokens[1] ?? "", classText: decN(tokens[2]), rows: [] };
        connections.push(currentConnection);
        break;
      case "ROW": {
        if (!currentConnection) return null; // a row outside any connection header — malformed
        const [, name, type, pos, qty, spec, strength, artNo] = tokens;
        currentConnection.rows.push({
          name: decN(name),
          type: decN(type),
          pos: decN(pos),
          qty: decN(qty),
          spec: decN(spec),
          strength: decN(strength),
          artNo: decN(artNo),
        });
        break;
      }
      case "CALLOUT": {
        const ref = tokens[1] ?? "";
        const torque = decN(tokens[2]);
        callouts.push({ ref, torque, notes: tokens.slice(3) });
        break;
      }
      case "NOTE":
        notes.push(tokens[1] ?? "");
        break;
      case "BOMROW": {
        const [, pos, qty, drawingNo, artNo, description, material, standard] = tokens;
        bom.push({
          pos: decN(pos),
          qty: decN(qty),
          drawingNo: decN(drawingNo),
          artNo: decN(artNo),
          description: decN(description),
          material: decN(material),
          standard: decN(standard),
        });
        break;
      }
      case "OTHER":
        otherText.push(tokens[1] ?? "");
        break;
      case "UNREADABLE":
        unreadable.push(tokens[1] ?? "");
        break;
      default:
        return null;
    }
  }

  if (kind === null) return null;

  const drawing: Drawing | null = hasDocument
    ? {
        documentNo,
        revision,
        filenameShown,
        title,
        titleEnglish,
        ride,
        application,
        sheet,
        views,
        revisionHistory,
        connections,
        callouts,
        notes,
        bom,
      }
    : null;

  return { kind, drawing, otherText, unreadable };
}

// ---------------------------------------------------------------------------
// docRevFromFilename
// ---------------------------------------------------------------------------

const FILENAME_RE = /^[^_]+_(\d+)([A-Za-z])(\d)\.pdf$/i;

/** `<app>_<docNoDigits><REV><sheetDigit>.pdf` → `{docNoDigits, rev, sheet}` (e.g.
 *  `9100_9000110000C1.PDF` → `{docNoDigits:"9000110000", rev:"C", sheet:"1"}`). `docNoDigits`
 *  compares against `documentNo` with dashes (and any other non-digit) removed. `null` when the
 *  filename does not match the convention. */
export function docRevFromFilename(name: string): { docNoDigits: string; rev: string; sheet: string } | null {
  const m = FILENAME_RE.exec(name.trim());
  if (!m) return null;
  return { docNoDigits: m[1], rev: m[2].toUpperCase(), sheet: m[3] };
}

// ---------------------------------------------------------------------------
// mergeDrawingPhotos — groups photos of the same document, finds cross-checks
// ---------------------------------------------------------------------------

export interface DrawingSheetPhoto {
  docId: string;
  fileId: string | null;
  reviewed: boolean;
  t: DrawingTranscription;
}

export type DrawingFindingKind =
  | "revision_conflict"
  | "pos_offset"
  | "pos_placeholder"
  | "torque_marked"
  | "torque_conflict"
  | "unreadable"
  | "not_cross_checked"
  | "revision_touches_torque"
  | "document_unidentified"
  | "hardware_conflict"
  | "connection_ambiguous";

export interface DrawingFinding {
  kind: DrawingFindingKind;
  /** The connection this finding is about (e.g. "C7"). Absent for a document-wide finding (a
   *  title-block revision conflict, a missing BOM, a revision-history line touching torque, or
   *  `document_unidentified`) — a document-wide finding is a blocker for every connection on
   *  the sheet. */
  connection?: string;
  message: string;
  /** docId of every photo this finding's evidence comes from. */
  photos: string[];
}

export interface DrawingSheet {
  /** Grouping key: `documentNo` with non-digits removed, or (when that is empty/absent) the
   *  filename's digit run. `null` only when a lone photo has neither. */
  documentKey: string | null;
  photos: DrawingSheetPhoto[];
  connections: { connection: DrawingConnectionBlock; photo: DrawingSheetPhoto }[];
  callouts: { callout: DrawingCallout; photo: DrawingSheetPhoto }[];
  bom: { row: DrawingBomRow; photo: DrawingSheetPhoto }[];
  revisionHistory: { row: DrawingRevisionRow; photo: DrawingSheetPhoto }[];
  findings: DrawingFinding[];
}

// ---------------------------------------------------------------------------
// Connection-row reconciliation across photos (Codex #5204 F1)
// ---------------------------------------------------------------------------

export type ConnectionCell = "name" | "type" | "pos" | "qty" | "spec" | "strength" | "artNo";
const CONNECTION_CELLS: readonly ConnectionCell[] = ["name", "type", "pos", "qty", "spec", "strength", "artNo"];

/** One cell of a reconciled hardware row: the agreed legible value and the photo it is cited from
 *  (a reviewed photo when any reviewed photo printed it), or a conflict listing every legible
 *  reading, or `null` when no photo printed a legible value (missing or "[?]"). */
export type ReconciledCell =
  | { kind: "value"; value: string; photo: DrawingSheetPhoto }
  | { kind: "conflict"; readings: { value: string; docId: string }[] }
  | { kind: "illegible"; raw: string; photo: DrawingSheetPhoto }
  | null;

export interface ReconciledRow {
  key: string;
  cells: Record<ConnectionCell, ReconciledCell>;
  /** Two rows from one photo landed in this group: the photos cannot be matched row-for-row. */
  ambiguous: boolean;
  /** The sighting whose row anchors citations for this row (first in the deterministic order). */
  anchor: { row: DrawingConnectionRow; photo: DrawingSheetPhoto };
}

/** A cell value usable as row identity: legible (no `[?]`) and non-empty, normalized for comparison. */
function identityOf(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim().toLowerCase();
  return t && !t.includes("[?]") ? t : null;
}

/** The identity tokens one row offers for matching against rows on OTHER photos of the same
 *  connection: its row name with its type (e.g. "B1|bolt"), its position, its article number.
 *  Any one shared token joins two rows; none of them is trusted alone to keep rows apart. */
function rowTokens(row: DrawingConnectionRow): string[] {
  const out: string[] = [];
  const name = identityOf(row.name);
  if (name) out.push(`name:${name}|${identityOf(row.type) ?? ""}`);
  const pos = identityOf(row.pos);
  if (pos) out.push(`pos:${pos}`);
  const art = identityOf(row.artNo);
  if (art) out.push(`art:${art}`);
  return out;
}

/** Reconciles every sighting of ONE connection (same id, same sheet) into one row list. Order is
 *  deterministic — reviewed photos first, then by docId — so the result never depends on the order
 *  photos were attached. Rows on different photos are the same row when they share ANY identity
 *  token (name+type, position, or article number), so a disagreement in one identity cell is a
 *  conflict, not two parts (Codex #5204 r2 F1). Rows present on only some photos are kept (partial
 *  photos complement each other). A matched group holding two rows from the same photo cannot be
 *  told apart and is marked `ambiguous`. A cell whose legible readings disagree is a conflict,
 *  never "the first one wins". */
export function reconcileConnectionRows(
  sightings: readonly { connection: DrawingConnectionBlock; photo: DrawingSheetPhoto }[],
): ReconciledRow[] {
  const ordered = [...sightings].sort((a, b) =>
    a.photo.reviewed === b.photo.reviewed ? a.photo.docId.localeCompare(b.photo.docId) : a.photo.reviewed ? -1 : 1,
  );
  const entries: { row: DrawingConnectionRow; photo: DrawingSheetPhoto }[] = [];
  for (const s of ordered) for (const row of s.connection.rows) entries.push({ row, photo: s.photo });

  // Union-find over entries: rows on different photos sharing an identity token are one row.
  const parent = entries.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const ownerOfToken = new Map<string, number>();
  entries.forEach((e, k) => {
    for (const tok of rowTokens(e.row)) {
      const other = ownerOfToken.get(tok);
      if (other === undefined) ownerOfToken.set(tok, k);
      else if (entries[other].photo.docId !== e.photo.docId) parent[find(k)] = find(other);
    }
  });
  const groups = new Map<number, { row: DrawingConnectionRow; photo: DrawingSheetPhoto }[]>();
  entries.forEach((e, k) => {
    const root = find(k);
    const list = groups.get(root) ?? [];
    list.push(e);
    groups.set(root, list);
  });

  const out: ReconciledRow[] = [];
  Array.from(groups.keys())
    .sort((a, b) => a - b)
    .forEach((root) => {
      const list = groups.get(root)!;
      const cells = {} as Record<ConnectionCell, ReconciledCell>;
      for (const cell of CONNECTION_CELLS) {
        const legible = list.filter((e) => e.row[cell] !== null && !(e.row[cell] as string).includes("[?]"));
        const distinct = Array.from(new Set(legible.map((e) => (e.row[cell] as string).trim())));
        if (distinct.length > 1) {
          cells[cell] = { kind: "conflict", readings: legible.map((e) => ({ value: e.row[cell] as string, docId: e.photo.docId })) };
        } else if (legible.length > 0) {
          cells[cell] = { kind: "value", value: legible[0].row[cell] as string, photo: legible[0].photo };
        } else {
          const ill = list.find((e) => e.row[cell] !== null);
          cells[cell] = ill ? { kind: "illegible", raw: ill.row[cell] as string, photo: ill.photo } : null;
        }
      }
      const perPhoto = new Set(list.map((e) => e.photo.docId));
      out.push({
        key: rowTokens(list[0].row)[0] ?? `row:${root}`,
        cells,
        anchor: list[0],
        ambiguous: perPhoto.size < list.length,
      });
    });
  return out;
}

/** A drawing number reduced to its letters and digits, upper-cased: "ABC-100" → "ABC100",
 *  "90001-10000-" → "9000110000". Letters are kept so ABC-100 and DEF-100 stay two drawings
 *  (Codex #5204 r2 F2). Shared by sheet grouping and the packet's `drawing` selector. */
export function drawingIdKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function groupKeyFor(t: DrawingTranscription): string | null {
  const d = t.drawing;
  if (!d) return null;
  const fromDoc = d.documentNo ? drawingIdKey(d.documentNo) : "";
  if (fromDoc) return fromDoc;
  const fromName = d.filenameShown ? docRevFromFilename(d.filenameShown) : null;
  if (fromName) return fromName.docNoDigits;
  return null;
}

/** The connection id a callout/finding ref names: "C7" from either "C7" or "C7-B1". */
function connectionIdOf(ref: string): string {
  return ref.includes("-") ? ref.slice(0, ref.indexOf("-")) : ref;
}

const TORQUE_WORD_RE = /\btorque\b|\banzugsmoment\b/i;

function buildSheet(documentKey: string | null, photos: DrawingSheetPhoto[]): DrawingSheet {
  const connections: DrawingSheet["connections"] = [];
  const callouts: DrawingSheet["callouts"] = [];
  const bom: DrawingSheet["bom"] = [];
  const revisionHistory: DrawingSheet["revisionHistory"] = [];

  for (const photo of photos) {
    const d = photo.t.drawing;
    if (!d) continue;
    for (const connection of d.connections) connections.push({ connection, photo });
    for (const callout of d.callouts) callouts.push({ callout, photo });
    for (const row of d.bom) bom.push({ row, photo });
    for (const row of d.revisionHistory) revisionHistory.push({ row, photo });
  }

  const findings: DrawingFinding[] = [];

  // document_unidentified: this sheet has no documentNo and no parseable filename, so it cannot
  // be grouped with other photos of the same document and its revision cannot be checked.
  if (documentKey === null) {
    findings.push({
      kind: "document_unidentified",
      message:
        "This photo does not show which drawing number or revision it belongs to, so the revision cannot be checked. When you review the photo, add the drawing number and revision to its TITLE line.",
      photos: photos.map((p) => p.docId),
    });
  }

  // revision_conflict: title-block rev, filename rev, or two photos of this document disagree.
  {
    const sightings: { rev: string; from: string; docId: string }[] = [];
    for (const photo of photos) {
      const d = photo.t.drawing;
      if (!d) continue;
      if (d.revision !== null) sightings.push({ rev: d.revision, from: "title block", docId: photo.docId });
      const fromName = d.filenameShown ? docRevFromFilename(d.filenameShown) : null;
      if (fromName) sightings.push({ rev: fromName.rev, from: "filename", docId: photo.docId });
    }
    const distinct = Array.from(new Set(sightings.map((s) => s.rev)));
    if (distinct.length > 1) {
      findings.push({
        kind: "revision_conflict",
        message: `This document's revision disagrees across its photos: ${sightings.map((s) => `${s.rev} (${s.from}, photo ${s.docId})`).join("; ")}.`,
        photos: Array.from(new Set(sightings.map((s) => s.docId))),
      });
    }
  }

  // pos_placeholder, unreadable (row cells), pos_offset.
  for (const { connection, photo } of connections) {
    for (const row of connection.rows) {
      const posRaw = (row.pos ?? "").trim();
      if (posRaw === "-999" || !/^\d+$/.test(posRaw)) {
        findings.push({
          kind: "pos_placeholder",
          connection: connection.id,
          message: `Connection ${connection.id} row '${row.name || row.type || "row"}' has no usable BOM position on the drawing (printed pos '${row.pos ?? "not in this photo"}').`,
          photos: [photo.docId],
        });
      }
      if ([row.qty, row.spec, row.strength, row.artNo].some((c) => (c ?? "").includes("[?]"))) {
        findings.push({
          kind: "unreadable",
          connection: connection.id,
          message: `Connection ${connection.id} row '${row.name || row.type || "row"}' has an unreadable cell on the drawing.`,
          photos: [photo.docId],
        });
      }
      // A row the bill of materials (as read so far) does not list is not cross-checked — said per
      // connection, never left as a silent blank position. (No BOM at all is the document-wide
      // finding below.)
      if (bom.length > 0 && (!row.artNo || !bom.some((b) => b.row.artNo === row.artNo))) {
        findings.push({
          kind: "not_cross_checked",
          connection: connection.id,
          message: row.artNo
            ? `Art. No. ${row.artNo} (connection ${connection.id}) is not in the bill of materials rows read so far — that hardware has not been cross-checked against the parts list.`
            : `Connection ${connection.id} row '${row.name || row.type || "row"}' has no Art. No. in this photo — that hardware has not been cross-checked against the parts list.`,
          photos: [photo.docId],
        });
      }
      if (row.artNo) {
        const bomMatch = bom.find((b) => b.row.artNo === row.artNo);
        if (bomMatch && (bomMatch.row.pos ?? "").trim() !== posRaw) {
          findings.push({
            kind: "pos_offset",
            connection: connection.id,
            message: `Art. No. ${row.artNo} is connection ${connection.id} pos ${row.pos} but the bill of materials lists it at pos ${bomMatch.row.pos}.`,
            photos: Array.from(new Set([photo.docId, bomMatch.photo.docId])),
          });
        }
      }
    }
  }

  // torque_marked, unreadable (callout torque).
  for (const { callout, photo } of callouts) {
    if (callout.torque && /Ma\*/i.test(callout.torque)) {
      findings.push({
        kind: "torque_marked",
        connection: connectionIdOf(callout.ref),
        message: `Callout ${callout.ref}'s torque is marked with an asterisk (${callout.torque}) — the drawing does not say what the mark means.`,
        photos: [photo.docId],
      });
    }
    if (callout.torque && callout.torque.includes("[?]")) {
      findings.push({
        kind: "unreadable",
        connection: connectionIdOf(callout.ref),
        message: `Callout ${callout.ref}'s torque has an unreadable cell on the drawing (${callout.torque}).`,
        photos: [photo.docId],
      });
    }
  }

  // unreadable[] — lines the vision call could not read at all on a photo.
  for (const photo of photos) {
    if (photo.t.unreadable.length > 0) {
      findings.push({
        kind: "unreadable",
        message: `${photo.t.unreadable.length} line(s) this photo's transcription could not read: ${photo.t.unreadable.join("; ")}.`,
        photos: [photo.docId],
      });
    }
  }

  // torque_conflict: the same ref prints a different torque across callouts/photos.
  {
    const byRef = new Map<string, { torque: string | null; docId: string }[]>();
    for (const { callout, photo } of callouts) {
      const list = byRef.get(callout.ref) ?? [];
      list.push({ torque: callout.torque, docId: photo.docId });
      byRef.set(callout.ref, list);
    }
    byRef.forEach((sightings, ref) => {
      const distinct = Array.from(new Set(sightings.map((s) => s.torque ?? "")));
      if (distinct.length > 1) {
        findings.push({
          kind: "torque_conflict",
          connection: connectionIdOf(ref),
          message: `Callout ${ref}'s torque is printed differently across photos: ${sightings.map((s) => `'${s.torque}' (photo ${s.docId})`).join(" vs ")}.`,
          photos: Array.from(new Set(sightings.map((s) => s.docId))),
        });
      }
    });
  }

  // hardware_conflict: two photos of the same connection print a different value in the same
  // hardware cell (Codex #5204 F1). Each conflicting cell is named with every reading.
  {
    const byId = new Map<string, { connection: DrawingConnectionBlock; photo: DrawingSheetPhoto }[]>();
    for (const c of connections) {
      const list = byId.get(c.connection.id) ?? [];
      list.push(c);
      byId.set(c.connection.id, list);
    }
    byId.forEach((sightings, id) => {
      if (sightings.length < 2) return;
      for (const r of reconcileConnectionRows(sightings)) {
        if (r.ambiguous) {
          findings.push({
            kind: "hardware_conflict",
            connection: id,
            message: `Connection ${id} has rows that cannot be matched one-to-one across photos (around row '${r.anchor.row.name || r.anchor.row.type || "row"}') — check the hardware table against the drawing.`,
            photos: Array.from(new Set(sightings.map((x) => x.photo.docId))),
          });
        }
        for (const [cell, v] of Object.entries(r.cells)) {
          if (!v || v.kind !== "conflict") continue;
          findings.push({
            kind: "hardware_conflict",
            connection: id,
            message: `Connection ${id} row '${r.anchor.row.name || r.anchor.row.type || "row"}' ${cell} is printed differently across photos: ${v.readings.map((x) => `'${x.value}' (photo ${x.docId})`).join(" vs ")}.`,
            photos: Array.from(new Set(v.readings.map((x) => x.docId))),
          });
        }
      }
    });
  }

  // not_cross_checked: no bill of materials attached at all for this document.
  if (bom.length === 0) {
    findings.push({
      kind: "not_cross_checked",
      message: "No bill of materials is attached for this document — hardware has not been cross-checked against a parts list.",
      photos: photos.map((p) => p.docId),
    });
  }

  // revision_touches_torque: a revision-history row's text mentions torque.
  for (const { row, photo } of revisionHistory) {
    if (TORQUE_WORD_RE.test(row.text)) {
      findings.push({
        kind: "revision_touches_torque",
        message: `Revision ${row.rev} touches torque: "${row.text}".`,
        photos: [photo.docId],
      });
    }
  }

  return { documentKey, photos, connections, callouts, bom, revisionHistory, findings };
}

/** Groups photos of the same drawing document (by `documentNo`, falling back to the filename's
 *  digit run) and cross-checks them into `DrawingSheet`s with typed findings. A photo whose
 *  transcription is not a drawing (`t.drawing === null`) is ignored. */
export function mergeDrawingPhotos(photos: readonly DrawingSheetPhoto[]): DrawingSheet[] {
  const groups = new Map<string, DrawingSheetPhoto[]>();
  const ungrouped: DrawingSheetPhoto[] = [];
  for (const photo of photos) {
    if (!photo.t.drawing) continue;
    const key = groupKeyFor(photo.t);
    if (key === null) {
      ungrouped.push(photo);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(photo);
    groups.set(key, list);
  }
  const sheets: DrawingSheet[] = [];
  groups.forEach((groupPhotos, key) => sheets.push(buildSheet(key, groupPhotos)));
  for (const photo of ungrouped) sheets.push(buildSheet(null, [photo]));
  return sheets;
}

/** The first line of `fullText` whose leading " | "-delimited token is exactly "KIND", to end of
 *  text — i.e. the canonical `renderDrawingSourceText` block, regardless of what header a
 *  materializer (`buildPhotoSourceText`, the drawing-photos PUT review) prepended in front of it.
 *  `null` when no such line exists (plain prose, or a non-drawing document). */
export function extractCanonicalDrawingText(fullText: string): string | null {
  const lines = fullText.split("\n");
  const idx = lines.findIndex((l) => l.trim().split(" | ")[0]?.trim() === "KIND");
  if (idx === -1) return null;
  return lines.slice(idx).join("\n");
}
