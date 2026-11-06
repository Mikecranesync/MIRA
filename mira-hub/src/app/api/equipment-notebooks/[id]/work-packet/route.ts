/**
 * Work Packet (#4982) — GET availability / POST draft for one equipment notebook.
 *
 * GET  → `WorkPacketAvailability`: the confirmed identity, every attached
 *        document classified (CAT Pumps data sheet / service manual / other)
 *        with the pages its model was found on, and — when a draft could NOT
 *        yet be built — the first of the non-text-dependent refusals
 *        (`identity_not_confirmed` | `manufacturer_not_supported` | `no_documents` | `unsupported_documents` |
 *        `model_not_in_documents`). `no_task_matched` is deliberately NOT
 *        evaluated here: it depends on the work-order text, which does not
 *        exist until POST, and reporting it on every GET (before the
 *        technician has typed anything) would misreport a ready notebook as
 *        blocked.
 * POST { workOrder } → `DraftResult` (200 `{ok:true,...}` / 422 `{ok:false,...}`).
 *        Builds the `DraftInput` and delegates every OTHER refusal, the
 *        topic/kit/step/measurement assembly and the verify-before-return
 *        guarantee to `buildDraftPacket` (owned by agent C).
 *
 * Off unless `NOTEBOOK_WORK_PACKET=1` (404 `not_enabled`), exactly like the
 * guided-procedure route's `guidedProcedureEnabled()` kill switch.
 *
 * Safety on the work-order text (title + description) ONLY, via the existing
 * pure classifiers — never `validateAnswer`, `semanticSafetyCheck` or
 * `@/lib/agents/safety-alert`:
 *   1. `energizedHardStopEnabled() && isEnergizedWorkAsk(text)` → terminal
 *      `safety_stop`, the shared `SAFETY_STOP` text served BARE (no
 *      `hazardBanner` on top of it — owner decision D5, #4372). This mirrors
 *      the notebook chat route's own energized-work gate (`chat/route.ts`
 *      ~1960), but WITHOUT that route's lockout-citation retrieval pass: this
 *      is a draft-document tool with no chat/provider turn to frame, so the
 *      static stop text is served as-is.
 *   2. Otherwise `notebookSafetyTrigger(text)` → a FLAG only
 *      (`hazardFlags:[hazardBanner(t)]`), never a block. The route computes
 *      this and hands it to `buildDraftPacket`, which stamps it onto
 *      `packet.safety.hazardFlags` verbatim.
 *
 * Read-only toward the DB: no row is written here (not to the notebook, not
 * to work_orders/CMMS — `workOrder` is never persisted, only echoed back
 * inside the packet with `synthetic` stamped).
 */
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, type EquipmentNotebook } from "@/lib/equipment-notebooks";
import { loadNotebookDocTexts, withoutDrawingCandidates } from "@/capabilities/work-packet/document-text";
import { parseCatPumpsDataSheet, sheetModelFor } from "@/capabilities/work-packet/catpumps-datasheet";
import { parseCatPumpsServiceManual } from "@/capabilities/work-packet/catpumps-service-manual";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import { isSupportedManufacturer, manufacturerRefusalMessage } from "@/capabilities/work-packet/manufacturer";
import { documentRevision } from "@/capabilities/work-packet/revision";
import {
  extractCanonicalDrawingText,
  mergeDrawingPhotos,
  parseDrawingSourceText,
  type DrawingSheetPhoto,
} from "@/capabilities/work-packet/drawing";
import { buildConnectionPacket } from "@/capabilities/work-packet/drawing-packet";
import type {
  DataSheet,
  DocText,
  DraftInput,
  DraftRefusal,
  DraftResult,
  Identity,
  PacketDocument,
  ServiceManual,
  WorkOrderInput,
  WorkPacketAvailability,
} from "@/capabilities/work-packet/types";
import { energizedHardStopEnabled } from "@/capabilities/energized-work-stop";
import { SAFETY_STOP, hazardBanner, isEnergizedWorkAsk, notebookSafetyTrigger } from "@/lib/safety-classifier";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ id: string }> };

