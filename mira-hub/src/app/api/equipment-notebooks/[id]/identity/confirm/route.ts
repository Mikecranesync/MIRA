/**
 * POST /api/equipment-notebooks/[id]/identity/confirm
 *
 * "Use its manuals" (T2, #4175/#4189): the technician confirms a machine
 * MIRA PROPOSED from free text (#4120, `capabilities/identity-proposal.ts`
 * `IdentityProposal` / the chat route's `identity_proposal` SSE frame). This
 * is the server half the frame's own comment promises ("the identity_proposal
 * entry is what the client's later confirm/reject PATCH is checked against" —
 * chat/route.ts, the `proposalEntries` persist site).
 *
 * This route does NOT create a second identity-write path. It validates the
 * body and calls `confirmNotebookIdentity` (`capabilities/notebook-manual-
 * acquisition.ts`), which writes the SAME columns the Hub's generic
 * `PATCH /api/equipment-notebooks/[id]` (`updateNotebook`) writes — just as
 * one atomic UPDATE whose WHERE clause encodes the stale-identity guard
 * below, instead of a separate read-then-write (light-review TOCTOU
 * remediation, PR #4195). Writing `identity_status = 'user_confirmed'` fires
 * the
 * `equipment_notebooks_revoke_auto_manuals` trigger — migration 104's
 * promotion branch, specifically — which turns a matching CANDIDATE-basis
 * manual (one a background search already found AND whose applicability was
 * already verified, #4160 S6) into a usable, enabled source, in the SAME
 * transaction as this write. A `candidate` row whose applicability was only
 * "candidate" (found a document, couldn't confirm it covers this exact part)
 * is NEVER auto-promoted by confirming the identity — a human still reviews
 * it in Sources. This route reports the real post-write state by reading
 * Sources back, never by guessing.
 *
 * `catalogNumber` is ALWAYS written — "" when the proposal didn't carry one
 * — because the candidate-basis search this confirm is meant to line up with
 * (`notebook-manual-acquisition.ts`, the `candidateAcquisitionOwnsTurn`
 * block in chat/route.ts) keys its own candidate identity on
 * `catalogNumber: ""` unconditionally. `acquisitionKey()` must match EXACTLY
 * — case/punctuation-normalized, but not "set vs. omitted" — for migration
 * 104's promotion predicate to fire; leaving this column untouched (NULL
 * from notebook creation) would silently orphan that candidate instead.
 *
 * "Not this" (reject) is NOT a server endpoint: the contract is "no identity
 * write" (T2 acceptance #2), which a pure client-side dismissal already
 * satisfies with nothing to confirm server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, listSources } from "@/lib/equipment-notebooks";
import {
  acquisitionEnabled,
  acquisitionKey,
  applicableReadySource,
  confirmNotebookIdentity,
  readAcquisition,
  startManualAcquisition,
} from "@/capabilities/notebook-manual-acquisition";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD_LEN = 200;

/** A trimmed, length-bounded string, or "" when absent/not a string — never
 *  null/undefined, so every caller can pass the result straight to the
 *  identity write without an extra presence check. */
