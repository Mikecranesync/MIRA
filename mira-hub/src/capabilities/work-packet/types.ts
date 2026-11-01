/**
 * Work Packet (#4982) — the contract shared by the CAT Pumps document parsers, the draft builder,
 * the notebook route and the /v3 panel. Pure types, no I/O.
 *
 * A Work Packet is a DRAFT job plan assembled deterministically from the manufacturer documents
 * attached to an equipment notebook plus a technician's work-order text. Zero model calls: every
 * value is either read verbatim from a cited page line, selected/derived by this code, or unknown.
 *
 * Labels:
 *   verified — the value appears verbatim on `source.line` (page + line of an attached document)
 *   proposed — chosen or derived by this tool (scope, applicability, a standard-material kit);
 *              a qualified person must review it
 *   unknown  — not in the attached documents; `value` is null
 * Site isolation / lockout is always `unknown`: the site owns it, this tool never writes it.
 */

export type Label = "verified" | "proposed" | "unknown";

/** One page of a document as lines separated by "\n" — unpdf page text, or the page's stored
 *  chunks stitched back together (consecutive chunks overlap by ~120 chars; see document-text.ts). */
export interface PageText {
  page: number;
  text: string;
  /** Lines of `text` the PDF layout places in a figure-caption band (read from the original PDF);
   *  absent when the page came from chunk text. The service-manual parser skips only these. */
  figureLines?: string[];
}

export interface DocText {
  docId: string;
  /** namespace_direct_uploads id when the original bytes are kept (opens the source viewer). */
  fileId: string | null;
  filename: string | null;
  pages: PageText[];
  via: "file" | "chunks";
}

/** Exactly where a value was read: `line` is the trimmed source line it came from. */
export interface SourceRef {
  docId: string;
  fileId: string | null;
  filename: string | null;
  page: number;
  /** The exact text cited: one physical line, or — for a step or caution that wraps — the run of
   *  consecutive physical lines on `page` it was joined from, separated by single spaces. */
  line: string;
}

export type EditAction = "set" | "confirm" | "strike" | "mark_unknown";

export interface ReviewEntry {
  path: string;
  action: EditAction;
  by: string;
  at: string;
  previous: unknown;
  next: unknown;
}

export interface Field {
  value: string | null;
  label: Label;
  source: SourceRef | null;
  /** One plain sentence: why this label (e.g. 'torque chart, Valve Plugs row'). */
  basis: string;
  struck?: boolean;
  review?: ReviewEntry;
}

// ─────────────────────────────────────────────── CAT Pumps data sheet (parts list + kits)

export interface ModelScope {
  /** Models a row/section explicitly applies to ("Model 3560 Only" → ["3560"]). Empty = all. */
  include: string[];
  /** Models explicitly excluded ("All models except 3560" → ["3560"]). */
  exclude: string[];
  /** The manual restricts this block to some models or hardware variants but the restriction could
   *  not be resolved to a model list (e.g. "Hi-Pressure Seal Models:"). Never admitted to a packet —
   *  the builder lists it as Unknown instead of guessing which alternative applies. */
  unresolved?: boolean;
}

export interface DsPart {
  item: number | null;
  partNumber: string;
  material: string | null;
  description: string;
  qtyRaw: string;
  /** Resolved per model when the qty column is per-model ("1–2" style); null when ambiguous. */
  qtyByModel: Record<string, number> | null;
  qtyStatus: "single" | "per_model" | "ambiguous";
  /** Models the row applies to (description "(Model 3520C)" etc.); all sheet models when unstated. */
  appliesTo: string[];
  section: "parts" | "optional" | "service";
  source: SourceRef;
}

export interface DsKitItem {
  item: number | null;
  description: string;
  qtyRaw: string;
  /** material column header → part number (null where the sheet leaves that material blank). */
  partsByMaterial: Record<string, string | null>;
  source: SourceRef;
}