/** Default OFF — mirrors `guidedProcedureEnabled()` in `guided-procedure-store.ts`.
 *  Exported (2026-11-04, drawing connection packet Worker Task 2) so the sibling
 *  `drawing-photos` routes share the exact same flag check — no second flag. */
export function workPacketEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.NOTEBOOK_WORK_PACKET ?? "").trim() === "1";
}

function identityOf(nb: EquipmentNotebook): Identity {
  return {
    manufacturer: nb.manufacturer,
    model: nb.model,
    catalogNumber: nb.catalogNumber,
    serialNumber: nb.serialNumber,
    status: nb.identityStatus,
    confidence: nb.identityConfidence,
  };
}

function identityConfirmed(identity: Identity): boolean {
  return identity.status === "user_confirmed" || identity.status === "verified";
}

/** Pages where the identified model (or catalog number) appears verbatim —
 *  a plain, case-insensitive substring scan, independent of either parser. */
function modelFoundOn(doc: DocText, identity: Identity): number[] {
  const needles = [identity.model, identity.catalogNumber]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase());
  if (needles.length === 0) return [];
  const pages: number[] = [];
  for (const p of doc.pages) {
    const haystack = p.text.toLowerCase();
    if (needles.some((n) => haystack.includes(n))) pages.push(p.page);
  }
  return pages;
}

interface Classified {
  doc: DocText;
  role: PacketDocument["role"];
  ds: DataSheet | null;
  sm: ServiceManual | null;
}

/** Tries both CAT Pumps parsers once per doc (A's data-sheet parser first,
 *  then B's service-manual parser) and keeps whichever recognized it. */
function classifyAll(docs: DocText[]): Classified[] {
  return docs.map((doc) => {
    const ds = parseCatPumpsDataSheet(doc);
    const sm = ds ? null : parseCatPumpsServiceManual(doc);
    const role: PacketDocument["role"] = ds ? "datasheet" : sm ? "service_manual" : "other";
    return { doc, role, ds, sm };
  });
}

function toPacketDocuments(classified: Classified[], identity: Identity): PacketDocument[] {
  return classified.map(({ doc, role }) => ({
    docId: doc.docId,
    fileId: doc.fileId,
    filename: doc.filename,
    role,
    modelFoundOn: modelFoundOn(doc, identity),
    via: doc.via,
    revision: documentRevision(doc),
  }));
}

/** The first of the non-text-dependent refusals (see file header), or null
 *  when nothing here stops a draft — `no_task_matched` is POST-only. */
function availabilityBlocking(
  identity: Identity,
  classified: Classified[],
): { reason: DraftRefusal; message: string } | null {
  if (!identityConfirmed(identity)) {
    return {
      reason: "identity_not_confirmed",
      message: "Confirm this machine's identity before preparing a job packet.",
    };
  }
  if (!isSupportedManufacturer(identity.manufacturer)) {
    return { reason: "manufacturer_not_supported", message: manufacturerRefusalMessage(identity.manufacturer) };
  }
  if (classified.length === 0) {
    return {
      reason: "no_documents",
      message: "Attach this machine's CAT Pumps data sheet or service manual in Sources before preparing a job packet.",
    };
  }
  const dataSheets = classified.map((c) => c.ds).filter((v): v is DataSheet => v !== null);
  const manuals = classified.map((c) => c.sm).filter((v): v is ServiceManual => v !== null);
  if (dataSheets.length === 0 && manuals.length === 0) {
    return {
      reason: "unsupported_documents",
      message: "None of the attached documents are a CAT Pumps data sheet or service manual MIRA can read yet.",
    };
  }
  const idForMatch = { model: identity.model, catalogNumber: identity.catalogNumber };
  // Nothing to match against — leave it to buildDraftPacket's own check at POST.
  if (!identity.model && !identity.catalogNumber) return null;
  const onADataSheet = dataSheets.some((ds) => sheetModelFor(idForMatch, ds.models) !== null);
  const onAManual = manuals.some((sm) => sheetModelFor(idForMatch, sm.modelsCovered) !== null);
  if (!onADataSheet && !onAManual) {
    return {
      reason: "model_not_in_documents",
      message: "This machine's model is not named in any attached data sheet or service manual.",
    };
  }
  return null;
}

