/**
 * manual-acquisition — find, download, ingest and applicability-check the
 * official manual for a CONFIRMED identity, attaching it to one notebook.
 *
 * Moved verbatim from the nameplate confirm route (section "(d) Manual
 * discovery") so the notebook chat can run the same pipeline for a notebook
 * whose identity the technician already confirmed (#4075). Behaviour is
 * unchanged: the route calls this and responds with the returned status.
 *
 * Trust rules are the route's, unchanged: only a validated, direct-PDF,
 * OEM-hosted result is fetched without review; safeDownloadPdf is the only
 * fetcher; a manual enters chat only when its OWN text verifies it
 * (assessApplicability), otherwise it is attached disabled as a candidate.
 */
import { withTenantContext } from "@/lib/tenant-context";
import { setSourceState } from "@/lib/equipment-notebooks";
import {
  parkOrReuseFile,
  linkFileToUpload,
  attachFileToTargets,
  type AttachTarget,
  claimIngest,
  releaseIngestClaim,
} from "@/lib/workspace-files";
import { ingestPdfToNode, deleteOrphanNodeIngest, NoExtractableTextError } from "@/lib/node-knowledge-ingest";
import { discoverManual, allowedHostsForCandidate, isOemDocumentationHost } from "@/lib/manual-discovery";
import { safeDownloadPdf, safePdfFilename } from "@/lib/safe-download";
import { assessApplicability, type ApplicabilityVerdict } from "@/lib/manual-applicability";

/** Manuals are big; 80 MB is generous for an OEM PDF and still bounded. */
const MAX_MANUAL_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Identity evidence lives near the front of a manual — bound the scan. */
const APPLICABILITY_CHUNK_LIMIT = 80;

export type ManualAcquisitionStatus =
  | "complete"
  | "candidate_review"
  | "no_manual_found"
  | "search_unavailable"
  | "no_extractable_text"
  | "manufacturer_model_required"
  | "download_rejected"
  // A per-user/tenant/global provider-query cap is at capacity RIGHT NOW
  // (#4160 S4, PRD R5) — never the same as "no manual exists".
  | "search_limit_reached";

export interface ManualAcquisitionOutcome {
  status: ManualAcquisitionStatus;
  /** The route's response fields for this status, exactly as before the move. */
  payload: Record<string, unknown>;
}

export interface ManualAcquisitionInput {
  tenantId: string;
  userId: string | null;
  notebookId: string;
  nodeId: string;
  /** The CONFIRMED identity — never free text. Extra fields ride into match evidence. */
  identity: { manufacturer?: string; model?: string; catalogNumber?: string } & Record<string, string | undefined>;
  /**
   * Write this notebook's source state for the discovered manual and return
   * what is ACTUALLY persisted afterwards: the written state, the untouched
   * existing state when the writer declined (a technician's decision, or lost
   * ownership), or null when the notebook has no such source row at all. The
   * outcome reports that — never the state it merely asked for (Codex #4118
   * F8/F9). Defaults to an unconditional write — the confirm route's behaviour.
   */
  writeSourceState?: SourceStateWriter;
  /**
   * Attach the manual's file to the notebook (docId null for a file-only
   * attach). Returns true when attached, false when this search lost
   * ownership (skip every later write), "removed" when the technician removed
   * the manual an earlier attempt attached (never put back — Codex #4118
   * r14/r15 F19), or "resume" when that earlier attachment of the SAME
   * document still stands (assess it; do not re-attach). Throws on a database
   * failure (retryable — r14 F18). Defaults to an unconditional attach (the
   * confirm route: the technician is acting right now).
   */
  attach?: (
    tenantId: string,
    notebookId: string,
    fileId: string,
    docId: string | null,
    targets: AttachTarget[],
    createdBy: string | null,
  ) => Promise<boolean | "removed" | "resume">;
}

export type SourceStatePatch = { matchState: "verified" | "candidate"; enabledByDefault: boolean; matchEvidence: Record<string, unknown> };
/** A notebook source as persisted; null = no such source on the notebook. */
export type PersistedSource = { matchState: string; enabledByDefault: boolean } | null;
export type SourceStateWriter = (
  tenantId: string,
  notebookId: string,
  docId: string,
  patch: SourceStatePatch,
) => Promise<PersistedSource>;