export interface DsKitNumbers {
  models: string[];
  /** material column header (e.g. "NBR (STD)", "FPM (.0110)") → kit number, null if blank. */
  byMaterial: Record<string, string | null>;
  source: SourceRef;
}

export interface DsKit {
  kind: "seal" | "valve";
  /** "Two (2) valve kits required per pump" → 2. */
  perPump: number | null;
  perPumpSource: SourceRef | null;
  materials: string[];
  kitNumbers: DsKitNumbers[];
  items: DsKitItem[];
}

export interface DsSpec {
  /** e.g. "crankcase_capacity", "flow", "pressure", "rpm", "bore", "stroke", "weight". */
  key: string;
  label: string;
  value: string;
  source: SourceRef;
}

export interface DataSheet {
  kind: "catpumps_datasheet";
  models: string[];
  parts: DsPart[];
  kits: DsKit[];
  specs: DsSpec[];
  /** Plain sentences describing anything that could not be parsed safely (never guessed). */
  problems: string[];
}

// ─────────────────────────────────────────────── CAT Pumps service manual

export type Topic = "valves" | "seals" | "plungers" | "crankcase" | "lubrication";

export interface SmStep {
  n: number | null;
  /** Verbatim step text (wrapped lines joined with single spaces). */
  text: string;
  source: SourceRef;
}

export interface SmSection {
  /** e.g. "SERVICING THE VALVES". */
  heading: string;
  /** e.g. "Disassembly (All models except 3560)". */
  subheading: string | null;
  topic: Topic | "other";
  models: ModelScope;
  steps: SmStep[];
  page: number;
}

export interface SmTorque {
  item: string;
  /** Bracketed part number of the fastener/tool, e.g. "[33048]" → "33048". */
  partNumber: string | null;
  thread: string | null;
  tool: string | null;
  inLbs: string | null;
  ftLbs: string | null;
  nm: string | null;
  models: ModelScope;
  /** in-lbs ≈ ft-lbs × 12 and Nm ≈ ft-lbs × 1.356 within 2 %; false rows must not be used. */
  consistent: boolean;
  source: SourceRef;
}

export interface SmCaution {
  kind: "CAUTION" | "WARNING" | "NOTE" | "IMPORTANT";
  text: string;
  source: SourceRef;
}

/** A procedure section the parser detected but left out (steps garbled in extraction). */
export interface SmOmittedSection {
  heading: string;
  subheading: string | null;
  topic: Topic | "other";
  models: ModelScope;
  page: number;
  /** First line the parser saw in the section, so the gap cites where to look. */
  source: SourceRef;
  reason: string;
}

/** A caution/warning the parser could not read in full (Codex #5062 F15). */
export interface SmOmittedCaution {
  kind: SmCaution["kind"];
  source: SourceRef;
  reason: string;
}

export interface ServiceManual {
  kind: "catpumps_service_manual";
  /** Every model the manual's cover/title names (e.g. "3520", "3521", "3527", …). */
  modelsCovered: string[];
  sections: SmSection[];
  torque: SmTorque[];
  cautions: SmCaution[];
  problems: string[];
  /** Sections left out of `sections` (Codex #5062 F12) — a packet must show these as gaps. */
  omitted?: SmOmittedSection[];
  /** Cautions left out of `cautions` — a packet must show these in Safety as unknown. */
  omittedCautions?: SmOmittedCaution[];
}

// ─────────────────────────────────────────────── work order, identity, packet

/** Entered in the panel. Never written to work_orders / CMMS. `synthetic` is stamped on every export. */
export interface WorkOrderInput {
  id: string;
  title: string;
  description: string;
  assetTag: string | null;
  site: string | null;
  synthetic: boolean;
}

export interface Identity {
  manufacturer: string | null;
  model: string | null;
  catalogNumber: string | null;
  serialNumber: string | null;
  /** equipment_notebooks.identity_status — drafting requires "user_confirmed" or "verified". */
  status: string;
  confidence: number | null;
}