// ── Connection packet (drawing connection packet, Worker Task 2, 2026-11-04) ──
// A notebook whose sources include at least one photographed engineering
// drawing (kept via the `drawing-photos` routes) can additionally ask for a
// CONNECTION packet — the same `DraftResult` contract, built by Task 1's pure
// `buildConnectionPacket` — instead of (or alongside) the CAT Pumps draft
// above. Triggered ONLY by an explicit `?connection=`/body `connection` ref
// AND the presence of at least one drawing-kind source; otherwise this
// returns `null` and the existing GET/POST logic below runs byte-identical to
// before this change, so every pre-existing CAT-flow behaviour is preserved.


/** Rebuilds `DrawingSheetPhoto[]` from every attached doc that carries `origin` (set by
 *  `document-text.ts::loadNotebookDocTexts` from `equipment_notebook_sources.origin_file_id` +
 *  `match_evidence.drawing_transcription`) and whose text parses as a drawing transcription.
 *  `fileId` is `doc.origin.fileId` — the ORIGINAL photo, never the materialized text doc's own
 *  `fileId` (which is null; see `DocText.origin`'s doc comment). A doc with no `origin`, or whose
 *  text does not parse (a non-drawing kept photo, or a corrupted doc), is silently skipped here —
 *  `mergeDrawingPhotos` additionally skips any parsed `kind !== "drawing"` photo on its own. */
function drawingSheetPhotosFromDocs(docs: readonly DocText[]): DrawingSheetPhoto[] {
  const photos: DrawingSheetPhoto[] = [];
  for (const doc of docs) {
    if (!doc.origin) continue;
    const fullText = doc.pages.map((p) => p.text).join("\n");
    const canonical = extractCanonicalDrawingText(fullText);
    if (canonical === null) continue;
    const t = parseDrawingSourceText(canonical);
    if (!t) continue;
    photos.push({ docId: doc.docId, fileId: doc.origin.fileId, reviewed: doc.origin.drawing?.reviewed ?? false, t });
  }
  return photos;
}

/** `connection` from the query string (GET and POST) or, POST only, the JSON body. Reads the query
 *  string via `new URL(req.url)` rather than `req.nextUrl` — identical on a real `NextRequest` in
 *  production, but also works against a plain `Request` (every route test in this family
 *  constructs its fixtures with the bare `Request` constructor, not `NextRequest`). */
function connectionRefFrom(req: NextRequest, body?: unknown): string | null {
  return paramFrom(req, body, "connection");
}