function readString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === "string" ? v.trim().slice(0, MAX_FIELD_LEN) : "";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id: notebookId } = await params;

  if (!UUID_RE.test(notebookId)) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // `req.json()` parses any valid JSON value — `null`, an array, a bare
  // string/number/boolean all pass. The route's `Record<string, unknown>`
  // cast is a compile-time assertion, not a runtime check, so `readString`'s
  // `body[key]` would otherwise dereference a non-object and throw instead of
  // returning a controlled 400 (Codex F7, LOW).
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;

  const manufacturer = readString(body, "manufacturer");
  const model = readString(body, "model");
  if (!manufacturer || !model) {
    return NextResponse.json({ error: "manufacturer_and_model_required" }, { status: 400 });
  }
  // See header: written unconditionally, "" when absent — never left out.
  const catalogNumber = readString(body, "catalogNumber");

  const notebook = await getNotebook(ctx.tenantId, notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }

  // Stale-proposal guard (light-review finding, PR #4195): a persisted
  // `identity_proposal` card survives in a notebook's history even after a
  // LATER, DIFFERENT identity is confirmed — `to-interaction.ts` deliberately
  // never rewrites an old turn's parts (Codex #3839 P1, `persistedMeta`'s own
  // header). Without this check, clicking that stale card's "Use its
  // manuals" silently rewrites the notebook back to the earlier machine, and
  // can re-fire migration 104's promotion/revocation trigger for it.
  //
  // "Already confirmed" mirrors the identical check already used elsewhere in
  // this capability for the same reason (`nameplate-identity-adoption.ts`'s
  // `isBlankUnboundNotebook`/`mayBeNameplateAdopted`, `hub-host-logic.ts`'s
  // `confirmed`): identity_status is `user_confirmed` OR `verified` —
  // migration 073's two settled states. `unknown`/`candidate` are not yet a
  // settled identity, so an unconditional write stays correct for them
  // (including the very first confirm of a proposal — the common case).
  //
  // Confirming the SAME identity again must still succeed (an idempotent
  // re-click, or a stale card that happens to still name the CURRENT
  // machine) — this guard refuses ONLY a confirm that would REPLACE a
  // settled identity with a DIFFERENT one.
  //
  // TOCTOU remediation (light-review finding, PR #4195 #4195-followup, HIGH):
  // this check used to run in JS against the `getNotebook` read above, with
  // an unconditional `updateNotebook` after it. Two concurrent confirms for
  // DIFFERENT identities on the same unconfirmed notebook both passed that
  // read-time check and both wrote — the second silently winning. The guard
  // now lives INSIDE `confirmNotebookIdentity`'s own UPDATE ... WHERE clause
  // (`notebook-manual-acquisition.ts`), so the check and the write are one
  // atomic statement under Postgres's row lock. See that function's doc
  // comment for the exact truth table (byte-identical to the one this
  // comment used to describe) and why it's safe under concurrency.
  //
  // The deliberate, human-driven "change this notebook's identity" flow is
  // the generic `PATCH /api/equipment-notebooks/[id]` (the notebook Settings
  // edit) — unconditional today, exactly as every rebind that UI already
  // performs, and this guard does not touch that route. "Not this" (reject)
  // never writes here either (see the route header above), so it needs no
  // change.
  const confirmResult = await confirmNotebookIdentity(ctx.tenantId, notebookId, {
    manufacturer,
    model,
    catalogNumber,
  });
  if (!confirmResult.ok) {
    if (confirmResult.error === "identity_already_confirmed") {
      return NextResponse.json(
        {
          error: "identity_already_confirmed",
          manufacturer: confirmResult.manufacturer,
          model: confirmResult.model,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "confirm_failed" }, { status: 500 });
  }

  const identity = {
    identityStatus: "user_confirmed" as const,
    manufacturer,
    model,
    catalogNumber,
  };

  // Migration 104's promotion trigger runs inside the UPDATE's own
  // transaction (commit-synchronous), so this read already sees the
  // post-promotion state — never a window where the identity is confirmed
  // but an already-verified candidate manual isn't yet usable.
  // Codex F3 (MEDIUM, round 2): "ready" means a manual that APPLIES to THIS
  // confirmed identity — not merely "any enabled+verified row", which let an
  // unrelated ready manual (e.g. a Rockwell manual while SMC is confirmed)
  // falsely satisfy readiness AND suppress the search. `applicableReadySource`
  // requires the SAME evidence `fencedWriter`/`reconcileAcquisition` already
  // use (`matchEvidence.autoAcquisitionKey === acquisitionKey(identity)`),
  // plus role "manual" and `readiness.canChat` — never a new matcher.
  let manualReady = false;
  try {
    const sources = await listSources(ctx.tenantId, notebookId);
    manualReady = applicableReadySource(sources, identity) !== null;
  } catch (err) {
    // Fail-safe, not fail-closed: the identity write already succeeded. A
    // Sources read failure must not report a 500 for a confirm that worked —
    // it reports the honest (possibly stale) `manualReady: false` instead.
    console.warn(
      `[identity-confirm] listSources failed notebook=${notebookId}: ${(err as Error).message}`,
    );
  }

  // Codex F5 (MEDIUM): confirming must never promise a search it doesn't
  // start. No manual is ready yet → start the SAME background search the
  // candidate-basis chat-route flow would (startManualAcquisition owns its
  // own claim/idempotency and the acquisitionEnabled feature gate — never a
  // second acquisition path here). `searching` is true only when a search is
  // honestly underway: either this call just started one, or the acquisition
  // record already holds a running search for this EXACT identity key (the
  // candidate-basis search may have started it before this confirmation —
  // startManualAcquisition's own claim() already refused the duplicate).
  let searching = false;
  // Codex round 3 F4: the structured `startedAt` the host-side follower keys
  // its retry budget on (`manual-search-follow.ts`'s generation). Resolved
  // by reading the record back after claiming it — `claim()`'s `started_at`
  // is the DB's own `now()`, never a value this route invents.
  let startedAt: string | null = null;
  if (!manualReady && acquisitionEnabled()) {
    const justClaimed = await startManualAcquisition({
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      notebookId,
      nodeId: notebook.nodeId,
      identity,
    });
    try {
      const rec = await readAcquisition(ctx.tenantId, notebookId);
      const key = acquisitionKey(identity);
      const isThisSearch = rec !== null && key !== null && rec.key === key && rec.state === "running";
      searching = justClaimed || isThisSearch;
      if (isThisSearch) startedAt = rec!.started_at;
    } catch (err) {
      // Fail-safe: the identity write (and the claim, if this call made one)
      // already succeeded; an unreadable record just means this response
      // can't attach a generation or confirm someone ELSE's search is
      // running — it still honestly reports a search THIS call started.
      searching = justClaimed;
      console.warn(
        `[identity-confirm] readAcquisition failed notebook=${notebookId}: ${(err as Error).message}`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    notebookId,
    manufacturer,
    model,
    catalogNumber,
    manualReady,
    // Codex F4 round 2 (MEDIUM): a structured signal — not scraped from
    // `message` text — telling the canonical adapters (`UnifiedChat.tsx`,
    // `hub-host.tsx`) whether to START following search progress. Only
    // `true` when a search is honestly underway (see `searching` above);
    // never set when the flag is off or nothing is searching, so a client
    // never follows a search that was never started.
    searching,
    ...(startedAt ? { startedAt } : {}),
    message: manualReady
      ? `Confirmed — I found the ${manufacturer} ${model} manual and it's ready to answer from.`
      : searching
        ? `Confirmed as a ${manufacturer} ${model}. I'll look for its manual.`
        : `Confirmed as a ${manufacturer} ${model}. No automatic manual search was started — add its manual in Sources.`,
  });
}