export interface PacketDocument {
  docId: string;
  fileId: string | null;
  filename: string | null;
  role: "datasheet" | "service_manual" | "other";
  /** Pages where the identified model (or catalog number) appears verbatim. */
  modelFoundOn: number[];
  via: "file" | "chunks";
  /** Revision read verbatim from the document footer (`PN … Rev …`); `unknown` when absent. */
  revision: Field;
}

export interface PacketPart {
  kit: "seal" | "valve" | null;
  item: number | null;
  partNumber: Field;
  description: Field;
  qty: Field;
}

export interface PacketStep {
  section: string;
  topic: Topic | "other";
  text: Field;
}

export interface PacketMeasurement {
  name: Field;
  /** e.g. "870 in-lbs / 72.5 ft-lbs / 98 Nm" — verbatim numbers from one torque-chart line. */
  value: Field;
  tool: Field;
}

export interface WorkPacket {
  version: 1;
  packetId: string;
  generatedAt: string;
  notebookId: string;
  /** Fixed text: draft from manufacturer documents, requires qualified review, not a diagnosis. */
  disclaimer: string;
  equipment: { manufacturer: Field; model: Field; serial: Field; identityStatus: string };
  /** The confirmed identity the packet was built for, as entered (Codex #5062 F13). A saved packet
   *  without it, or whose snapshot differs from the notebook's current identity, is stale. */
  identitySnapshot?: { manufacturer: string | null; model: string | null; catalogNumber: string | null };
  workOrder: WorkOrderInput;
  documents: PacketDocument[];
  /** Topics selected from the work-order text; label "proposed", basis names the matched words. */
  scope: Field[];
  safety: {
    cautions: Field[];
    /** Always label "unknown", value null: the site owns isolation/lockout. */
    siteIsolation: Field;
    /** Raised by the Hub's existing safety classifier on the work-order text (route computes it). */
    hazardFlags: string[];
  };
  parts: PacketPart[];
  tools: Field[];
  steps: PacketStep[];
  measurements: PacketMeasurement[];
  unknowns: Field[];
  approval: {
    technicianReview: { state: "draft" | "reviewed"; entries: ReviewEntry[] };
    supervisor: { state: "pending" | "approved"; by: string | null; at: string | null };
  };
}

export type DraftRefusal =
  /** The work-order text asks for hands-on work on energized equipment: the route serves the Hub's
   *  existing stop text bare (no hazard banner over a stop — owner decision D5, #4372). */
  | "safety_stop"
  | "identity_not_confirmed"
  /** The confirmed manufacturer is not CAT Pumps (or is blank) — these parsers only read CAT Pumps documents. */
  | "manufacturer_not_supported"
  | "no_documents"
  | "unsupported_documents"
  | "model_not_in_documents"
  | "no_task_matched"
  /** The technician did not confirm every attached document revision, or a revision changed since. */
  | "revision_not_confirmed";

export type DraftResult =
  | { ok: true; packet: WorkPacket; warnings: string[] }
  | { ok: false; reason: DraftRefusal; message: string };

export interface DraftInput {
  notebookId: string;
  packetId: string;
  now: string;
  identity: Identity;
  workOrder: WorkOrderInput;
  docs: DocText[];
  hazardFlags: string[];
}

export interface PacketEdit {
  /** Dotted path into the packet, e.g. "parts[2].qty", "tools[0]", "steps[3].text", "measurements[1].value". */
  path: string;
  action: EditAction;
  value?: string;
}

/** GET /api/equipment-notebooks/[id]/work-packet response. */
export interface WorkPacketAvailability {
  enabled: true;
  identity: Identity;
  documents: PacketDocument[];
  /** null when a draft can be built; otherwise the first refusal a POST would return. */
  blocking: { reason: DraftRefusal; message: string } | null;
}