/** A string parameter from the query string or, POST only, the JSON body. */
function paramFrom(req: NextRequest, body: unknown, name: string): string | null {
  const q = new URL(req.url).searchParams.get(name);
  if (q && q.trim()) return q.trim();
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const c = (body as Record<string, unknown>)[name];
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Returns a `DraftResult` when the caller asked for a connection packet AND the notebook has at
 *  least one drawing-kind source; `null` otherwise, letting the caller's existing logic run
 *  unchanged (no `connection` ref given, or no drawing sources attached yet — the ordinary
 *  CAT-flow refusal path reports that case, not this one). */
function buildConnectionPacketIfPresent(opts: {
  req: NextRequest;
  body: unknown;
  notebookId: string;
  identity: Identity;
  docs: DocText[];
  workOrder: WorkOrderInput;
  /** The route's already-classified work-order hazard flags (Codex #5204 F5). */
  hazardFlags?: readonly string[];
}): DraftResult | null {
  const connectionRef = connectionRefFrom(opts.req, opts.body);
  if (!connectionRef) return null;
  const sheets = mergeDrawingPhotos(drawingSheetPhotosFromDocs(opts.docs));
  if (sheets.length === 0) return null;
  return buildConnectionPacket({
    notebookId: opts.notebookId,
    packetId: randomUUID(),
    now: new Date().toISOString(),
    identity: opts.identity,
    workOrder: opts.workOrder,
    sheets,
    connectionRef,
    // Which drawing, when the connection id is on more than one (Codex #5204 F2).
    drawing: paramFrom(opts.req, opts.body, "drawing"),
    docs: opts.docs,
    hazardFlags: opts.hazardFlags ?? [],
  });
}

const MAX_WO_ID = 200;
const MAX_WO_TITLE = 300;
const MAX_WO_DESCRIPTION = 4000;
const MAX_WO_TAG = 200;

type WorkOrderParse = { ok: true; workOrder: WorkOrderInput } | { ok: false; error: string };

/** Strict validation of the work-order body — lengths and types only, never
 *  written anywhere (`workOrder` is echoed back inside the packet, never
 *  persisted to work_orders/CMMS). */
/** `confirmedRevisions: [{docId, revision}]` from the panel's "I checked the revisions" step.
 *  Malformed or absent → [] (which then refuses `revision_not_confirmed`). */
function parseConfirmedRevisions(body: unknown): { docId: string; revision: string | null }[] {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>).confirmedRevisions : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const r = c as Record<string, unknown>;
    if (typeof r.docId !== "string" || !(typeof r.revision === "string" || r.revision === null)) return [];
    return [{ docId: r.docId, revision: r.revision as string | null }];
  });
}

