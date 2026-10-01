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
import { safeSpan, setActiveSpanAttrs } from "@/capabilities/observability/acquisition-spans";

/** Manuals are big; 80 MB is generous for an OEM PDF and still bounded. */
const MAX_MANUAL_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
/** Identity evidence lives near the front of a manual — bound the scan. */
const APPLICABILITY_CHUNK_LIMIT = 80;
/** $0.001/provider-query default (docs/env-vars.md MANUAL_SEARCH_GLOBAL_MONTHLY_CAP
 * sizing: $10/month -> 10,000 queries). Overridable; a non-numeric env value
 * falls back to this default rather than producing a NaN cost (#4160 gate R15). */
const DEFAULT_PROVIDER_QUERY_COST_USD = 0.001;

function providerQueryCostUsd(): number {
  const raw = process.env.MANUAL_SEARCH_COST_PER_QUERY_USD;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PROVIDER_QUERY_COST_USD;
}

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
   * "candidate" when this search is for an identity the technician has NOT
   * yet confirmed — a proposed/label-read maker+part (#4160 S6, PRD R2).
   * Forces `promote = false` below (never match_state='verified', never
   * enabled_by_default=true FROM THIS FUNCTION): the deterministic
   * applicability verdict is still computed and recorded as
   * `candidateApplicability` on the written evidence (R8 — the judge may only
   * reject, never auto-approve), but promotion to a citable, enabled source
   * happens only when the technician confirms this SAME identity — either
   * migration 104's trigger (the search finished first) or the fenced writer
   * itself noticing, at write time, that the notebook was ALREADY confirmed
   * to the matching key (the common case: confirming is near-instant, the
   * search can take up to a minute). Defaults to "confirmed" — the nameplate
   * confirm route's existing unconditional-writer behaviour, unchanged.
   */
  basis?: "confirmed" | "candidate";
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

  // R15 span: provider-query accounting, cap state and candidates considered
  // — set from the discovery result itself, never invented when mira-ask
  // didn't carry search_stats (an old version, or a malformed response).
  const discovery = await safeSpan("manual_acquisition.search", {}, async () => {
    const d = await discoverManual(
      {
        manufacturer: identity.manufacturer,
        model: identity.model,
        catalogNumber: identity.catalogNumber,
      },
      ctx,
    );
    const providerQueries = d.searchStats?.providerQueries ?? null;
    setActiveSpanAttrs({
      "mira.acquisition.provider_queries": providerQueries,
      "mira.acquisition.candidates": d.searchStats?.candidates ?? null,
      "mira.acquisition.cap_hit": d.quotaExceeded,
      "mira.acquisition.cap_scope": d.searchStats?.quotaDenied ?? null,
      "mira.acquisition.cost_usd":
        providerQueries === null ? null : Math.round(providerQueries * providerQueryCostUsd() * 1e6) / 1e6,
    });
    return d;
  });
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
  const requiresUserConfirmation = probeUnvalidated || input.basis === "candidate";

  const downloadStartedAt = Date.now();
  const download = await safeSpan("manual_acquisition.download", {}, async () => {
    const d = await safeDownloadPdf(candidate.url, {
      allowedHosts: allowedHostsForCandidate(identity, candidate),
      maxBytes: MAX_MANUAL_BYTES,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
    setActiveSpanAttrs({
      "mira.acquisition.download_bytes": d.ok ? d.buffer.length : null,
      "mira.acquisition.download_ms": Date.now() - downloadStartedAt,
    });
    return d;
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
  // The fenced attach returned `false`: this search no longer owns the notebook
  // (its identity was changed or cleared mid-fetch). Nothing was linked, so the
  // outcome must never imply the manual is in Sources or viewable here — and the
  // record layer must never mark it attached (#4177 Codex r7 F9 / r8 F10).
  const ownershipLostOutcome = (
    fileId: string,
    docId: string | null,
    filename: string,
    extra: { chunkCount?: number; reused?: boolean } = {},
  ) =>
    outcome("candidate_review", {
      candidate: candidateView,
      manual: {
        fileId,
        docId,
        filename,
        discoveryUrl: candidate.url,
        finalUrl: download.finalUrl,
        matchState: null,
        enabledByDefault: null,
        chunkCount: extra.chunkCount ?? 0,
        indexed: docId !== null,
        ...(extra.reused !== undefined ? { reused: extra.reused } : {}),
        attachSkipped: true,
        attached: false,
      },
      linked: false,
      ownershipLost: true,
      message:
        "This notebook's identity changed while MIRA was fetching the manual, so it was not added. Confirm the nameplate again if this is still the right machine.",
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
  // R15 span: exact-byte dedup is the only "recall" this pipeline has — an
  // existing indexed manual for these bytes being reused instead of a fresh
  // ingest. A concurrent-request claim collision below is a race, not a
  // recall, so it is deliberately not folded into this attribute.
  await safeSpan("manual_acquisition.recall", { "mira.acquisition.recall_hit": reused }, async () => {});

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
      const ingestStartedAt = Date.now();
      const ing = await safeSpan("manual_acquisition.ingest", {}, async () => {
        const r = await ingestPdfToNode({
          tenantId: ctx.tenantId,
          nodeId: notebook.nodeId,
          unsPath: null,
          filename: manualFilename,
          mimeType: "application/pdf",
          sizeBytes: download.buffer.length,
          buffer: download.buffer,
        });
        setActiveSpanAttrs({
          // NodeIngestResult carries no page count — never invented (R15: "pages
          // may be null if unknown, never invented").
          "mira.acquisition.ingest_pages": null,
          "mira.acquisition.ingest_chunks": r.chunkCount,
          "mira.acquisition.ingest_ms": Date.now() - ingestStartedAt,
        });
        return r;
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
      // Lost ownership (the notebook's identity changed mid-fetch; the fenced
      // attach refused): no file link was created, so nothing is "saved and
      // viewable in this notebook" — the same explicit unattached outcome as
      // the indexed-document branch below (#4177 Codex r8 F10).
      if (fileGate === false) return ownershipLostOutcome(manualParked.fileId, null, manualFilename);
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
    // This search lost ownership of the notebook (its identity was changed or
    // cleared while the manual was being fetched — the fenced attach refused):
    // nothing was attached, nothing is claimed. An explicit UNATTACHED outcome
    // (#4177 Codex r7 F9): `attached: false` + `linked: false` keep the durable
    // record from recording an attachment, and the reply never says the manual
    // is in Sources (an existing source row is NOT what `false` means — the
    // fence attaches over one so a retry reaches its applicability check).
    return ownershipLostOutcome(manualParked.fileId, manualDocId, manualFilename, { chunkCount: manualChunks, reused });
  }

  // Judge applicability from THIS document's own chunks — never from the
  // search-result title or the URL.
  let verdict: ApplicabilityVerdict | null = null;
  let enabled = false;
  let matchState: string = "candidate";
  let attached = true;
  let removedDuringRun = false;
  // #4172 Codex post-cap 4 F9: what the chat may promise a candidate-basis turn
  // ("confirm and I'll answer from it") depends on this stamp, so the outcome
  // carries it alongside the persisted evidence.
  let candidateApplicability: "verified" | "candidate" | null = null;
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
    verdict = await safeSpan("manual_acquisition.applicability", {}, async () => {
      const v = assessApplicability({
        identity: {
          manufacturer: identity.manufacturer,
          model: identity.model,
          catalogNumber: identity.catalogNumber,
        },
        chunks,
        oemHost: discovery.oemHost,
      });
      setActiveSpanAttrs({ "mira.acquisition.match_state": v.state });
      return v;
    });
    const verifiedEvidence = {
      ...baseEvidence,
      decisionMethod: verdict.method,
      matchedTokens: verdict.matchedTokens,
      evidencePages: verdict.evidencePages,
      applicabilityConfidence: verdict.confidence,
      reason: verdict.reason,
      // #4160 S6 — the real verdict, independent of `promote` below (which is
      // always forced false for candidate basis): the fenced writer reads
      // this to decide whether a race (the technician already confirmed this
      // exact identity by the time this write lands) should promote anyway.
      //
      // Codex r1 F3 (#4172, HIGH): this must NEVER read 'verified' when the
      // download itself required a human review hold (probeUnvalidated — an
      // unvalidated-by-the-service candidate, probed only because it is
      // independently OEM-hosted). Both promotion paths (fencedWriter's
      // promoteNow and migration 104) gate purely on this field, so a
      // 'verified' stamp here would let identity confirmation alone promote a
      // document whose BYTES were never provenance-validated — bypassing the
      // unvalidated-download review hold `probeUnvalidated`/
      // `requiresUserConfirmation` exist to enforce. An exact-matching verdict
      // on an unvalidated download therefore still stamps 'candidate': a
      // human must review the SOURCE, not just confirm the identity.
      ...(input.basis === "candidate"
        ? { candidateApplicability: verdict.state === "verified" && !probeUnvalidated ? "verified" : "candidate" }
        : {}),
    };
    candidateApplicability =
      (verifiedEvidence as { candidateApplicability?: "verified" | "candidate" }).candidateApplicability ?? null;
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
    // Codex post-cap 5 F10 (#4172): report the stamp only when the row that was
    // actually stored is a disabled candidate. The upsert overwrites a candidate
    // row's evidence with ours, but preserves a verified / user_confirmed /
    // rejected row's state and evidence, so for those this stamp is not on the
    // row and confirming the identity cannot enable it.
    if (!(persisted && persisted.matchState === "candidate" && !persisted.enabledByDefault)) candidateApplicability = null;
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
      ...(candidateApplicability ? { candidateApplicability } : {}),
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