async function writeUnconditionally(
  tenantId: string,
  notebookId: string,
  docId: string,
  patch: SourceStatePatch,
): Promise<PersistedSource> {
  const updated = await setSourceState(tenantId, notebookId, docId, patch);
  return updated ? { matchState: patch.matchState, enabledByDefault: patch.enabledByDefault } : null;
}

function outcome(status: ManualAcquisitionStatus, payload: Record<string, unknown> = {}): ManualAcquisitionOutcome {
  return { status, payload };
}

/**
 * The chunks of ONE document, for the applicability check. A plain read of the
 * document's own materialized text — not a retrieval query, and not link SQL.
 */
async function chunksForDoc(
  tenantId: string,
  docId: string,
): Promise<Array<{ content: string; page: number | null }> | null> {
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
  } catch (err) {
    // A read failure is NOT "no evidence": it must neither verify the manual
    // nor settle it as a candidate. null = retry later (Codex #4118 r13 F17).
    console.error("[manual-acquisition] chunk read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function acquireManualForIdentity(input: ManualAcquisitionInput): Promise<ManualAcquisitionOutcome> {
  const { identity, notebookId } = input;
  const ctx = { tenantId: input.tenantId, userId: input.userId };
  const notebook = { nodeId: input.nodeId };
  if (!identity.manufacturer || !(identity.model || identity.catalogNumber)) {
    return outcome("manufacturer_model_required", {
      message:
        "Add a manufacturer and a model (or catalog number) so MIRA can look for the official manual.",
    });
  }

  const discovery = await discoverManual(
    {
      manufacturer: identity.manufacturer,
      model: identity.model,
      catalogNumber: identity.catalogNumber,
    },
    ctx,
  );
  if (discovery.quotaExceeded) {
    // A cap denial must NEVER look like "no manual exists" (PRD R5, #4160 S4).
    return outcome("search_limit_reached", { message: discovery.reason });
  }
  if (!discovery.serviceAvailable) {
    return outcome("search_unavailable", { message: discovery.reason });
  }
  if (!discovery.found || !discovery.candidate) {
    return outcome("no_manual_found", {
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
    return outcome("candidate_review", {
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
    return outcome("download_rejected", {
      candidate: candidateView,
      message: `MIRA would not download that file (${download.reason}). Nothing was added to this notebook.`,
      reason: download.reason,
      httpStatus: download.status ?? null,
    });
  }

  const manualFilename = safePdfFilename(download.finalUrl);
  // One attach call: "error" = a database failure (retryable, not a refusal).
  const doAttach = async (
    docId: string | null,
    targets: AttachTarget[],
  ): Promise<boolean | "removed" | "resume" | "error"> => {
    try {
      if (input.attach) return await input.attach(ctx.tenantId, notebookId, manualParked.fileId, docId, targets, ctx.userId ?? null);
      await attachFileToTargets(ctx.tenantId, manualParked.fileId, targets, { createdBy: ctx.userId ?? null });
      return true;
    } catch (err) {
      console.error("[manual-acquisition] attach failed:", err instanceof Error ? err.message : err);
      return "error";
    }
  };
  const gateOutcome = (gate: "removed" | "error", fileId: string, docId: string | null) =>
    outcome("candidate_review", {
      candidate: candidateView,
      manual: { fileId, docId, filename: manualFilename, discoveryUrl: candidate.url, finalUrl: download.finalUrl, attached: false },
      linked: false,
      ...(gate === "error" ? { retryable: true } : { removedByTechnician: true }),
      message:
        gate === "error"
          ? "MIRA found the manual but could not attach it just now, and will try again."
          : "This manual was removed from the notebook, so MIRA did not add it back.",
    });
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
        return outcome("candidate_review", {
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
      const fileGate = await doAttach(null, [
        { targetType: "equipment_notebook", targetId: notebookId, role: "manual", displayLabel: manualFilename },
      ]);
      if (fileGate === "error" || fileGate === "removed") return gateOutcome(fileGate, manualParked.fileId, null);
      return outcome(scannedPdf ? "no_extractable_text" : "candidate_review", {
        linked: fileGate === true || fileGate === "resume",
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
        // A non-scan failure (e.g. a dropped database connection) is retryable;
        // the record layer schedules the retry (Codex #4118 r12 F16).
        ingestFailed: !scannedPdf,
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
  const docGate = await doAttach(manualDocId, [
    {
      targetType: "equipment_notebook",
      targetId: notebookId,
      role: "manual",
      displayLabel: manualFilename,
      matchState: "candidate",
      matchEvidence: { ...baseEvidence, decisionMethod: "pending_applicability_check" },
    },
  ]);
  if (docGate === "error" || docGate === "removed") return gateOutcome(docGate, manualParked.fileId, manualDocId);
  if (docGate === false) {
    // Already a source on this notebook, or this search lost ownership: leave
    // whatever is there untouched and report what exists.
    return outcome("candidate_review", {
      candidate: candidateView,
      manual: {
        fileId: manualParked.fileId,
        docId: manualDocId,
        filename: manualFilename,
        discoveryUrl: candidate.url,
        finalUrl: download.finalUrl,
        matchState: null,
        enabledByDefault: null,
        chunkCount: manualChunks,
        indexed: manualDocId !== null,
        reused,
        attachSkipped: true,
      },
      message: "That manual is already in this notebook's sources.",
    });
  }

  // Judge applicability from THIS document's own chunks — never from the
  // search-result title or the URL.
  let verdict: ApplicabilityVerdict | null = null;
  let enabled = false;
  let matchState: string = "candidate";
  let attached = true;
  let removedDuringRun = false;
  // A database failure while judging the manual is transient: the manual stays
  // an UNDECIDED candidate (the pending evidence from the attach above, which
  // a retry may still promote), and the outcome says "retry", never "reviewed"
  // (Codex #4118 r13 F17).
  const retryLater = () =>
    outcome("candidate_review", {
      candidate: candidateView,
      manual: {
        fileId: manualParked.fileId,
        docId: manualDocId,
        filename: manualFilename,
        discoveryUrl: candidate.url,
        finalUrl: download.finalUrl,
        matchState: "candidate",
        enabledByDefault: false,
        chunkCount: manualChunks,
        indexed: manualDocId !== null,
        reused,
      },
      retryable: true,
      linked: true,
      message: "Manual saved; MIRA could not finish checking it and will try again.",
    });
  if (manualDocId) {
    const chunks = await chunksForDoc(ctx.tenantId, manualDocId);
    if (chunks === null) return retryLater();
    verdict = assessApplicability({
      identity: {
        manufacturer: identity.manufacturer,
        model: identity.model,
        catalogNumber: identity.catalogNumber,
      },
      chunks,
      oemHost: discovery.oemHost,
    });
    const verifiedEvidence = {
      ...baseEvidence,
      decisionMethod: verdict.method,
      matchedTokens: verdict.matchedTokens,
      evidencePages: verdict.evidencePages,
      applicabilityConfidence: verdict.confidence,
      reason: verdict.reason,
    };
    // The route writes unconditionally (the technician is confirming right
    // now). A background caller passes a FENCED writer that writes only an
    // undecided candidate it still owns; otherwise it writes NOTHING (Codex
    // #4118 F3/F5/F8). Either way the outcome reports what is persisted: a
    // technician's decision stands, and a source removed meanwhile is not
    // reported as added (F9).
    const write = input.writeSourceState ?? writeUnconditionally;
    const promote = verdict.state === "verified" && !requiresUserConfirmation;
    let persisted: PersistedSource;
    try {
      persisted = await write(ctx.tenantId, notebookId, manualDocId, {
        matchState: promote ? "verified" : "candidate",
        enabledByDefault: promote,
        matchEvidence: verifiedEvidence,
      });
    } catch (err) {
      console.error("[manual-acquisition] source write failed:", err instanceof Error ? err.message : err);
      return retryLater();
    }
    if (persisted) {
      matchState = persisted.matchState;
      enabled = persisted.enabledByDefault;
    }
    attached = persisted !== null && persisted.matchState !== "rejected";
    removedDuringRun = persisted === null;
  }

  const answering = attached && enabled && (matchState === "verified" || matchState === "user_confirmed");
  return outcome(answering ? "complete" : "candidate_review", {
    linked: !removedDuringRun,
    ...(removedDuringRun ? { removedByTechnician: true } : {}),
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
      attached,
    },
    applicability: verdict,
    message: !attached
      ? "The manual was found, but it is not among this notebook's sources."
      : answering
        ? `Manual added and enabled — ${verdict?.reason ?? "identity confirmed in the document text"}.`
        : `Manual saved but left off until you confirm it — ${
            verdict?.reason ?? "its text does not prove it covers this component"
          }.`,
  });
}