function parseWorkOrder(body: unknown): WorkOrderParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "A work order is required." };
  }
  const wo = (body as Record<string, unknown>).workOrder;
  if (!wo || typeof wo !== "object" || Array.isArray(wo)) {
    return { ok: false, error: "A work order is required." };
  }
  const r = wo as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 && t.length <= max ? t : t.length === 0 ? "" : null;
  };
  const id = str(r.id, MAX_WO_ID);
  const title = str(r.title, MAX_WO_TITLE);
  if (id === null || !id) return { ok: false, error: "The work order needs an id." };
  if (title === null || !title) return { ok: false, error: "The work order needs a title." };
  if (typeof r.description !== "string" || r.description.length > MAX_WO_DESCRIPTION) {
    return { ok: false, error: "The work order's description is missing or too long." };
  }
  let assetTag: string | null = null;
  if (r.assetTag !== null && r.assetTag !== undefined) {
    const t = str(r.assetTag, MAX_WO_TAG);
    if (t === null) return { ok: false, error: "The asset tag is invalid or too long." };
    assetTag = t || null;
  }
  let site: string | null = null;
  if (r.site !== null && r.site !== undefined) {
    const t = str(r.site, MAX_WO_TAG);
    if (t === null) return { ok: false, error: "The site is invalid or too long." };
    site = t || null;
  }
  if (typeof r.synthetic !== "boolean") {
    return { ok: false, error: "The work order must say whether it is synthetic." };
  }
  return {
    ok: true,
    workOrder: { id, title, description: r.description, assetTag, site, synthetic: r.synthetic },
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!workPacketEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  try {
    const notebook = await getNotebook(ctx.tenantId, id);
    if (!notebook) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

    const identity = identityOf(notebook);
    // A connection request also admits unreviewed drawing candidates (values stay Proposed —
    // Codex #5204 F6); every other path sees only the notebook's enabled sources.
    const loaded = await loadNotebookDocTexts(ctx.tenantId, id, {
      includeDrawingCandidates: connectionRefFrom(req) !== null,
    });

    // Connection packet (drawing-photo sources) — GET has no work-order, so a
    // synthetic placeholder stands in; `buildConnectionPacket` stamps
    // `synthetic: true` through to the packet same as any other synthetic WO.
    const connectionResult = buildConnectionPacketIfPresent({
      req,
      body: undefined,
      notebookId: id,
      identity,
      docs: loaded,
      workOrder: {
        id: `connection-${Date.now()}`,
        title: "Connection packet preview",
        description: "",
        assetTag: null,
        site: null,
        synthetic: true,
      },
    });
    if (connectionResult) {
      return NextResponse.json(connectionResult, { status: connectionResult.ok ? 200 : 422 });
    }

    const docs = withoutDrawingCandidates(loaded);
    const classified = classifyAll(docs);
    const body: WorkPacketAvailability = {
      enabled: true,
      identity,
      documents: toPacketDocuments(classified, identity),
      blocking: availabilityBlocking(identity, classified),
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[api/equipment-notebooks work-packet GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!workPacketEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = parseWorkOrder(rawBody);
  if (!parsed.ok) return NextResponse.json({ error: "invalid_body", message: parsed.error }, { status: 400 });
  const workOrder = parsed.workOrder;
  const confirmedRevisions = parseConfirmedRevisions(rawBody);

  try {
    const notebook = await getNotebook(ctx.tenantId, id);
    if (!notebook) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

    // SAFETY, on the work-order text only — see file header for the two gates.
    const safetyText = `${workOrder.title}\n${workOrder.description}`;
    if (energizedHardStopEnabled() && isEnergizedWorkAsk(safetyText)) {
      const refusal: DraftResult = { ok: false, reason: "safety_stop", message: SAFETY_STOP };
      return NextResponse.json(refusal, { status: 422 });
    }
    const hazardFlags: string[] = [];
    const trigger = notebookSafetyTrigger(safetyText);
    if (trigger) hazardFlags.push(hazardBanner(trigger));

    const identity = identityOf(notebook);
    const loaded = await loadNotebookDocTexts(ctx.tenantId, id, {
      includeDrawingCandidates: connectionRefFrom(req, rawBody) !== null,
    });

    const connectionResult = buildConnectionPacketIfPresent({
      req,
      body: rawBody,
      notebookId: id,
      identity,
      docs: loaded,
      workOrder,
      hazardFlags,
    });
    if (connectionResult) {
      return NextResponse.json(connectionResult, { status: connectionResult.ok ? 200 : 422 });
    }
    const docs = withoutDrawingCandidates(loaded);

    const input: DraftInput = {
      notebookId: id,
      packetId: randomUUID(),
      now: new Date().toISOString(),
      identity,
      workOrder,
      docs,
      hazardFlags,
    };
    const result = buildDraftPacket(input);
    if (!result.ok) return NextResponse.json(result, { status: 422 });
    // The technician confirmed the machine and each manual revision in the panel; the packet records
    // exactly which revisions, by whom and when. Any document whose current revision was not the one
    // confirmed (changed since, or never shown) refuses the draft rather than printing a stale check.
    const by = ctx.email || ctx.userId;
    for (const [i, d] of result.packet.documents.entries()) {
      const want = d.revision.value ?? null;
      if (!confirmedRevisions.some((c) => c.docId === d.docId && c.revision === want)) {
        const refusal: DraftResult = {
          ok: false,
          reason: "revision_not_confirmed",
          message: "The manual revisions were not confirmed, or changed since you checked them. Re-check the documents list and confirm again.",
        };
        return NextResponse.json(refusal, { status: 422 });
      }
      result.packet.approval.technicianReview.entries.push({
        path: `documents[${i}].revision`, action: "confirm", by, at: input.now, previous: null, next: want,
      });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[api/equipment-notebooks work-packet POST]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
