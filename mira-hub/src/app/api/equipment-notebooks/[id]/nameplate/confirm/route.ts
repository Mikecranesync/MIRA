/**
 * POST /api/equipment-notebooks/[id]/nameplate/confirm
 *
 * The technician has corrected the vision candidate and pressed Confirm. Two
 * things happen, in this order:
 *
 *  1. The confirmed nameplate becomes a CITABLE SOURCE — deterministic plain
 *     text (raw extraction + corrected identity + confidence + the canonical
 *     photo's file id) ingested through ingestTextToNode, attached to the
 *     notebook as sourceRole "photo" / matchState "user_confirmed". The
 *     technician's correction is now evidence chat can quote, not a form field.
 *
 *  2. Optionally, MIRA goes looking for the official manual. Discovery →
 *     hardened download → ingest → applicability check against THAT document's
 *     own chunks. A manual is only enabled for chat when its text proves it
 *     covers this component; otherwise it is attached DISABLED as a candidate
 *     for the technician to confirm. A search-result title is never evidence.
 *
 * What this route deliberately does NOT do: write the notebook's identity
 * fields. The nameplate belongs to a COMPONENT inside the machine, not to the
 * machine. Overwriting the notebook's manufacturer/model with a drive's
 * nameplate would silently rename the ride after one of its parts.
 *
 * Business outcomes are HTTP 200 with a `status` the mobile client maps
 * directly; only auth and request-shape failures use 4xx.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  getNotebook,
  attachSource,
  setSourceState,
  findVisibleOriginSource,
  supersedePriorOriginSources,
} from "@/lib/equipment-notebooks";
import { getFile, parkOrReuseFile, linkFileToUpload, attachFileToTargets, claimIngest, releaseIngestClaim } from "@/lib/workspace-files";
import { ingestTextToNode, ingestPdfToNode, deleteOrphanNodeIngest, NoExtractableTextError } from "@/lib/node-knowledge-ingest";
import { discoverManual, allowedHostsForCandidate, isOemDocumentationHost } from "@/lib/manual-discovery";
import { safeDownloadPdf, safePdfFilename } from "@/lib/safe-download";
import { assessApplicability, type ApplicabilityVerdict } from "@/lib/manual-applicability";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Manuals are big; 80 MB is generous for an OEM PDF and still bounded. */
const MAX_MANUAL_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Identity evidence lives near the front of a manual — bound the scan. */
const APPLICABILITY_CHUNK_LIMIT = 80;

export type ConfirmStatus =
  | "complete"
  | "candidate_review"
  | "no_manual_found"
  | "search_unavailable"
  | "no_extractable_text"
  | "manufacturer_model_required"
  | "nameplate_not_indexed"
  | "download_rejected";

const IDENTITY_FIELDS = [
  "manufacturer",
  "model",
  "catalogNumber",
  "serialNumber",
  "equipmentType",
  "voltage",
  "fullLoadAmps",
  "horsepower",
  "frequency",
  "rpm",
] as const;
type IdentityField = (typeof IDENTITY_FIELDS)[number];
type Identity = Partial<Record<IdentityField, string>>;

const IDENTITY_LABELS: Record<IdentityField, string> = {
  manufacturer: "Manufacturer",
  model: "Model",
  catalogNumber: "Catalog number",
  serialNumber: "Serial number",
  equipmentType: "Equipment type",
  voltage: "Voltage",
  fullLoadAmps: "Full load amps",
  horsepower: "Horsepower",
  frequency: "Frequency",
  rpm: "RPM",
};

function readIdentity(raw: unknown): Identity {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: Identity = {};
  for (const f of IDENTITY_FIELDS) {
    const v = o[f];
    if (typeof v === "string" && v.trim()) out[f] = v.trim().slice(0, 200);
    else if (typeof v === "number" && Number.isFinite(v)) out[f] = String(v);
  }
  return out;
}

