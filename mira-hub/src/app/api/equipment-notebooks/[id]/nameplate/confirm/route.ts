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
 * What this route deliberately does NOT do: write the identity of a notebook
 * that already names a machine (or is bound to an asset). There the nameplate
 * belongs to a COMPONENT inside the machine; overwriting the notebook's
 * manufacturer/model with a drive's nameplate would silently rename the ride
 * after one of its parts. A BLANK notebook has no machine to rename, so it
 * adopts the confirmed nameplate (#4178, nameplate-identity-adoption.ts).
 *
 * Business outcomes are HTTP 200 with a `status` the mobile client maps
 * directly; only auth and request-shape failures use 4xx.
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  getNotebook,
  attachSource,
  findVisibleOriginSource,
  markNameplateDocVerified,
  supersedePriorOriginSources,
} from "@/lib/equipment-notebooks";
import { getFile, parkOrReuseFile, linkFileToUpload, claimIngest, releaseIngestClaim } from "@/lib/workspace-files";
import { ingestTextToNode, deleteOrphanNodeIngest } from "@/lib/node-knowledge-ingest";
import { acquireManualForIdentity } from "@/capabilities/manual-acquisition";
import { acquisitionEnabled, acquisitionKey, runManualAcquisition } from "@/capabilities/notebook-manual-acquisition";
import {
  adoptNameplateIdentityIfBlank,
  adoptedIdentityFromEvidence,
  isAdoptableIdentity,
  isBlankUnboundNotebook,
  isCorrectionOfAdoptedNameplate,
  readoptCorrectedNameplate,
  stampAdoptionProvenance,
} from "@/capabilities/nameplate-identity-adoption";
import { promoteVisualObservations, correctVisualObservations } from "@/lib/visual-evidence-context";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConfirmStatus =
  | "complete"
  | "candidate_review"
  | "no_manual_found"
  | "search_unavailable"
  | "no_extractable_text"
  | "manufacturer_model_required"
  | "nameplate_not_indexed"
  | "download_rejected"
  // A per-user/tenant/global provider-query cap is at capacity RIGHT NOW
  // (#4160 S4, PRD R5) — never the same as "no manual exists".
  | "search_limit_reached";

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

/** Upper bound on visual observation ids / corrections per confirm. A plate has
 *  about ten readings plus a few compliance marks; anything past this is not a
 *  technician confirming a nameplate. Rejected explicitly, never truncated. */
const MAX_VISUAL_ENTRIES = 50;

/** Distinct string entries, first occurrence wins, non-strings dropped. */
function uniqueStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Distinct `{observationId, value}` corrections (by observation id, first wins), malformed entries dropped. */
function uniqueCorrections(raw: unknown): { observationId: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: { observationId: string; value: string }[] = [];
  for (const c of raw as unknown[]) {
    const o = c as { observationId?: unknown; value?: unknown } | null;
    if (!o || typeof o.observationId !== "string" || typeof o.value !== "string" || seen.has(o.observationId)) continue;
    seen.add(o.observationId);
    out.push({ observationId: o.observationId, value: o.value });
  }
  return out;
}

/** Canonical digest of WHAT a confirmation asserts: the photo, the sanitized
 *  identity (sorted keys), the promoted ids (sorted) and the corrections (sorted
 *  by id). Two requests with the same client key and the same digest are one
 *  logical confirmation; a different digest is an edited retry. */
