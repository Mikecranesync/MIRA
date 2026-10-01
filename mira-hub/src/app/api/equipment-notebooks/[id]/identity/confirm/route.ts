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
 * body and calls the SAME `updateNotebook` seam the Hub's generic
 * `PATCH /api/equipment-notebooks/[id]` already uses (see that route's own
 * header: "PATCH ... — edit identity/metadata"). Writing
 * `identity_status = 'user_confirmed'` fires the
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
import { getNotebook, listSources, updateNotebook } from "@/lib/equipment-notebooks";
import {
  acquisitionEnabled,
  acquisitionKey,
  readAcquisition,
  startManualAcquisition,
} from "@/capabilities/notebook-manual-acquisition";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD_LEN = 200;

/** A trimmed, length-bounded string, or "" when absent/not a string — never
 *  null/undefined, so every caller can pass the result straight to
 *  `updateNotebook` without an extra presence check. */
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

  const ok = await updateNotebook(ctx.tenantId, notebookId, {
    manufacturer,
    model,
    catalogNumber,
    identityStatus: "user_confirmed",
    // "user": the technician asserted this identity directly (closest fit of
    // the four values migration 073's CHECK allows — manual/nameplate_image/
    // user/existing_asset; there is no "chat_proposal" value, and adding one
    // is a migration this narrow route does not need).
    identitySourceType: "user",
  });
  if (!ok) {
    return NextResponse.json({ error: "confirm_failed" }, { status: 500 });
  }

  // Migration 104's promotion trigger runs inside the UPDATE's own
  // transaction (commit-synchronous), so this read already sees the
  // post-promotion state — never a window where the identity is confirmed
  // but an already-verified candidate manual isn't yet usable.
  // Codex F3 (MEDIUM): "ready" means an APPLICABLE, ANSWERABLE manual — not
  // merely "any enabled+verified row". Mirrors validateChatSources' own trust
  // bar (matchState IN ('verified','user_confirmed') AND enabled) plus two
  // checks that route lacks a reason to make (it only ever validates
  // requested docs, never claims "a manual exists"): sourceRole === "manual"
  // (an enabled, verified wiring diagram is not the manual the card promised)
  // and readiness.canChat (a verified row that failed materialization has no
  // citable text yet, however trusted its match state is).
  let manualReady = false;
  try {
    const sources = await listSources(ctx.tenantId, notebookId);
    manualReady = sources.some(
      (s) =>
        s.sourceRole === "manual" &&
        s.enabledByDefault &&
        (s.matchState === "verified" || s.matchState === "user_confirmed") &&
        s.readiness.canChat,
    );
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
  if (!manualReady && acquisitionEnabled()) {
    const identity = {
      identityStatus: "user_confirmed" as const,
      manufacturer,
      model,
      catalogNumber,
    };
    searching = await startManualAcquisition({
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      notebookId,
      nodeId: notebook.nodeId,
      identity,
    });
    if (!searching) {
      try {
        const rec = await readAcquisition(ctx.tenantId, notebookId);
        const key = acquisitionKey(identity);
        searching = rec !== null && key !== null && rec.key === key && rec.state === "running";
      } catch (err) {
        // Fail-safe: the identity write already succeeded; an unreadable
        // record just means this response can't confirm a search is
        // running — it stays honest and says so below.
        console.warn(
          `[identity-confirm] readAcquisition failed notebook=${notebookId}: ${(err as Error).message}`,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    notebookId,
    manufacturer,
    model,
    catalogNumber,
    manualReady,
    message: manualReady
      ? `Confirmed — I found the ${manufacturer} ${model} manual and it's ready to answer from.`
      : searching
        ? `Confirmed as a ${manufacturer} ${model}. I'll look for its manual.`
        : `Confirmed as a ${manufacturer} ${model}. No automatic manual search was started — add its manual in Sources.`,
  });
}