/**
 * The citable nameplate document. Deterministic by construction: no timestamps,
 * no random ids beyond the inputs themselves, so re-confirming identical input
 * produces identical bytes.
 */
function buildNameplateText(opts: {
  notebookName: string;
  fileId: string;
  identity: Identity;
  confidence: number | null;
  rawObservation: unknown;
}): string {
  const lines: string[] = [];
  lines.push("EQUIPMENT NAMEPLATE — TECHNICIAN-CONFIRMED");
  lines.push("");
  lines.push(`Machine notebook: ${opts.notebookName}`);
  lines.push(`Canonical nameplate photo (file id): ${opts.fileId}`);
  lines.push(
    `Recognition confidence: ${opts.confidence === null ? "not reported" : opts.confidence.toFixed(2)}`,
  );
  lines.push("");
  lines.push("CONFIRMED IDENTITY (as corrected by the technician)");
  const present = IDENTITY_FIELDS.filter((f) => opts.identity[f]);
  if (present.length === 0) {
    lines.push("- (no identity fields were confirmed)");
  } else {
    for (const f of present) lines.push(`- ${IDENTITY_LABELS[f]}: ${opts.identity[f]}`);
  }
  lines.push("");
  lines.push("RAW NAMEPLATE OBSERVATION (unedited vision extraction)");
  const raw = opts.rawObservation as { rawText?: unknown; provider?: unknown } | null;
  const rawText = Array.isArray(raw?.rawText) ? (raw!.rawText as unknown[]) : [];
  if (raw?.provider) lines.push(`- reader: ${String(raw.provider)}`);
  if (rawText.length === 0) {
    lines.push("- (no raw text was returned by the reader)");
  } else {
    for (const t of rawText.slice(0, 60)) lines.push(`- ${String(t).slice(0, 300)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * The chunks of ONE document, for the applicability check. A plain read of the
 * document's own materialized text — not a retrieval query, and not link SQL.
 */
async function chunksForDoc(
  tenantId: string,
  docId: string,
): Promise<Array<{ content: string; page: number | null }>> {
  try {
    return await withTenantContext(tenantId, async (c) => {
      const r = await c.query<{ content: string; source_page: number | null }>(
        `SELECT content, source_page
           FROM knowledge_entries
          WHERE tenant_id = $1 AND doc_id = $2::uuid
          ORDER BY (metadata->>'chunk_index')::int NULLS LAST
          LIMIT $3`,
        [tenantId, docId, APPLICABILITY_CHUNK_LIMIT],
      );
      return r.rows.map((row) => ({
        content: row.content ?? "",
        page: row.source_page === null ? null : Number(row.source_page),
      }));
    });
  } catch {
    // A read failure must not turn into a false "verified" — no chunks means
    // no evidence means the manual stays a candidate.
    return [];
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id: notebookId } = await params;

  if (!UUID_RE.test(notebookId)) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!UUID_RE.test(fileId)) {
    return NextResponse.json({ error: "invalid_file_id" }, { status: 400 });
  }

  const notebook = await getNotebook(ctx.tenantId, notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }

  // The photo must belong to this tenant AND already be linked to THIS notebook.
  // Anything else is indistinguishable from "not found".
  const parked = await getFile(ctx.tenantId, fileId);
  const linkedHere =
    parked?.links.some((l) => l.targetType === "equipment_notebook" && l.targetId === notebookId) ??
    false;
  if (!parked || !linkedHere) {
    return NextResponse.json({ error: "file_not_found" }, { status: 404 });
  }

  const identity = readIdentity(body.identity);
  const confidence =
    typeof body.confidence === "number" && Number.isFinite(body.confidence)
      ? Math.min(1, Math.max(0, body.confidence))
      : null;
  // 085 Invariant 4: the mobile client has always sent this; the route used to
  // drop it. It names the logical confirmation, so a retry of the SAME
  // confirmation never reprocesses (vision drift on a retry must not mint a
  // new derived reading). The evidence identity itself is (notebook, photo) —
  // never the derived text bytes.
  const clientKey =
    typeof body.clientKey === "string" && body.clientKey.length > 0 && body.clientKey.length <= 128
      ? body.clientKey
      : null;

  // ── (b) Materialize the confirmed nameplate as a citable source ────────────
  const text = buildNameplateText({
    notebookName: notebook.displayName,
    fileId,
    identity,
    confidence,
    rawObservation: body.rawObservation ?? null,
  });
  const textBuffer = Buffer.from(text, "utf8");
  const nameplateFilename = `nameplate-${fileId}.txt`;

  // Idempotent + raced-safe (Codex P1, 2026-08-16): the nameplate text is
  // deterministic bytes, so it goes through the SAME canonical-file dedup +
  // atomic ingestion claim as every other document. A repeated confirmation
  // REUSES the existing doc instead of minting another document/chunk set;
  // concurrent confirmations cannot double-ingest.
  let nameplateDocId: string | null = null;
  let nameplateChunks = 0;
  let nameplateIngestFailed = false;
  // Same clientKey + an existing visible derived doc for this photo = a replay
  // of the SAME logical confirmation. Reuse the existing doc verbatim — no
  // re-park, no re-ingest, no new reading.
  const existingOrigin = await findVisibleOriginSource(ctx.tenantId, notebookId, fileId).catch(
    () => null,
  );
  const replayOfSameConfirm = Boolean(
    clientKey &&
      existingOrigin &&
      (existingOrigin.matchEvidence as { confirm_client_key?: unknown } | null)
        ?.confirm_client_key === clientKey,
  );
  if (replayOfSameConfirm) {
    nameplateDocId = existingOrigin!.docId;
  } else
  try {
    const parkedText = await parkOrReuseFile({
      tenantId: ctx.tenantId,
      filename: nameplateFilename,
      mimeType: "text/plain",
      sizeBytes: textBuffer.length,
      buffer: textBuffer,
      createdBy: ctx.userId ?? null,
      nodeId: notebook.nodeId,
      source: "nameplate_text",
    });
    nameplateDocId = parkedText.uploadId;
    if (nameplateDocId === null) {
      const claim = await claimIngest(ctx.tenantId, parkedText.fileId);
      if (claim.claimed) {
        try {
          const ingested = await ingestTextToNode({
            tenantId: ctx.tenantId,
            nodeId: notebook.nodeId,
            unsPath: null,
            filename: nameplateFilename,
            mimeType: "text/plain",
            sizeBytes: textBuffer.length,
            buffer: textBuffer,
          });
          nameplateChunks = ingested.chunkCount;
          // Token-fenced finalize: only claim the pointer if we still own the
          // claim. If ownership was lost (stale-window takeover), our ingest is
          // orphaned — do NOT treat the doc as ours.
          const won = await linkFileToUpload(
            ctx.tenantId,
            parkedText.fileId,
            ingested.uploadId,
            claim.claimToken,
          );
          nameplateDocId = won ? ingested.uploadId : null;
          // Fence lost: our fully-ingested doc duplicates the winner's chunk
          // set. Remove it — leaving it would recreate the duplicate-corpus
          // bug the claim exists to prevent (best-effort, never throws).
          if (!won) await deleteOrphanNodeIngest(ctx.tenantId, ingested.uploadId);
        } catch (err) {
          await releaseIngestClaim(ctx.tenantId, parkedText.fileId, claim.claimToken).catch(() => {});
          throw err;
        }
      } else if (claim.reason === "already_ingested" && claim.uploadId) {
        nameplateDocId = claim.uploadId;
      }
      // ingest_in_progress: a concurrent confirm is materializing the same
      // bytes right now — do not double-ingest; report partial below.
    }
    if (nameplateDocId !== null) {
      // Attached by DOC id, not by file link: the generated nameplate text has
      // no meaningful byte record for the user (the canonical PHOTO is the
      // parked file, and it is already linked). attachSource is the honest
      // seam for "a document that exists as an indexed doc".
      const att = await attachSource(ctx.tenantId, notebookId, nameplateDocId, {
        matchState: "user_confirmed",
        sourceRole: "photo",
        addedBy: ctx.userId ?? null,
        // 084: the photograph IS the object this doc derives from. The viewer
        // opens the photo as the primary experience; the generated text
        // becomes "source details". Re-confirming (idempotent replay) heals
        // pre-084 rows via the upsert's set-if-provided semantics.
        originFileId: fileId,
        // 085: audit trail — which logical confirmation produced this reading.
        matchEvidence: clientKey ? { confirm_client_key: clientKey } : undefined,
      });
      // attachSource reports failure by RETURN VALUE, not throw. Without the
      // source row the doc is not citable in this notebook — fail closed.
      if (!att.ok) throw new Error(`attach_source_failed: ${att.error}`);
      // 085 Invariant 1: one photograph = one visible source. An edited
      // re-confirm produced a NEW derived doc — the prior readings of the
      // same photo are superseded (hidden, retained for citation resolution).
      // Best-effort: a supersede failure leaves an extra visible row, which
      // must not fail a confirm that already attached its source.
      try {
        const superseded = await supersedePriorOriginSources(
          ctx.tenantId,
          notebookId,
          fileId,
          nameplateDocId,
        );
        if (superseded.length > 0) {
          console.log(
            `[nameplate-confirm] superseded ${superseded.length} prior reading(s) of photo ${fileId}: ${superseded.join(", ")}`,
          );
        }
      } catch (err) {
        console.warn(
          `[nameplate-confirm] supersede failed notebook=${notebookId} photo=${fileId}: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[nameplate-confirm] nameplate source ingest failed notebook=${notebookId}: ${
        (err as Error).message
      }`,
    );
    // Fail-closed: an ingested doc WITHOUT a source row is not citable. If the
    // attach step failed after a successful ingest, reporting the docId would
    // let the route claim ingested:true (and march on to discovery) for a
    // nameplate that cannot enter chat. Null it; the retry re-parks the same
    // bytes (dedup returns the existing doc) and re-attaches.
    nameplateDocId = null;
  }
  nameplateIngestFailed = nameplateDocId === null;

  // (c) The notebook's own identity is NOT patched here. See the header.

  const nameplate = {
    docId: nameplateDocId,
    chunkCount: nameplateChunks,
    sourceRole: "photo" as const,
    matchState: "user_confirmed" as const,
    photoFileId: fileId,
    // EXPLICIT partial signal (never a silent ok with docId:null): until this
    // is false, the confirmed nameplate is not yet a citable source.
    ingested: !nameplateIngestFailed,
  };

  const respond = (
    status: ConfirmStatus,
    extra: Record<string, unknown> = {},
  ): NextResponse =>
    NextResponse.json({
      ok: true,
      status,
      notebookId,
      nameplate,
      manual: null,
      candidate: null,
      applicability: null,
      ...extra,
    });

  // FAIL-CLOSED on the nameplate (Codex round 2, 2026-08-16): the
  // technician-confirmed nameplate is the PRIMARY deliverable of this route.
  // If it did not materialize into a citable source, do NOT proceed to manual
  // discovery and NEVER report "complete" — a verified manual must not let the
  // route declare success while the nameplate the tech actually confirmed is
  // missing. The client shows this as "saved, indexing — retry", not done.
  if (nameplateIngestFailed) {
    return respond("nameplate_not_indexed", {
      message:
        "Your nameplate was saved but is still being indexed (or indexing failed). Retry in a moment — the manual search runs once the nameplate is citable.",
    });
  }

  // ── (d) Manual discovery ──────────────────────────────────────────────────
  if (body.discover === false) {
    return respond("complete", {
      message: "Nameplate confirmed. Manual search was not requested.",
      discovery: { requested: false },
    });
  }
  if (!identity.manufacturer || !(identity.model || identity.catalogNumber)) {
    return respond("manufacturer_model_required", {
      message:
        "Add a manufacturer and a model (or catalog number) so MIRA can look for the official manual.",
    });
  }

  const discovery = await discoverManual({
    manufacturer: identity.manufacturer,
    model: identity.model,
    catalogNumber: identity.catalogNumber,
  });
  if (!discovery.serviceAvailable) {
    return respond("search_unavailable", { message: discovery.reason });
  }
  if (!discovery.found || !discovery.candidate) {
    return respond("no_manual_found", {
      message: discovery.reason,
      oemRequestUrl: discovery.oemRequestUrl,
    });
  }

  const candidate = discovery.candidate;
  const candidateView = {
    url: candidate.url,
    title: candidate.title,
    host: candidate.host,
    isDirectPdf: discovery.isDirectPdf,
    validated: discovery.validated,
    oemHost: discovery.oemHost,
  };

  // Auto-import ONLY a validated, direct-PDF, OEM-hosted result.
  const autoImport = discovery.validated && discovery.isDirectPdf && discovery.oemHost;

  // #3400 — let the hardened download, not the search service's flag, decide
  // whether the bytes are retrievable.
  //
  // `validated` means only that the discovery service's own HEAD/Range probe
  // confirmed a PDF. Measured on the reported Siemens candidate: oem_host=true,
  // is_direct_pdf=true, validated=FALSE — while the URL serves a real 1.79 MB
  // %PDF-1.6. The probe failing is a statement about the probe, not about the
  // document. The old gate returned candidate_review before safeDownloadPdf ever
  // ran, so the technician got a primary button that could never do anything.
  //
  // The relaxation is deliberately narrow, and every condition is load-bearing:
  //   - isDirectPdf   : we are not fetching a landing page hoping for a PDF.
  //   - oemHost       : the service's own strict manufacturer-domain check.
  //   - independently : re-derived from OUR OEM table. "Discovery said so" is
  //                     explicitly not sufficient trust on its own, and
  //                     allowedHostsForCandidate cannot serve here because it
  //                     trusts the candidate host by construction.
  // A candidate failing ANY of these keeps the old review path. safeDownloadPdf
  // is unchanged and remains the only fetcher, with every SSRF, redirect,
  // size, MIME and magic-byte guard intact.
  const independentlyOemHosted = isOemDocumentationHost(identity.manufacturer, candidate.host);
  const probeUnvalidated =
    !discovery.validated && discovery.isDirectPdf && discovery.oemHost && independentlyOemHosted;

  if (!autoImport && !probeUnvalidated) {
    return respond("candidate_review", {
      // What discovery actually found out about this file (2026-08-26: the
      // judge reads the PDF and says e.g. "Read the PDF: a lever-hoist
      // brochure, no end-truck model"). The technician decides with that.
      discoveryReason: discovery.reason,
      oemRequestUrl: discovery.oemRequestUrl,
      candidate: candidateView,
      message:
        "MIRA found a possible manual but could not confirm it is the official document. Review it before adding.",
    });
  }

  // A download that succeeds proves the bytes are retrievable and are a real
  // PDF from a host we independently attribute to this manufacturer. It proves
  // NOTHING about whether this is the right document, so an unvalidated
  // candidate can never auto-enable — a human confirms it. See the
  // applicability block below.
  const requiresUserConfirmation = probeUnvalidated;

  const download = await safeDownloadPdf(candidate.url, {
    allowedHosts: allowedHostsForCandidate(identity, candidate),
    maxBytes: MAX_MANUAL_BYTES,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
  if (!download.ok) {
    return respond("download_rejected", {
      candidate: candidateView,
      message: `MIRA would not download that file (${download.reason}). Nothing was added to this notebook.`,
      reason: download.reason,
    });
  }

  const manualFilename = safePdfFilename(download.finalUrl);
  const manualParked = await parkOrReuseFile({
    tenantId: ctx.tenantId,
    filename: manualFilename,
    mimeType: "application/pdf",
    sizeBytes: download.buffer.length,
    buffer: download.buffer,
    createdBy: ctx.userId ?? null,
    nodeId: notebook.nodeId,
    source: "manual_discovery",
  });

  // Exact-byte dedup: the tenant already has these bytes parsed. REUSE the
  // document — never re-parse, never re-chunk (materialized-evidence rule 1).
  let manualDocId: string | null = manualParked.uploadId;
  let manualChunks = 0;
  let scannedPdf = false;
  let manualClaimToken: string | null = null;
  let reused = manualParked.reused && manualParked.uploadId !== null;

  if (!reused && manualDocId === null) {
    // Atomic ingestion claim (Codex P1, 2026-08-16): a concurrent identical
    // confirm may have parked the same bytes moments ago and still be
    // ingesting (upload_id lands only at the end). Exactly one request may
    // ingest; a loser either reuses the finished document or reports an
    // explicit in-progress partial — it never double-ingests.
    const claim = await claimIngest(ctx.tenantId, manualParked.fileId);
    if (claim.claimed) manualClaimToken = claim.claimToken;
    if (!claim.claimed) {
      if (claim.reason === "already_ingested" && claim.uploadId) {
        manualDocId = claim.uploadId;
        reused = true;
      } else {
        return respond("candidate_review", {
          candidate: candidateView,
          manual: {
            fileId: manualParked.fileId,
            docId: null,
            filename: manualFilename,
            discoveryUrl: candidate.url,
            finalUrl: download.finalUrl,
            matchState: null,
            enabledByDefault: false,
            chunkCount: 0,
            indexed: false,
          },
          warning:
            "another request is currently indexing this exact document — retry in a moment to attach it",
        });
      }
    }
  }

  if (!reused && manualDocId === null) {
    try {
      const ing = await ingestPdfToNode({
        tenantId: ctx.tenantId,
        nodeId: notebook.nodeId,
        unsPath: null,
        filename: manualFilename,
        mimeType: "application/pdf",
        sizeBytes: download.buffer.length,
        buffer: download.buffer,
      });
      manualChunks = ing.chunkCount;
      // Token-fenced finalize (see nameplate section): if the claim was stolen
      // mid-ingest, our document is orphaned and must not be reported attached.
      const won = manualClaimToken
        ? await linkFileToUpload(ctx.tenantId, manualParked.fileId, ing.uploadId, manualClaimToken)
        : await linkFileToUpload(ctx.tenantId, manualParked.fileId, ing.uploadId);
      manualDocId = won ? ing.uploadId : null;
      // Fence lost → our doc duplicates the winner's chunk set; remove it.
      if (!won) await deleteOrphanNodeIngest(ctx.tenantId, ing.uploadId);
    } catch (err) {
      if (manualClaimToken) {
        await releaseIngestClaim(ctx.tenantId, manualParked.fileId, manualClaimToken).catch(() => {});
      }
      // A scanned/image-only PDF is a property of the FILE. Keep the bytes
      // (viewable + downloadable), attach the FILE to the notebook so it shows
      // in Files — but with no indexed doc there is no source row, so it can
      // never enter chat. That is the honest outcome, not a silent success.
      scannedPdf =
        err instanceof NoExtractableTextError || /no extractable text/i.test((err as Error).message);
      manualDocId = null;
      await attachFileToTargets(
        ctx.tenantId,
        manualParked.fileId,
        [
          {
            targetType: "equipment_notebook",
            targetId: notebookId,
            role: "manual",
            displayLabel: manualFilename,
          },
        ],
        { createdBy: ctx.userId ?? null },
      );
      return respond(scannedPdf ? "no_extractable_text" : "candidate_review", {
        candidate: candidateView,
        manual: {
          fileId: manualParked.fileId,
          docId: null,
          filename: manualFilename,
          discoveryUrl: candidate.url,
          finalUrl: download.finalUrl,
          matchState: null,
          enabledByDefault: false,
          chunkCount: 0,
          indexed: false,
        },
        warning: scannedPdf
          ? "That manual is a scanned image with no readable text. It is saved and viewable in this notebook, but MIRA cannot cite it in chat."
          : "MIRA saved the file but could not read it. It is viewable in this notebook, but not searchable in chat.",
        message: scannedPdf
          ? "Manual saved as a viewable file only — no extractable text."
          : "Manual saved as a viewable file only.",
      });
    }
  }

  // Attach the manual as a CANDIDATE first (enabled_by_default=false is the
  // upsert's own rule for candidate state) — it cannot enter chat until the
  // evidence check below promotes it.
  const baseEvidence = {
    discoveryUrl: candidate.url,
    finalUrl: download.finalUrl,
    discoveryTitle: candidate.title,
    discoveryHost: candidate.host,
    oemHost: discovery.oemHost,
    // #3400 provenance: whether the SEARCH SERVICE validated the candidate, and
    // whether WE could independently attribute the host to this manufacturer.
    // A consumer must never read a successful download as "official".
    discoveryValidated: discovery.validated,
    independentlyOemHosted,
    awaitingUserConfirmation: requiresUserConfirmation,
    confirmedIdentity: identity,
    reusedExistingDocument: reused,
  };
  await attachFileToTargets(
    ctx.tenantId,
    manualParked.fileId,
    [
      {
        targetType: "equipment_notebook",
        targetId: notebookId,
        role: "manual",
        displayLabel: manualFilename,
        matchState: "candidate",
        matchEvidence: { ...baseEvidence, decisionMethod: "pending_applicability_check" },
      },
    ],
    { createdBy: ctx.userId ?? null },
  );

  // Judge applicability from THIS document's own chunks — never from the
  // search-result title or the URL.
  let verdict: ApplicabilityVerdict | null = null;
  let enabled = false;
  let matchState: "candidate" | "verified" = "candidate";
  if (manualDocId) {
    const chunks = await chunksForDoc(ctx.tenantId, manualDocId);
    verdict = assessApplicability({
      identity: {
        manufacturer: identity.manufacturer,
        model: identity.model,
        catalogNumber: identity.catalogNumber,
      },
      chunks,
      oemHost: discovery.oemHost,
    });
    if (verdict.state === "verified" && !requiresUserConfirmation) {
      matchState = "verified";
      enabled = true;
      await setSourceState(ctx.tenantId, notebookId, manualDocId, {
        matchState: "verified",
        enabledByDefault: true,
        matchEvidence: {
          ...baseEvidence,
          decisionMethod: verdict.method,
          matchedTokens: verdict.matchedTokens,
          evidencePages: verdict.evidencePages,
          applicabilityConfidence: verdict.confidence,
          reason: verdict.reason,
        },
      });
    } else {
      await setSourceState(ctx.tenantId, notebookId, manualDocId, {
        matchState: "candidate",
        enabledByDefault: false,
        matchEvidence: {
          ...baseEvidence,
          decisionMethod: verdict.method,
          matchedTokens: verdict.matchedTokens,
          evidencePages: verdict.evidencePages,
          applicabilityConfidence: verdict.confidence,
          reason: verdict.reason,
        },
      });
    }
  }

  return respond(matchState === "verified" ? "complete" : "candidate_review", {
    candidate: candidateView,
    manual: {
      fileId: manualParked.fileId,
      docId: manualDocId,
      filename: manualFilename,
      discoveryUrl: candidate.url,
      finalUrl: download.finalUrl,
      matchState,
      enabledByDefault: enabled,
      chunkCount: manualChunks,
      indexed: manualDocId !== null,
      reused,
    },
    applicability: verdict,
    message:
      matchState === "verified"
        ? `Manual added and enabled — ${verdict?.reason ?? "identity confirmed in the document text"}.`
        : `Manual saved but left off until you confirm it — ${
            verdict?.reason ?? "its text does not prove it covers this component"
          }.`,
  });
}