function confirmPayloadSha256(p: {
  fileId: string;
  identity: Identity;
  observationIds: readonly string[];
  corrections: readonly { observationId: string; value: string }[];
}): string {
  const identity = Object.fromEntries(
    (Object.keys(p.identity) as IdentityField[]).sort().map((k) => [k, p.identity[k]]),
  );
  const canonical = JSON.stringify({
    fileId: p.fileId,
    identity,
    observationIds: [...p.observationIds].sort(),
    corrections: [...p.corrections].sort((a, b) => a.observationId.localeCompare(b.observationId)),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

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

  // ── Slice 2/3 inputs are validated HERE, before any side effect (Codex F4/F5).
  // The client's partition helper keeps promote/correct disjoint, but a client
  // helper is not a server invariant: the same id in both arrays would promote
  // the pre-edit reading and then skip its correction, leaving the misread
  // verified beside the corrected nameplate. Reject overlap outright. Bound and
  // de-duplicate both lists at the boundary: a plate has ~10 readings, and each
  // correction is a locked query inside one transaction.
  const submittedObservationIds = uniqueStrings(body.observationIds);
  const submittedCorrections = uniqueCorrections(body.corrections);
  if (submittedObservationIds.length > MAX_VISUAL_ENTRIES || submittedCorrections.length > MAX_VISUAL_ENTRIES) {
    return NextResponse.json({ error: "too_many_visual_entries", max: MAX_VISUAL_ENTRIES }, { status: 400 });
  }
  const correctionTargets = new Set(submittedCorrections.map((c) => c.observationId));
  const overlap = submittedObservationIds.filter((id) => correctionTargets.has(id));
  if (overlap.length > 0) {
    return NextResponse.json({ error: "observation_in_both_sets", observationIds: overlap }, { status: 400 });
  }
  // The logical confirmation is (client key, WHAT was confirmed). Same key with
  // a different identity or a different correction set is an EDITED retry, not
  // a replay: it must mint a new derived document (the prior one is superseded
  // below) rather than reuse the stale text beside the new corrections (Codex F2).
  const confirmPayloadHash = confirmPayloadSha256({ fileId, identity, observationIds: submittedObservationIds, corrections: submittedCorrections });

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
  // Same clientKey + the SAME confirmed payload + an existing visible derived
  // doc for this photo = a replay of the SAME logical confirmation. Reuse the
  // existing doc verbatim — no re-park, no re-ingest, no new reading. A matching
  // key with a different payload is an edited retry and falls through to
  // materialize (Codex F2); a legacy row without a stored payload hash never
  // counts as a replay (byte-level dedup still reuses identical text).
  const existingOrigin = await findVisibleOriginSource(ctx.tenantId, notebookId, fileId).catch(
    () => null,
  );
  const priorConfirm = (existingOrigin?.matchEvidence ?? null) as
    | { confirm_client_key?: unknown; confirm_payload_sha256?: unknown }
    | null;
  const replayOfSameConfirm = Boolean(
    clientKey &&
      existingOrigin &&
      priorConfirm?.confirm_client_key === clientKey &&
      priorConfirm?.confirm_payload_sha256 === confirmPayloadHash,
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
        // 085: audit trail — which logical confirmation produced this reading,
        // and WHAT it confirmed (Codex F2: the key alone cannot tell a replay
        // from an edited retry).
        matchEvidence: clientKey ? { confirm_client_key: clientKey, confirm_payload_sha256: confirmPayloadHash } : undefined,
      });
      // attachSource reports failure by RETURN VALUE, not throw. Without the
      // source row the doc is not citable in this notebook — fail closed.
      if (!att.ok) throw new Error(`attach_source_failed: ${att.error}`);
      // #3437 nameplate lane: the technician just reviewed and confirmed this
      // content — record that human approval on the doc's own chunks so the
      // retrieval approval gate (verified = true) admits them. Best-effort:
      // a failure leaves the doc attached but unverified (refusal, not a 500).
      try {
        const marked = await markNameplateDocVerified(ctx.tenantId, nameplateDocId);
        if (marked > 0) {
          console.log(
            `[nameplate-confirm] marked ${marked} chunk(s) verified for doc ${nameplateDocId}`,
          );
        }
      } catch (err) {
        console.warn(
          `[nameplate-confirm] verified-mark failed doc=${nameplateDocId}: ${(err as Error).message}`,
        );
      }
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

  // ── Slice 2: promote ONLY the exact visual observations the technician approved.
  // Orthogonal to the nameplate-text ingest above — this flips the persisted
  // VisualSession candidate readings (migration 063) whose ids the client
  // EXPLICITLY sends to review_state='confirmed', scoped by canonical identity to
  // the notebook's SERVER-bound asset and THIS photo. It never promotes a sibling
  // the client did not send, an older/newer capture, or another asset — the guards
  // live in promoteVisualObservations. The backend trusts the submitted id SET and
  // derives nothing from `identity`: a field the technician EDITED is confirmed
  // only if the client chose to send its id (a corrected reading's pre-edit value
  // must never be auto-stamped). Confirm has no dispute channel (it resolves the
  // binding via getNotebook, not resolveBoundAsset), so the reachable asset failure
  // is unbound/foreign — caught by isUuidKey(boundEntityId) + the asset_id subquery.
  // Fail-safe: any error promotes nothing (never broadens); the count is surfaced
  // so a lost promotion is observable, not silent.
  // (`submittedObservationIds` was validated, de-duplicated, bounded and checked
  // for overlap with the corrections BEFORE the nameplate was materialized.)
  let visualPromotedIds: string[] = [];
  if (submittedObservationIds.length > 0) {
    try {
      const promoted = await promoteVisualObservations({
        tenantId: ctx.tenantId,
        boundEntityId: notebook.asset?.entityId ?? null,
        fileId,
        observationIds: submittedObservationIds,
      });
      visualPromotedIds = promoted.promotedIds;
    } catch (err) {
      console.warn(
        `[nameplate-confirm] visual promotion failed notebook=${notebookId} photo=${fileId} ` +
          `code=${(err as { code?: string }).code ?? "?"}: ${(err as Error).message}`,
      );
    }
  }

  // ── Slice 3: apply the technician's CORRECTIONS to exact visual observations.
  // The client partitions this capture's readings into unchanged (→ observationIds,
  // promoted above) and edited-with-a-value (→ corrections). Each correction
  // inserts a technician-provided replacement on the same photo and supersedes
  // the vision reading (evidence_state='SUPERSEDED', superseded_by=<new>), so the
  // stale value stops participating in chat context while the trail is kept —
  // correction never destroys evidence, it changes which observation is active.
  // Same scoping as promotion (exact id ∧ tenant ∧ bound asset ∧ this photo ∧ live
  // candidate); the server derives NO correction from `identity`. It does use the
  // confirmed identity as a CONSTRAINT (Codex F1): a correction whose stored field
  // is an identity field must agree with the value confirmed in this very request,
  // or the one confirm would mint two contradictory technician-verified facts.
  // Mismatches are skipped by the lib and reported below. Fail-safe like above.
  // (`submittedCorrections` was validated, de-duplicated, bounded and checked for
  // overlap with the promoted ids BEFORE the nameplate was materialized.)
  let visualCorrected: { supersededId: string; replacementId: string }[] = [];
  let visualCorrectionMismatches: { observationId: string; field: string }[] = [];
  // Codex round 2 F1: the confirm stays fail-safe (the nameplate document is the
  // primary deliverable), but a swallowed correction error must not read as
  // success to the client. This flag says "you asked for corrections and the
  // server could not apply them" so the client can offer a retry instead of
  // reporting complete while the misread stays active.
  let visualCorrectionFailed = false;
  if (submittedCorrections.length > 0) {
    try {
      const res = await correctVisualObservations({
        tenantId: ctx.tenantId,
        boundEntityId: notebook.asset?.entityId ?? null,
        fileId,
        corrections: submittedCorrections,
        correctedBy: ctx.userId ?? null,
        expected: identity,
      });
      visualCorrected = res.corrected;
      visualCorrectionMismatches = res.mismatched;
      if (visualCorrectionMismatches.length > 0) {
        console.warn(
          `[nameplate-confirm] ${visualCorrectionMismatches.length} correction(s) contradicted the confirmed identity ` +
            `notebook=${notebookId} photo=${fileId} fields=${visualCorrectionMismatches.map((m) => m.field).join(",")}`,
        );
      }
    } catch (err) {
      visualCorrectionFailed = true;
      console.warn(
        `[nameplate-confirm] visual correction failed notebook=${notebookId} photo=${fileId}: ${
          (err as Error).message
        }`,
      );
    }
  }

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

  // #4178: set when this confirm adopted the nameplate as a BLANK notebook's
  // identity (see adoptNameplateIdentityIfBlank) — reported so a client can say so.
  let identityAdopted = false;
  const respond = (
    status: ConfirmStatus,
    extra: Record<string, unknown> = {},
  ): NextResponse =>
    NextResponse.json({
      ok: true,
      status,
      ...(identityAdopted ? { identityAdopted: true } : {}),
      notebookId,
      nameplate,
      // Slice 2: how many persisted visual observations this confirm promoted to
      // technician-confirmed. 0 when the client sent none, the notebook is unbound
      // or foreign, the ids were invalid, or they were not live candidates of this
      // asset's capture — never a silent broadening.
      visualPromotedCount: visualPromotedIds.length,
      // Slice 3: how many vision readings were superseded by a technician-provided
      // replacement on this photo. Same fail-safe semantics as the count above.
      visualCorrectedCount: visualCorrected.length,
      // Codex F1: corrections REFUSED because their value contradicted the identity
      // confirmed by this same request. Explicit, never silently dropped — the client
      // can show the technician which field disagreed with itself.
      visualCorrectionMismatches,
      // Codex round 2 F1: true when corrections were submitted and the server
      // could not apply them (transient DB error, supersede race). The client
      // must treat this as "edits not saved, retry", never as complete.
      visualCorrectionFailed,
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

  // ── (c2) #4178: a BLANK notebook adopts the confirmed nameplate ─────────────
  // Only after the nameplate is citable (above). A notebook that already names a
  // machine, or is bound to an asset, keeps its identity — there the nameplate
  // is a component. The conditional write is the authority; a lost race (the
  // notebook gained an identity meanwhile) just leaves the inline search below.
  // Codex #4191 F1: a correction of the SAME photo that adopted the identity
  // (its prior reading carries the provenance stamp, and the notebook still
  // holds exactly that identity, unbound) moves the adopted identity with it.
  const priorAdopted = adoptedIdentityFromEvidence(existingOrigin?.matchEvidence);
  try {
    if (isBlankUnboundNotebook(notebook) && isAdoptableIdentity(identity)) {
      identityAdopted = await adoptNameplateIdentityIfBlank(ctx.tenantId, notebookId, identity);
    } else if (isCorrectionOfAdoptedNameplate(notebook, priorAdopted) && isAdoptableIdentity(identity)) {
      identityAdopted = await readoptCorrectedNameplate(ctx.tenantId, notebookId, priorAdopted!, identity);
    }
    if (identityAdopted && nameplateDocId) {
      await stampAdoptionProvenance(ctx.tenantId, notebookId, nameplateDocId, identity).catch((err) =>
        console.error(
          `[nameplate-confirm] adoption provenance stamp failed notebook=${notebookId}: ${(err as Error).message}`,
        ),
      );
    }
  } catch (err) {
    console.error(`[nameplate-confirm] identity adoption failed notebook=${notebookId}: ${(err as Error).message}`);
  }

  // ── (d) Manual discovery ──────────────────────────────────────────────────
  if (body.discover === false) {
    return respond("complete", {
      message: "Nameplate confirmed. Manual search was not requested.",
      discovery: { requested: false },
    });
  }
  const acquireInput = {
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
    notebookId,
    nodeId: notebook.nodeId,
    identity,
  };
  // #4160 S7 — with the acquisition flag on, and ONLY when the confirmed
  // nameplate identity is this notebook's own confirmed identity, the search
  // runs under the lifecycle so a limit denial or an outage is RECORDED and
  // the chat's existing retry (which re-searches the notebook's identity)
  // recovers it on the technician's next question — never a repeat of the
  // nameplate flow. The outcome returned is the real one, exactly as before.
  // A component nameplate in a differently-identified or unbound notebook
  // stays inline and unrecorded (Codex #4177 F1; #4178): the notebook-level
  // record could not be retried for it and would be overwritten by the
  // notebook's own search. A refused claim (a live search for this key) or
  // the flag off also falls back to the unrecorded inline search.
  // #4178: an adopted nameplate IS the notebook's own confirmed identity now.
  const ownKey = acquisitionKey(
    identityAdopted
      ? {
          identityStatus: "user_confirmed",
          manufacturer: identity.manufacturer ?? null,
          model: identity.model ?? null,
          catalogNumber: identity.catalogNumber ?? null,
        }
      : {
          identityStatus: notebook.identityStatus,
          manufacturer: notebook.manufacturer,
          model: notebook.model,
          catalogNumber: notebook.catalogNumber,
        },
  );
  const nameplateKey = acquisitionKey({
    identityStatus: "user_confirmed",
    manufacturer: identity.manufacturer ?? null,
    model: identity.model ?? null,
    catalogNumber: identity.catalogNumber ?? null,
  });
  if (acquisitionEnabled() && ownKey !== null && ownKey === nameplateKey) {
    const run = await runManualAcquisition(acquireInput);
    if (run.started && run.outcome) return respond(run.outcome.status, run.outcome.payload);
  }
  const acquired = await acquireManualForIdentity(acquireInput);
  return respond(acquired.status, acquired.payload);
}
