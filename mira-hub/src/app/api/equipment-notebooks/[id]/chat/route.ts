/**
 * POST /api/equipment-notebooks/[id]/chat — source-grounded notebook chat (SSE).
 *
 * The retrieval boundary IS the product (PRD §12): every requested source id is
 * validated as (tenant ∧ notebook ∧ not-rejected) BEFORE retrieval; the SQL
 * predicate `doc_id = ANY($::uuid[])` in retrieveNodeChunks enforces the set on
 * both tsquery passes — never app-side filtering after the fact. Zero retrieved
 * evidence → structured `insufficient_evidence`, no provider call, no invented
 * answer (Gate G). Every turn persists its source snapshot + evidence (§8.3).
 *
 * Frames (typed — src/lib/notebook-chat-types.ts). REAL wire order, per path:
 *   answered : `content`* → `sources` → `evidence` → [`usage`] → `status`
 *              → [`followups`] → `data: [DONE]`
 *   abstain  : `sources` (empty) → `status` → `[DONE]`
 *   safety   : `sources` (empty) → `content`* → `safety` → `status` → `[DONE]`
 * `sources` is emitted AFTER generation on the answered path — citations are
 * filtered to the [n] the answer actually used, which is unknowable before
 * the model finishes. `usage` (MIRA_CANONICAL_SEAM only) rides before
 * `status`; existing clients ignore unknown kinds (mira-mobile sse.ts is an
 * if/else-if chain), so additive frames are backward compatible.
 * chat-stop-persist.test.ts pins this order so the comment cannot drift again.
 *
 * PROVIDER SELECTION: `providers()` below is the LEGACY inline cascade and is
 * the fallback path. When MIRA_CANONICAL_SEAM=1 the turn is served by the
 * canonical seam (@/lib/inference/canonical-cascade), which is the single
 * definition of the cascade and matches Hard Constraint #2 (Groq → Cerebras →
 * Together). The legacy list still contains Gemini; that divergence is exactly
 * what the seam removes (P0004 map §10 Q4).
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { composeTimeout } from "@/lib/abort-helpers";
import { relevantQuoteWindow } from "@/lib/quote-window";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import {
  getNotebook,
  listSources,
  recordTurn,
  resolveBoundAsset,
  validateChatSources,
  type ResolvedAsset,
  originFileIdsByDoc,
} from "@/lib/equipment-notebooks";
import { matchSafetyStop, SAFETY_STOP } from "@/lib/safety-classifier";
import {
  buildRequestBody,
  canonicalProviders,
  canonicalSeamEnabled,
  exhaustedUsage,
  logTurnUsage,
  maxOutputTokens,
  routeReasonFor,
  usageFrame,
  usageFromRaw,
  type TurnUsage,
} from "@/lib/inference/canonical-cascade";
import { persistTurnUsage } from "@/lib/inference/persist-usage";
import {
  appendManualContext,
  buildManualUserContent,
  retrieveNodeChunks,
  type ManualChunk,
} from "@/lib/manual-rag";
import {
  sanitizeHistory,
  buildRetrievalQuery,
  buildTopicHint,
  classifyBroad,
  classifyCoverage,
  facetEvidencePages,
  type ChatHistoryTurn,
} from "@/lib/notebook-query";
import {
  packetFromMachineMemoryResponse,
  renderMachineEvidenceSection,
  type MachineContextPacket,
} from "@/lib/machine-context-packet";
import { sanitizeMachineMemoryField } from "@/lib/machine-memory-sanitize";
import { clampSpan, fetchMachineHistory, parseAnchor, type HistoryCoverage } from "@/lib/machine-history";
import { photoLinkedToTarget } from "@/lib/workspace-files";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";
import type {
  EvidenceCitation,
  MachineEvidenceEntry,
  NotebookContentFrame,
  NotebookEvidenceFrame,
  NotebookFollowupsFrame,
  NotebookSafetyFrame,
  NotebookSourcesFrame,
  NotebookStatusFrame,
  SafetyNoticeEntry,
  VisualObservationEntry,
} from "@/lib/notebook-chat-types";
import { buildFollowupSuggestions } from "@/lib/notebook-followups";

export const dynamic = "force-dynamic";

const BASE_SYSTEM_PROMPT = `You are MIRA, a maintenance assistant for ONE specific machine. Answer ONLY from the numbered reference excerpts provided below.

ANSWER SHAPE — a technician is standing at the machine and needs the answer fast:
- Lead with the direct answer in the FIRST sentence: the parameter number, terminal number, fault meaning, value, or action. e.g. "P042 [Decel Time 1] sets the deceleration ramp [1]."
- Then at most one or two short sentences of explanation. Stop there.
- Do NOT open with background, generic safety boilerplate, or a restatement of the question.

ENERGY STATE — this rule outranks brevity:
- If an answer directs physical contact with wiring, terminals, bus capacitors, guards, belts, chains, couplings, or any rotating or moving part, state the required energy-isolation state IN THE SAME SENTENCE as the instruction — not as a trailing caution. e.g. "With the drive isolated, locked out and the DC bus verified at 0 V, check continuity across terminals 07-08 [2]."
- Never omit that clause to keep the answer short. Brevity is for the explanation, never for the isolation condition.
- Describe an observation (what a reading means) without an isolation clause; an instruction to touch, open, remove, or probe always carries one.

GROUNDING & CITATIONS:
- Cite every factual claim inline like [1] or [2], matching the numbered excerpts.
- Preserve parameter IDs, fault codes, terminal identifiers, and units EXACTLY (P042, F004, terminal 07, 60 Hz).
- Cite ONLY an excerpt that actually supports the sentence it is attached to. Never cite an excerpt just because it was retrieved.
- If the excerpts do not contain the answer, say so plainly in one sentence and cite NOTHING. Never present unrelated pages as if they were evidence.

PREMISE CHECK — a technician sometimes asks for something in a form the machine doesn't have:
- If the excerpts SHOW the asked-for thing exists only in a different form — e.g. a protocol the excerpts prove is available ONLY via an optional communication adapter/module (not a built-in parameter), or a feature that lives under a different name — do NOT just say "not found". Correct the premise in one sentence and cite it, e.g. "This drive has no built-in PROFINET parameter; PROFINET is available only through an optional communication adapter [n]." Then point to the real path (the adapter, or the correct parameter).
- Do this ONLY when an excerpt actually supports the correction. If nothing in the excerpts speaks to the asked-for thing at all (e.g. a hydraulic system on a VFD), abstain as usual in one sentence with no citation — never invent a correction.

PRECISION RULES:
- A monitoring/display value (e.g. b001, b002, "Output Freq", "Commanded Freq") is NOT a setting. Never tell the user to "set" a display parameter. If asked how to set something, give the configuration parameter, not the monitor.
- When a question is genuinely ambiguous (e.g. "second speed" may mean Speed Reference 2 OR a preset frequency), give BOTH concise interpretations or ask ONE targeted clarifying question — do not dump loosely related parameters.
- If the excerpts only partially cover the topic and the authoritative detail is likely in a fuller manual, answer what you found and note the complete specification may be in the full user manual.

MACHINE OVERVIEW — if asked what you know about the machine, or for an overview: state the equipment identity (manufacturer/model), the documents currently loaded and what they cover, and any coverage limitation. Do NOT merely summarize the first excerpt.`;

/**
 * General mode (spec §1.1 Universal Technician Rule). Used ONLY when the client
 * explicitly asks for `mode: "general"`, and never mixed with excerpts — the
 * whole point is that the technician can tell the two apart.
 *
 * The hard rule in this prompt is the bracket ban. `BASE_SYSTEM_PROMPT` teaches
 * the model to cite as `[1]`, and the mobile client renders `[n]` as a citation
 * chip. A general answer has no sources, so a stray `[1]` would render as a
 * chip pointing at nothing — model reasoning wearing the costume of an OEM
 * citation, which is exactly what §1.3 forbids. The route also strips any that
 * survive; this is the first of the two guards, not the only one.
 */
const GENERAL_SYSTEM_PROMPT = `You are MIRA, a maintenance assistant helping a technician who is standing at a machine RIGHT NOW. No manual for this machine has been loaded, so you are reasoning from general electrical, mechanical, and controls knowledge.

ANSWER SHAPE — the technician needs something they can act on:
- Lead with the most likely cause or the first thing to check, in the FIRST sentence.
- Then a short ordered list of checks, cheapest and safest first.
- Ask a diagnostic question when one answer would genuinely change your advice. Ask at most one.
- Keep it under about 150 words.

HONESTY:
- You have NO manual for this machine. Never state a specific parameter number, terminal number, torque value, fault-code meaning, or wiring detail as if it were confirmed for this exact model. Say what it typically is and that it must be verified against the unit's own manual.
- If the question genuinely cannot be answered without model-specific documentation, say that plainly and say which document would settle it.
- NEVER write bracketed numeric markers like [1] or [2]. You have no sources to cite. There is nothing for a bracket to point at.

SAFETY: assume the equipment may be energized. Where a check requires isolation, say so before the step.`;

type CascadeProvider = { name: string; url: string; key?: string; model: string };

/**
 * LEGACY inline cascade — the fallback when MIRA_CANONICAL_SEAM is off.
 * Diverges from Hard Constraint #2 by listing Gemini; kept byte-identical so
 * the flag-off path is provably unchanged. Delete when the seam is default-on.
 */
function providers(): CascadeProvider[] {
  return [
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      // llama-3.3-70b-versatile shuts down 2026-08-16 (Phase 1.5 bakeoff §7 P0);
      // default to the current gpt-oss model so the primary provider keeps serving.
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    },
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_MODEL ?? "gpt-oss-120b",
    },
    {
      name: "Gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    },
  ];
}

/** Build numbered, per-doc citations consistent with appendManualContext's [n]
 *  blocks (same ordering source: the chunk array). */
async function buildCitations(
  tenantId: string,
  notebookId: string,
  chunks: ManualChunk[],
  question: string,
): Promise<EvidenceCitation[]> {
  const seen = new Map<string, EvidenceCitation>();
  for (const c of chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      citationId: String(seen.size + 1),
      docId: c.docId ?? "",
      sourceTitle: c.title || "Attached document",
      page: c.sourcePage,
      fileId: null,
      // Claim-centered window (CIT-07 phase 2) — not the chunk head.
      quote: relevantQuoteWindow(c.content, question),
    });
  }
  const citations = [...seen.values()];
  const docIds = [...new Set(citations.map((c) => c.docId).filter(Boolean))];
  if (docIds.length > 0) {
    // Parked-original ids for the byte-serving viewer (raw pool: hub family).
    const files = await pool.query(
      `SELECT upload_id::text AS doc_id, id::text AS file_id
         FROM namespace_direct_uploads
        WHERE tenant_id = $1 AND upload_id = ANY($2::uuid[])`,
      [tenantId, docIds],
    );
    const fileByDoc = new Map<string, string>(
      files.rows.map((r: Record<string, unknown>) => [String(r.doc_id), String(r.file_id)]),
    );
    for (const c of citations) c.fileId = fileByDoc.get(c.docId) ?? null;
    // Invariant 3 (085): the CANONICAL origin is resolved server-side — a
    // photo-derived doc's citation carries the photograph's file id, so no
    // client ever reconstructs provenance by joining duplicate source rows.
    const originByDoc = await originFileIdsByDoc(tenantId, notebookId, docIds);
    for (const c of citations) c.originFileId = originByDoc.get(c.docId) ?? null;
  }
  return citations;
}

/** gpt-oss models emit OpenAI-style citation markers (`【3】`, `【4†L1-L7】`)
 *  instead of `[3]`. Normalize to `[n]` so the UI renders clickable chips and
 *  citation-entailment can match. Streaming-safe: a delta that ends mid-marker
 *  (an open `【` with no closing `】`) is held back until the marker completes. */
/**
 * General-mode citation-marker STRIPPER (spec §1.3).
 *
 * A general answer has no sources, so a `[1]` it emits anyway points at nothing
 * — and mira-mobile renders `[n]` as a citation chip, so it would appear as
 * documentary proof that does not exist. The system prompt forbids the markers;
 * this removes any that survive.
 *
 * Streaming-safe for the same reason makeCitationNormalizer is: a marker can be
 * split across deltas (`[` then `1]`). A trailing partial `[` or `[12` is held
 * back rather than emitted, so it can never escape as visible text.
 */
export function makeGeneralBracketStripper(): { push: (delta: string) => string; flush: () => string } {
  let pending = "";
  return {
    push(delta: string): string {
      const buf = pending + delta;
      // Drop any COMPLETE marker, along with whitespace immediately before it.
      let out = buf.replace(/[ 	]*\[\d+\]/g, "");
      // Hold back a trailing partial marker ("[", "[1", "[12") — it may complete
      // on the next delta. Trailing whitespace is held for the same reason: the
      // space before a marker usually arrives in an EARLIER delta, and once
      // emitted it cannot be taken back, leaving "P042  on this drive".
      const partial = out.match(/[ 	]*\[\d*$|[ 	]+$/);
      if (partial) {
        pending = partial[0];
        out = out.slice(0, out.length - partial[0].length);
      } else {
        pending = "";
      }
      return out;
    },
    flush(): string {
      // Whatever is still held back never completed, so it was not a marker.
      const rest = pending;
      pending = "";
      return rest;
    },
  };
}

export function makeCitationNormalizer(): { push: (delta: string) => string; flush: () => string } {
  let pending = "";
  return {
    push(delta: string): string {
      let buf = pending + delta;
      // Replace any COMPLETE fancy-bracket citation with [n].
      buf = buf.replace(/【\s*(\d+)(?:\s*†[^】]*)?】/g, "[$1]");
      // If an unclosed `【` remains, hold from it back (marker split across deltas).
      const open = buf.lastIndexOf("【");
      if (open !== -1) {
        pending = buf.slice(open);
        return buf.slice(0, open);
      }
      pending = "";
      return buf;
    },
    // Emit any held text at stream end (a malformed/unclosed marker), normalized.
    flush(): string {
      const out = pending.replace(/【\s*(\d+)(?:\s*†[^】]*)?】/g, "[$1]");
      pending = "";
      return out;
    },
  };
}

/** A prose refusal ("I could not find that in the selected sources") must NOT
 *  ship citations — otherwise unrelated retrieved pages render as false proof
 *  (the anti-pattern this closes). Detect the model's own honest-refusal phrasing. */
export function isRefusal(answer: string): boolean {
  const a = answer.toLowerCase();
  return (
    /\b(could|couldn'?t|can'?t|cannot|do(?:es)? not|don'?t)\b[^.]*\b(find|contain|include|have|see)\b/.test(a) &&
    /\b(excerpt|source|reference|document|manual|provided|selected|information)\b/.test(a) &&
    a.length < 400
  );
}

/** Assemble the provider messages: system prompt, then the sanitized
 *  conversation history (so a follow-up has memory of the thread), then the
 *  current user turn carrying the fresh grounding excerpts. Prior turns are plain
 *  text — only the CURRENT turn gets the retrieved excerpts, so the model always
 *  grounds the live question in live evidence. Exported for unit testing. */
export function buildProviderMessages(
  systemPrompt: string,
  history: ChatHistoryTurn[],
  userContent: string,
): { role: string; content: string }[] {
  return [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userContent },
  ];
}

/** A provider-cascade catch may only swallow EXTERNAL failures (network, HTTP,
 *  timeout/abort). A programming error thrown inside the cascade is a bug in
 *  THIS route and must fail loud — swallowing one masquerades as "No answer
 *  provider available" (the stale-variable incident: every question errored
 *  with clean 200s and nothing in the logs). undici reports network failure as
 *  TypeError("fetch failed"), so TypeError disambiguates on message. */
export function isProviderCascadeError(err: unknown): boolean {
  if (err instanceof DOMException) return true; // TimeoutError / AbortError
  if (err instanceof TypeError) return /fetch/i.test(err.message);
  if (
    err instanceof ReferenceError ||
    err instanceof RangeError ||
    err instanceof SyntaxError ||
    err instanceof EvalError ||
    err instanceof URIError
  ) {
    return false;
  }
  return true;
}

/** Citation-entailment (lite): keep only citations the answer actually used via
 *  a [n] marker. Kills "cite a retrieved page that didn't support anything". */
export function citationsUsedInAnswer(answer: string, citations: EvidenceCitation[]): EvidenceCitation[] {
  const used = new Set(
    [...answer.matchAll(/\[(\d+)\]/g)].map((m) => m[1]),
  );
  return citations.filter((c) => used.has(c.citationId));
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * The streamed safety hard-stop. Same frame grammar as every other notebook
 * turn — `sources` (empty) → `content`… → `safety` → `status` → `[DONE]` — so a
 * client that knows nothing about safety still renders it as an ordinary,
 * complete answer rather than breaking on an unfamiliar shape.
 *
 * Content is chunked by word to match the streaming cadence of a normal answer;
 * a single blob arrives as a jarring instant wall of text next to every other
 * reply the technician has seen.
 */
function safetyStopResponse(trigger: string, docIds: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sources: NotebookSourcesFrame = { kind: "sources", citations: [], sourceSnapshot: docIds };
      controller.enqueue(enc.encode(sse(sources)));
      for (const word of SAFETY_STOP.split(" ")) {
        const frame: NotebookContentFrame = { kind: "content", content: word + " " };
        controller.enqueue(enc.encode(sse(frame)));
      }
      const safety: NotebookSafetyFrame = { kind: "safety", trigger };
      controller.enqueue(enc.encode(sse(safety)));
      const status: NotebookStatusFrame = { kind: "status", status: "answered" };
      controller.enqueue(enc.encode(sse(status)));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      // Observability parity with the asset- and node-chat routes.
      "X-Safety-Stop": trigger,
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id: notebookId } = await params;

  let body: {
    message?: string;
    sourceDocIds?: string[];
    history?: unknown;
    mode?: string;
    /** Sensor REPLAY (contract §4.4): the fault window the technician selected.
     *  Only the SELECTION is trusted — the server re-fetches the rows itself. */
    machineEvidence?: { assetId?: unknown; anchorAt?: unknown; pre?: unknown; post?: unknown };
    /** Sensor LOOK (S5 D3 cross-lane contract): the phone photo this turn was
     *  asked with. NOTHING here is trusted but the file id: the server verifies
     *  the file is linked to this notebook AS A PHOTO and re-derives the whole
     *  entry (capture time included) from the stored file row; unverified →
     *  ignored. `capturedAt` is still accepted for client compatibility and is
     *  never read. */
    visualEvidence?: { fileId?: unknown; capturedAt?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  // Machine-evidence selection (§4.4). Validated up front so a malformed
  // window is a 400, never a silent "answered without the machine".
  let machineRequest: { assetId: string; at: string; pre: number; post: number } | null = null;
  if (body.machineEvidence !== undefined && body.machineEvidence !== null) {
    const me = body.machineEvidence;
    const assetId = typeof me?.assetId === "string" ? me.assetId.trim() : "";
    const at = parseAnchor(me?.anchorAt);
    if (!assetId || !at) {
      return NextResponse.json(
        { error: "machine_evidence_invalid", message: "machineEvidence needs assetId and an ISO-8601 anchorAt." },
        { status: 400 },
      );
    }
    machineRequest = { assetId, at, pre: clampSpan(me.pre, 5), post: clampSpan(me.post, 2) };
  }
  // Visual-evidence claim (D3). Never a 4xx: a malformed or foreign claim is
  // dropped silently and the turn is answered without it. The claim is a FILE
  // ID and nothing else — `capturedAt` is client-supplied, so it is neither
  // required nor read (the server derives the capture time from the file row).
  let visualClaimFileId: string | null = null;
  if (body.visualEvidence && typeof body.visualEvidence === "object") {
    const raw = body.visualEvidence.fileId;
    const fileId = typeof raw === "string" ? raw.trim() : "";
    if (fileId) visualClaimFileId = fileId;
  }
  // Spec §1.1 — a technician with nothing configured must still get help, and
  // §1.4 — that must be an EXPLICIT state, never a silent relaxation of
  // grounding. So general mode is opt-in per turn: the client asks for it, the
  // answer is labelled, and it can carry no citations. Grounded mode below is
  // untouched; with zero chunks it still abstains without calling a provider.
  const general = body.mode === "general";
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message_required" }, { status: 400 });
  if (message.length > 4000) {
    return NextResponse.json({ error: "message_too_long" }, { status: 400 });
  }
  // Multi-turn memory: the client sends the recent thread; we cap/sanitize it,
  // pass it to the model for continuity, and use it to rewrite the retrieval
  // query so a referential follow-up ("what about Ethernet?", "the other one")
  // retrieves on the thread's subject instead of its own thin words.
  const history = sanitizeHistory(body.history);

  // SAFETY HARD-STOP. Evaluated here, before retrieval and before any provider
  // call, because this notebook is the surface a technician uses while standing
  // at a running machine — and it is the one chat route in the Hub that had no
  // guardrail at all. The asset- and node-chat routes already stop here; this
  // reuses their classifier rather than adding a second policy, which keeps the
  // educational carve-out ("what is arc flash?" is a question, not a hazard
  // report) that a fresh keyword list would silently lose.
  const safetyTrigger = matchSafetyStop(message);

  // PRD §27: no sources selected is an explicit, honest state — not a silent
  // fall-through to the global corpus.
  const validated = await validateChatSources(ctx.tenantId, notebookId, body.sourceDocIds ?? []);
  if (!validated.ok) {
    // "Smoke is coming from the panel" in a notebook with nothing attached must
    // not be answered with a filing complaint. `no_sources_selected` already
    // proves the notebook exists and belongs to this tenant (the resolver
    // returns `notebook_not_found` otherwise), so the stop is safe to serve and
    // safe to persist here.
    if (safetyTrigger && validated.error === "no_sources_selected") {
      const safetyEntry: SafetyNoticeEntry = { kind: "safety_notice", trigger: safetyTrigger };
      await recordTurn(ctx.tenantId, notebookId, {
        question: message,
        answerStatus: "answered",
        answerText: SAFETY_STOP,
        enabledSourceDocIds: [],
        evidence: [safetyEntry],
        model: null,
      });
      return safetyStopResponse(safetyTrigger, []);
    }
    // A notebook with nothing attached is exactly the case the Universal
    // Technician Rule exists for: the technician is standing at a machine with
    // no manual loaded and still needs help.
    //
    // OWNERSHIP MUST BE PROVEN HERE, EXPLICITLY. `no_sources_selected` is
    // returned from an early `requestedDocIds.length === 0` check that never
    // touches the database, so — contrary to the comment on the safety-stop
    // branch above — it does NOT establish that this notebook belongs to the
    // caller. Letting it stand in for ownership would let any notebook id spend
    // this tenant's provider budget. getNotebook() is tenant-scoped.
    if (general && validated.error === "no_sources_selected") {
      if (!(await getNotebook(ctx.tenantId, notebookId))) {
        return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
      }
    } else {
      const status =
        validated.error === "notebook_not_found"
          ? 404
          : validated.error === "no_sources_selected"
            ? 422
            : 403;
      return NextResponse.json({ error: validated.error }, { status });
    }
  }

  // Grounded mode keeps the validated doc set as its boundary. General mode
  // deliberately has none: it retrieves nothing, so there is nothing to scope.
  const docIds: string[] = validated.ok ? validated.docIds : [];
  const nodeId = validated.ok ? validated.nodeId : null;

  // Which machine is this turn about? Resolved BEFORE retrieval, so an
  // unresolvable binding costs nothing: no retrieval SQL, no provider call.
  const boundAsset: ResolvedAsset = await resolveBoundAsset(ctx.tenantId, notebookId);
  if (boundAsset.state === "unresolvable") {
    // Fail closed. Quietly answering as if unbound is the downgrade
    // .claude/rules/direct-connection-uns-certified.md forbids — the notebook
    // would keep showing the last stored machine name while answering about
    // nothing in particular.
    //
    // `error` is a sentence and `code` is the discriminator: mira-mobile renders
    // `data.error` verbatim (client.ts:198-208), so returning only the token
    // puts the literal string "uns_required" on the technician's phone.
    return NextResponse.json(
      {
        error:
          "This notebook points at equipment that is no longer available in your account. " +
          "Re-select the machine before asking about it.",
        code: "uns_required",
        notebookId,
        entityId: boundAsset.entityId,
      },
      { status: 422 },
    );
  }
  // Snapshot for every persisted turn, including abstains and safety stops: a
  // refusal about a specific machine is still a record about that machine.
  const assetSnapshot =
    boundAsset.state === "resolved"
      ? { equipmentEntityId: boundAsset.entityId, assetUnsPath: boundAsset.unsPath }
      : { equipmentEntityId: null, assetUnsPath: null };

  // The stop is persisted like any other turn so it survives the technician
  // switching devices mid-incident — spec §10 requires the warning to be
  // retained on resume, and a warning that lives only in a stream is not.
  if (safetyTrigger) {
    const safetyEntry: SafetyNoticeEntry = { kind: "safety_notice", trigger: safetyTrigger };
    await recordTurn(ctx.tenantId, notebookId, {
      question: message,
      answerStatus: "answered",
      answerText: SAFETY_STOP,
      enabledSourceDocIds: docIds,
      evidence: [safetyEntry],
      model: null,
      ...assetSnapshot,
    });
    return safetyStopResponse(safetyTrigger, docIds);
  }

  // Sensor REPLAY grounding (contract §4.4). The server re-fetches the selected
  // window through the SAME reader the history route uses (fetchMachineHistory
  // — never client-supplied rows), reshapes the Machine Memory header into the
  // context packet, and attaches the recorded observations as the packet's
  // replay window. This is the block assets/[id]/chat/route.ts already runs
  // for live turns (buildMachineContextPacket + renderMachineEvidenceSection
  // with sanitizeMachineMemoryField), ported here; document retrieval above
  // is untouched. Own try/catch, same as the asset route: a missing 033/037/
  // 040 env or any error never drops the notebook context already built.
  let machinePacket: MachineContextPacket | null = null;
  let machineEntry: MachineEvidenceEntry | null = null;
  // Workstream C (§9.2): why the served window is NOT grounding, when it
  // isn't — kept apart so "nothing recorded" and "no history source" are
  // never one sentence.
  let machineUnavailableReason: "no_uns_path" | "no_fault_window" | "unavailable" | "fetch_failed" | null = null;
  let machineCoverage: HistoryCoverage | null = null;
  if (machineRequest) {
    const mr = machineRequest;
    try {
      const result = await withTenantContext(ctx.tenantId, (c) =>
        fetchMachineHistory(c, ctx.tenantId, mr.assetId, { at: mr.at, pre: mr.pre, post: mr.post }),
      );
      if (result.ok) {
        const h = result.history;
        machineCoverage = h.coverage;
        if (h.reason === "unavailable") machineUnavailableReason = "unavailable";
        machinePacket = packetFromMachineMemoryResponse(ctx.tenantId, mr.assetId, h.summary);
        machinePacket.replay = {
          anchor_at: h.anchor.at,
          started_at: h.from,
          stopped_at: h.to,
          freshness: h.freshness.overall,
          rows: h.rows,
        };
        // Anchored-window variant of the evidence window (same EvidenceWindow
        // shape the card uses) so the prompt names the replayed bounds.
        machinePacket.evidence.window = { started_at: h.from, stopped_at: h.to, uns_path: h.uns_path };
        machineEntry = {
          kind: "machine_evidence",
          assetId: mr.assetId,
          anchorAt: h.anchor.at,
          pre: h.pre,
          post: h.post,
          rowCount: h.rows.length,
          freshness: h.freshness.overall,
          runId: h.anchor.runId ?? null,
          windowId: h.anchor.windowId ?? null,
          // Contract §2.8: "the tables are missing" and "the window was
          // genuinely quiet" are DIFFERENT sentences. The reader already
          // distinguishes them; carry that distinction to the clients instead
          // of flattening both into "0 observed changes".
          ...(h.reason ? { reason: h.reason } : {}),
        };
      } else {
        console.warn("[notebook-chat] machine evidence not available:", result.error);
        machineUnavailableReason = result.error;
      }
    } catch (err) {
      console.error("[notebook-chat] machine evidence fetch failed:", err);
      machinePacket = null;
      machineEntry = null;
      machineUnavailableReason = "fetch_failed";
    }
  }
  // Nothing observed → nothing to ground on (contract §2.8, D2). A window that
  // is `unavailable` (033/037 missing in this env) or genuinely empty must not
  // move `basis` to a machine basis and must not put a MACHINE section in the
  // prompt — an empty section is an invitation to infer. The ENTRY is still
  // persisted (with `rowCount: 0` and its `reason`, when it has one) so both
  // clients can say which of the two happened. Nulling the packet also keeps
  // the machine-only approved-context gate off a turn that isn't using
  // machine evidence.
  const groundedMachineEntry: MachineEvidenceEntry | null =
    machineEntry && machineEntry.rowCount > 0 && machineEntry.reason !== "unavailable" ? machineEntry : null;
  if (!groundedMachineEntry) machinePacket = null;

  // Workstream C (PRD §9.2 / #3469): a replay ask whose served window holds
  // no admissible recorded observation is REFUSED here — at the seam that
  // owns the truth — before any retrieval-backed answer, any provider call,
  // and any persistence. Answering from documents while carrying an empty
  // machine-evidence card, or letting the approved-context gate blame
  // "approved asset context", would both dress an empty window as evidence.
  // The two empties stay distinct: `machine_window_empty` (the history source
  // answered: nothing recorded) vs `machine_history_unavailable` (no source
  // to ask). `error` is a sentence (mira-mobile renders it verbatim); `code`
  // is the discriminator. Nothing is recorded: a refused replay is not a turn.
  if (machineRequest && !groundedMachineEntry) {
    // A transient read failure is NOT "history unavailable": the source
    // exists, the read failed. Say so and let the client retry (503), rather
    // than telling the technician the machine has no history.
    if (machineUnavailableReason === "fetch_failed") {
      return NextResponse.json(
        {
          error: "Machine Memory could not be read just now. Try again in a moment.",
          code: "machine_history_read_failed",
        },
        { status: 503 },
      );
    }
    const windowEmpty = machineEntry !== null && machineEntry.reason !== "unavailable";
    if (windowEmpty) {
      return NextResponse.json(
        {
          error: "Nothing was recorded in this window. Widen the window or check the gateway.",
          code: "machine_window_empty",
          coverage: machineCoverage,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        error: "Machine Memory history is not available for this machine, so there is nothing to replay.",
        code: "machine_history_unavailable",
        reason: machineUnavailableReason ?? "unavailable",
        coverage: machineCoverage,
      },
      { status: 422 },
    );
  }

  const retrievalQuery = buildRetrievalQuery(message, history);
  // General mode reads nothing at all: no retrieval SQL, no doc scope. The
  // `nodeId === null` arm is the same case — only the general path can reach
  // here without `validated.ok`, since every other branch returned above.
  const chunks: ManualChunk[] = general || nodeId === null ? [] : await withTenantContext(ctx.tenantId, (client) =>
    retrieveNodeChunks(client, ctx.tenantId, retrievalQuery, {
      nodeId,
      unsPath: null, // notebook nodes are standalone; scope is the doc set
      topK: 6,
      docIds,
      rawQuery: message,
      // validateChatSources() has already proven tenant + notebook membership
      // for every id in docIds — the validated doc set is the boundary, so a
      // document linked from another notebook's node stays retrievable here.
      validatedDocScope: true,
      // Workstream A (#3437/#3468): the SAME server-derived set is the
      // retrieval-admission authority under MIRA_ENFORCE_APPROVED_RETRIEVAL.
      // validateChatSources derives it (tenant-owned, notebook-linked,
      // enabled, user_confirmed/verified, not superseded); the client's
      // `body.sourceDocIds` was only an intersection request. Tenant-private
      // chunks of these docs are admitted without ever being marked globally
      // verified — confirmation is admission, not corpus promotion.
      approvedSourceDocIds: docIds,
    }),
  );

  const enc = new TextEncoder();

  // Grounded mode abstains here; general mode is EXPECTED to have no chunks and
  // is the one path allowed past this gate. Gate G for DOCUMENTS is unchanged:
  // with sources selected and nothing retrieved and nothing else grounding the
  // turn, MIRA still refuses without calling a provider.
  //
  // The third clause is the Sensor REPLAY correction. A served, non-empty
  // machine window IS grounding — it is recorded observation, re-fetched by the
  // server from its own tenant-scoped tables. Before it, the REPLAY question
  // ("what happened around the fault at …") abstained on every notebook that
  // had at least one enabled source, because a fault-window question retrieves
  // no manual chunks: the window was fetched, then thrown away unanswered.
  // `groundedMachineEntry` is non-null ONLY for a window with rows that is not
  // `unavailable` (see above), so an empty or unavailable window leaves this
  // gate exactly as it was — and a turn with no `machineEvidence` at all can
  // never reach the third clause, which is what keeps document refusal
  // behaviour byte-identical.
  if (chunks.length === 0 && !general && !groundedMachineEntry) {
    // Gate G — abstain honestly, persist the turn, never call the provider.
    await recordTurn(ctx.tenantId, notebookId, {
      question: message,
      answerStatus: "insufficient_evidence",
      answerText: null,
      enabledSourceDocIds: docIds,
      evidence: [],
      model: null,
      // An abstain about a specific machine is still a record about that
      // machine — omitting the snapshot here would make "what has MIRA been
      // asked about this conveyor" silently under-count refusals.
      ...assetSnapshot,
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const sources: NotebookSourcesFrame = {
          kind: "sources",
          citations: [],
          sourceSnapshot: docIds,
        };
        const status: NotebookStatusFrame = {
          kind: "status",
          status: "insufficient_evidence",
          message: "I couldn't find that in the selected sources.",
        };
        controller.enqueue(enc.encode(sse(sources)));
        controller.enqueue(enc.encode(sse(status)));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const citations = await buildCitations(ctx.tenantId, notebookId, chunks, message);

  // Sensor LOOK (S5 D3): verify the claimed photo is a workspace file linked
  // to THIS notebook in THIS tenant AS A PHOTO (role='photo' + a viewable
  // raster MIME), then re-derive the WHOLE entry server-side — including
  // `capturedAt`, which comes from the stored file row, never from the client.
  // Anything else (a manual PDF that merely happens to be linked, a foreign
  // file, a stored-only type) → ignored silently; the turn still answers.
  // Never a citation, never in sourceSnapshot, never moves `basis`.
  let visualEntry: VisualObservationEntry | null = null;
  if (visualClaimFileId) {
    try {
      const photo = await photoLinkedToTarget(ctx.tenantId, visualClaimFileId, "equipment_notebook", notebookId);
      if (photo) {
        visualEntry = {
          kind: "visual_observation",
          fileId: photo.fileId,
          capturedAt: photo.capturedAt,
          provenance: "phone_photo",
        };
      } else {
        console.warn("[notebook-chat] visualEvidence ignored: no photo link for this file on this notebook");
      }
    } catch (err) {
      console.error("[notebook-chat] visualEvidence verification failed (continuing without it):", err);
      visualEntry = null;
    }
  }

  // Approved-context gate — for MACHINE evidence only (D3). Mirrors the asset
  // chat route's summary: live real signals count as approved context; the
  // notebook's validated (user_confirmed/verified) sources are its approved
  // documents. Verified kg relationships are not counted on this route (the
  // asset route's inline SQL is not extracted; 0 is the conservative value).
  // Turns WITHOUT machine evidence never reach this gate, so document
  // retrieval behaviour is byte-identical to before.
  //
  // `approvedMachineEvidenceCount` is the fourth counter (approved-context.ts):
  // a REPLAYED window is never live, so `approvedLiveSignalCount` is 0 for it —
  // on prod, where MIRA_ENFORCE_APPROVED_RETRIEVAL=true, every replay of a
  // notebook without retrieved chunks was refusing 412. Recorded observations
  // the SERVER re-fetched from its own tenant-scoped tables are approved
  // context; that is what "the server re-derives" means. The gate keeps its
  // teeth: it now runs for ANY turn that asked for machine grounding, so a
  // window that came back empty or unavailable with no approved documents
  // still refuses.
  if (machineRequest && approvedAskEnforcementEnabled()) {
    const approvedSummary = {
      approvedSourceCount: new Set(chunks.map((c) => c.docId).filter(Boolean)).size,
      verifiedRelationshipCount: 0,
      approvedLiveSignalCount: machinePacket ? machinePacket.freshness.live : 0,
      approvedMachineEvidenceCount: groundedMachineEntry ? groundedMachineEntry.rowCount : 0,
    };
    if (!approvedContextReady(approvedSummary)) {
      const refusal = buildApprovedContextRefusal(approvedSummary);
      // `error` is a sentence (mira-mobile renders it verbatim); `code` is the
      // discriminator.
      return NextResponse.json({ error: refusal.reason, code: "approved_context", ...refusal }, { status: 412 });
    }
  }
  const machineSection = machinePacket
    ? renderMachineEvidenceSection(machinePacket, sanitizeMachineMemoryField)
    : "";

  // Machine-context header — gives the model the equipment identity and the
  // documents actually loaded, so "what do you know about the machine?" answers
  // from notebook facts (identity + coverage) instead of the first excerpt, and
  // so it can flag when the loaded doc only partially covers a question.
  const [nb, srcs] = await Promise.all([
    getNotebook(ctx.tenantId, notebookId).catch(() => null),
    listSources(ctx.tenantId, notebookId).catch(() => [] as { filename: string | null }[]),
  ]);
  const identity = [nb?.manufacturer, nb?.model].filter(Boolean).join(" ") || "an unspecified machine";
  // A bound asset is a stronger identity claim than free-text manufacturer/model,
  // so it is stated explicitly. Until a human confirms it, it is marked SELECTED:
  // a QR scan proves which sticker was scanned, not which machine wears it, and
  // the model must never present a scan as a confirmed identity.
  const assetLine =
    boundAsset.state === "resolved"
      ? " Asset: " +
        (boundAsset.name || "(unnamed)") +
        " — canonical path " +
        boundAsset.unsPath +
        ". " +
        (boundAsset.confirmedAt
          ? "Identity CONFIRMED by a technician."
          : "Identity SELECTED but NOT yet confirmed — if the answer depends on which machine this is, say the identity is unconfirmed.")
      : "";
  const loadedDocs = srcs.map((s) => s.filename).filter(Boolean).join(", ") || "none";
  const machineContext =
    `\n\nMACHINE CONTEXT (facts about this notebook, not retrieved excerpts):\n` +
    `- Equipment: ${identity}${nb?.displayName ? ` — "${nb.displayName}"` : ""}.${assetLine}\n` +
    `- Loaded source documents: ${loadedDocs}.\n` +
    `- Coverage note: a quick-start guide does not replace the full user manual; if a question needs detail the loaded docs lack, say so and point to the full user manual.`;

  // Coverage planning (answer completeness): the answer SHAPE determines how
  // much evidence the answer owes. Family questions get an explicit EVIDENCE
  // MAP (facet → the pages whose excerpts prove it) plus a cover-or-declare-gap
  // contract; generic enumerations keep the enumerate-everything directive;
  // impossible exhaustives get an honest-scope contract.
  const plan = classifyCoverage(message);
  let coverageDirective = "";
  if ((plan.shape === "multi_facet" || plan.shape === "exhaustive") && plan.facets.length) {
    const evidence = facetEvidencePages(chunks, plan.facets);
    const proven = [...evidence].filter(([, pages]) => pages.length);
    const gaps = [...evidence].filter(([, pages]) => !pages.length).map(([f]) => f);
    coverageDirective =
      `\n\nREQUIRED COVERAGE — this is a ${plan.shape === "exhaustive" ? "complete-enumeration" : "multi-facet"} question. ` +
      `The excerpts contain evidence for these distinct options/aspects: ` +
      proven.map(([f, pages]) => `${f} (excerpts from p.${pages.join(", p.")})`).join("; ") +
      `. Your answer MUST name each of these, each with its own citation — do not stop after the first. ` +
      `Never list an option the excerpts do not prove.` +
      (gaps.length
        ? ` No excerpt covers: ${gaps.join(", ")} — do NOT invent these; omit them or say the loaded excerpts don't cover them.`
        : "");
  } else if (plan.shape === "exhaustive") {
    coverageDirective =
      `\n\nEXHAUSTIVE-LIST QUESTION — the technician asked for a complete enumeration that the excerpts cannot fully provide. ` +
      `Do NOT pretend completeness and do NOT dump a partial list as if it were the whole. Instead: say plainly that the full ` +
      `enumeration is beyond the loaded excerpts, then describe the manual's own STRUCTURE for it from the excerpts (e.g. the ` +
      `parameter GROUPS and where the full list lives). This structural description IS a grounded answer, not a refusal — ` +
      `every structural claim MUST carry an inline [n] citation to the excerpt that shows it.`;
  } else if (classifyBroad(message).broad) {
    coverageDirective = `\n\nBROAD / ENUMERATION QUESTION — the technician asked what options/methods/protections exist. Answer as a short list that names EVERY distinct one the excerpts prove — both embedded/built-in AND optional — each with its own citation. Do NOT stop after the first method; if different excerpts describe different methods, include them all. Never list an option the excerpts do not prove. After the list, offer the natural next step (e.g. "want the setup steps for one of these?").`;
  }
  // Machine evidence rides after the base prompt and BEFORE appendManualContext
  // — the exact order the asset chat route uses. With no machine evidence the
  // string is byte-identical to before.
  const basePrompt = general ? GENERAL_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;
  const withMachine = machineSection ? `${basePrompt}\n\n${machineSection}` : basePrompt;
  const systemPrompt = general
    ? withMachine + machineContext
    : appendManualContext(withMachine, chunks) + machineContext + coverageDirective;
  // appendManualContext only appends the grounding RULES — the excerpts
  // themselves ride in the user message (injection-hardened data channel),
  // same as the asset-chat and node-chat routes. Conversation history rides
  // between the system prompt and the current (evidence-bearing) turn so the
  // model has thread memory without diluting the live grounding.
  // Referential follow-ups get a deterministic topic note (transcript tokens
  // only) riding IN the user turn next to the question — an end-of-system-prompt
  // hint measurably failed to stop "what's the maximum?" in a decel thread from
  // resolving to the lexically similar P044 [Maximum Freq] row (battery defect D).
  const topicHint = buildTopicHint(message, history);
  const messages = buildProviderMessages(
    systemPrompt,
    history,
    buildManualUserContent(topicHint ? `${message}\n\n${topicHint}` : message, chunks),
  );

  // STRM-2 (client stop). Two ways the technician can vanish mid-answer —
  // the request signal (client aborted the fetch / socket closed) and the
  // response stream being cancelled by the runtime — both fold into ONE
  // signal. `abortedRead` is a handled-rejection sentinel raced against the
  // provider read so a stalled upstream cannot keep a stopped turn alive; it
  // is created once and never awaited on its own, so it can't leak as an
  // unhandled rejection.
  const clientAbort = new AbortController();
  const onClientGone = () => clientAbort.abort();
  req.signal?.addEventListener("abort", onClientGone, { once: true });
  const abortedRead = new Promise<never>((_, reject) =>
    clientAbort.signal.addEventListener(
      "abort",
      () => reject(new DOMException("client stopped generation", "AbortError")),
      { once: true },
    ),
  );
  abortedRead.catch(() => {});

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      clientAbort.abort();
    },
    async start(controller) {
      // Citations are emitted AFTER generation, filtered to what the answer
      // actually cited — so a refusal ships no pages and a grounded answer ships
      // only its supporting evidence (no retrieved-but-unused pages as proof).
      const responseBuffer: string[] = [];
      const normalize = makeCitationNormalizer();
      // Only used in general mode; constructing it unconditionally keeps the
      // grounded delta path byte-identical to before.
      const stripBrackets = makeGeneralBracketStripper();
      let served = false;
      let servedModel: string | null = null;
      let internalError: unknown = null;

      // ONE cascade definition per turn. Flag off => byte-identical legacy list.
      const seam = canonicalSeamEnabled();
      const cascadeProviders = seam ? canonicalProviders() : providers();
      const outputCap = maxOutputTokens();
      const attempted: string[] = [];
      let turnUsage: TurnUsage | null = null;
      // Held so persistence runs AFTER the stream is closed — the ledger
      // write must never delay a byte of the technician's answer.
      let pendingUsage: TurnUsage | null = null;
      // Wall time for the whole turn (decision_traces.latency_ms).
      const turnStartedAt = Date.now();
      let rawUsage: unknown = null;
      let capped = false;
      // The provider whose stream was open when the client stopped — the
      // partial turn is recorded against it, and its upstream read is
      // cancelled so a stopped answer costs no further tokens.
      let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let activeProvider: { name: string; model: string } | null = null;

      cascade: for (const provider of cascadeProviders) {
        if (!provider.key) continue;
        // STRM-2: a stopped turn must never open a second provider stream.
        // The catch block below breaks on abort, but the two NON-throwing
        // `continue` paths (non-OK / empty-body response, empty responseBuffer)
        // also land here — checking once at the top of the loop covers all of
        // them (e.g. Groq 429 arriving after the technician tapped Stop).
        if (clientAbort.signal.aborted) break cascade;
        try {
          const res = await fetch(provider.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.key}`,
            },
            // A broad/enumeration answer legitimately needs more room; a narrow
            // answer stays tight. On gpt-oss the model's hidden reasoning also
            // draws from the completion budget, which was truncating broad
            // answers mid-list — hence reasoning_effort:low on Groq (frees the
            // budget for the visible answer; see the gpt-oss Groq migration
            // trap) plus the larger broad cap.
            body: JSON.stringify(
              seam
                ? buildRequestBody(
                    provider as never,
                    messages,
                    Math.min(coverageDirective ? 1400 : 800, outputCap),
                  )
                : {
                    model: provider.model,
                    messages,
                    stream: true,
                    max_tokens: coverageDirective ? 1400 : 800,
                    temperature: 0.3,
                    ...(provider.name === "Groq"
                      ? { reasoning_effort: process.env.GROQ_REASONING_EFFORT ?? "low" }
                      : {}),
                  },
            ),
            // The client-stop signal is composed with the timeout so a stop
            // during the connect phase aborts the upstream request instead
            // of waiting on the provider to answer first.
            signal: composeTimeout(clientAbort.signal, 30_000),
          });
          if (!res.ok || !res.body) {
            // Record the attempt BEFORE continuing: an HTTP-level rejection is
            // a fallback just as much as a thrown error, and skipping it here
            // made a Cerebras-served turn report routeReason 'primary'.
            if (seam) attempted.push(provider.name);
            continue;
          }
          const reader = res.body.getReader();
          activeReader = reader;
          activeProvider = { name: provider.name, model: provider.model };
          const dec = new TextDecoder();
          let buffer = "";
          let finished = false;
          while (!finished) {
            // Race the upstream read against the client-stop signal: a stop
            // must interrupt a read that is waiting on a slow provider, not
            // wait for the next delta to notice it.
            const { done, value } = await Promise.race([reader.read(), abortedRead]);
            if (done) break;
            buffer += dec.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const data = trimmed.slice(5).trim();
              if (data === "[DONE]") {
                finished = true;
                break;
              }
              try {
                const parsed = JSON.parse(data) as {
                  choices?: { delta?: { content?: string }; finish_reason?: string }[];
                  usage?: unknown;
                };
                // include_usage delivers the usage block on a FINAL chunk that
                // carries no choices — capture it whenever present rather than
                // only at finish_reason, or it is missed on some providers.
                if (parsed.usage) rawUsage = parsed.usage;
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  const norm = general ? stripBrackets.push(normalize.push(delta)) : normalize.push(delta);
                  if (norm) {
                    responseBuffer.push(norm);
                    const frame: NotebookContentFrame = { kind: "content", content: norm };
                    controller.enqueue(enc.encode(sse(frame)));
                  }
                  // Cost cap. Chars/4 is a deliberately cheap proxy: a real
                  // tokenizer here would cost more than the tokens it guards,
                  // and the cap exists to stop a RUNAWAY turn, not to bill.
                  if (seam && responseBuffer.join("").length / 4 > outputCap) {
                    capped = true;
                    finished = true;
                    break;
                  }
                }
                if (parsed.choices?.[0]?.finish_reason === "stop") finished = true;
              } catch {
                // partial frame — keep buffering
              }
            }
          }
          if (responseBuffer.length > 0) {
            const tail = general
              ? stripBrackets.push(normalize.flush()) + stripBrackets.flush()
              : normalize.flush();
            if (tail) {
              responseBuffer.push(tail);
              controller.enqueue(enc.encode(sse({ kind: "content", content: tail } as NotebookContentFrame)));
            }
            served = true;
            servedModel = `${provider.name}:${provider.model}`;
            if (seam) {
              turnUsage = usageFromRaw(
                provider.name,
                provider.model,
                rawUsage as never,
                routeReasonFor(attempted),
                attempted,
                capped ? "capped" : "ok",
              );
            }
            break;
          }
          if (seam) attempted.push(provider.name);
        } catch (err) {
          // Client stopped generation (STRM-2). Checked BEFORE the cascade
          // classifier: the race rejects with an AbortError, and a cancelled
          // controller makes enqueue throw a TypeError — neither is a
          // provider failure, and a stopped turn must never retry on the
          // next provider.
          if (clientAbort.signal.aborted) break cascade;
          if (!isProviderCascadeError(err)) {
            // A bug in this route, not a provider outage — fail loud with a
            // DISTINCT status so it can never read as provider exhaustion.
            internalError = err;
            console.error("[notebook-chat] internal error (NOT provider exhaustion):", err);
            break cascade;
          }
          console.error(
            `[notebook-chat] provider ${provider.name} failed:`,
            err instanceof Error ? err.message : err,
          );
          if (seam) attempted.push(provider.name);
          continue; // cascade to next provider
        }
      }

      // STRM-2: the technician stopped the answer. Nothing more is written to
      // the (already cancelled) stream. The partial text is persisted as an
      // `error` turn — a stopped answer is not an answer — with no citations,
      // no basis and no follow-ups, so nothing downstream can mistake it for
      // a grounded reply. Spend is still recorded when the seam is on: the
      // tokens were consumed whether or not the technician read them.
      if (clientAbort.signal.aborted) {
        req.signal?.removeEventListener("abort", onClientGone);
        activeReader?.cancel().catch(() => {});
        try {
          controller.close();
        } catch {
          // already cancelled by the consumer
        }
        let partial = responseBuffer.join("");
        // Same second bracket guard as the answered path: a general partial
        // must not carry [n] markers that resolve to no document.
        if (general) partial = partial.replace(/\s*\[\d+\]/g, "");
        const partialText = partial.length ? partial : null;
        const stoppedModel = activeProvider ? `${activeProvider.name}:${activeProvider.model}` : null;
        try {
          await recordTurn(ctx.tenantId, notebookId, {
            question: message,
            answerStatus: "error",
            answerText: partialText,
            enabledSourceDocIds: docIds,
            evidence: [],
            model: stoppedModel,
            basis: null,
            ...assetSnapshot,
          });
        } catch (err) {
          console.error("[notebook-chat] recordTurn (stopped) failed:", err instanceof Error ? err.message : err);
        }
        if (seam) {
          const stoppedUsage: TurnUsage = activeProvider
            ? {
                ...usageFromRaw(
                  activeProvider.name,
                  activeProvider.model,
                  rawUsage as never,
                  routeReasonFor(attempted),
                  attempted,
                  "error",
                ),
                // The provider `usage` block rides the FINAL chunk, which a
                // stopped turn never receives — so on a stop the token counts
                // are UNKNOWN, not zero. estimateCostUsd() turns all-null
                // counts into 0.000000, which is a positive claim that a turn
                // that really did burn tokens was free: it disappears into
                // SUM(cost_usd_estimate) and is NOT caught by
                // tenantSpendSince's `unpriced_turns` (… IS NULL) filter.
                // Unknown cost stays NULL — persist-usage.ts's own rule.
                ...(rawUsage ? {} : { costUsdEstimate: null }),
              }
            : exhaustedUsage(attempted);
          logTurnUsage({ tenantId: ctx.tenantId, notebookId }, stoppedUsage);
          await persistTurnUsage(
            {
              tenantId: ctx.tenantId,
              notebookId,
              question: message,
              answerText: partialText,
              citationsPresent: false,
              latencyMs: Date.now() - turnStartedAt,
            },
            stoppedUsage,
          );
        }
        return;
      }
      req.signal?.removeEventListener("abort", onClientGone);

      let answerText = responseBuffer.join("");

      // Determine the honest status + which citations to ship. A refusal ships
      // ZERO citations (no irrelevant pages as proof) and is recorded as
      // insufficient_evidence; a grounded answer ships only the [n] it used.
      const refused = served && isRefusal(answerText);
      // SECOND BRACKET GUARD (the prompt is the first). A general answer has no
      // sources, so any [n] the model emitted anyway points at nothing and would
      // render as a citation chip in mira-mobile. Strip the markers rather than
      // ship a chip that resolves to no document.
      if (general) answerText = answerText.replace(/\s*\[\d+\]/g, "");
      const emittedCitations =
        general || !served || refused ? [] : citationsUsedInAnswer(answerText, citations);
      const answerStatus: "answered" | "insufficient_evidence" | "error" = !served
        ? "error"
        : refused
          ? "insufficient_evidence"
          : "answered";

      const sourcesFrame: NotebookSourcesFrame = {
        kind: "sources",
        citations: emittedCitations,
        sourceSnapshot: docIds,
      };
      controller.enqueue(enc.encode(sse(sourcesFrame)));

      // Evidence basis (spec §1.3) — emitted before `status` so a client that
      // stops at `status` has still received it, same discipline as `usage`.
      // Says out loud what the answer rests on, so general reasoning can never
      // be mistaken for a manual.
      // With machine evidence (§4.4): `live_machine_evidence` only when the
      // asset's CURRENT signals roll up fresh; anything else is
      // `machine_history` — a replay is never labelled live (contract §2.8).
      // An empty or unavailable window claims NO machine basis (see
      // `machineGrounded` above): the turn keeps the basis it would have had
      // without the selection, and the entry rides along additively so the
      // client can render the honest caption.
      const evidenceFrame: NotebookEvidenceFrame = groundedMachineEntry
        ? groundedMachineEntry.freshness === "live"
          ? {
              kind: "evidence",
              basis: "live_machine_evidence",
              label: general
                ? "Grounded in live machine evidence — no documents for this machine."
                : "Grounded in live machine evidence and this notebook's sources.",
            }
          : {
              kind: "evidence",
              basis: "machine_history",
              label: general
                ? "Grounded in recorded machine history — not live, no documents for this machine."
                : "Grounded in recorded machine history and this notebook's sources — not live.",
            }
        : general
          ? {
              kind: "evidence",
              basis: "general_reasoning",
              label: "General guidance — not grounded in this machine's documents.",
            }
          : {
              kind: "evidence",
              basis: "oem_documentation",
              label: "Grounded in this notebook's sources.",
            };
      // The machine entry and the verified visual observation ride on the SAME
      // frame, additively — the basis and label above are untouched by them.
      if (machineEntry) evidenceFrame.machineEvidence = machineEntry;
      if (visualEntry) evidenceFrame.visualEvidence = visualEntry;
      controller.enqueue(enc.encode(sse(evidenceFrame)));

      const statusFrame: NotebookStatusFrame =
        answerStatus === "answered"
          ? { kind: "status", status: "answered" }
          : answerStatus === "insufficient_evidence"
            ? { kind: "status", status: "insufficient_evidence", message: "Not found in the selected sources." }
            : internalError
              ? { kind: "status", status: "error", message: "Internal chat error — see server logs." }
              : { kind: "status", status: "error", message: "No answer provider available." };
      // Canonical per-turn spend, emitted BEFORE status so a client that stops
      // reading at `status` has still received it. Seam-flagged only; the
      // legacy path's frame sequence is byte-for-byte unchanged.
      if (seam) {
        const finalUsage: TurnUsage = turnUsage ?? exhaustedUsage(attempted);
        controller.enqueue(enc.encode(sse(usageFrame(finalUsage))));
        // Structured log: still emitted, because a log line survives a database
        // outage and is the thing you grep DURING an incident.
        logTurnUsage({ tenantId: ctx.tenantId, notebookId }, finalUsage);
        pendingUsage = finalUsage;
      }

      controller.enqueue(enc.encode(sse(statusFrame)));

      // Deterministic follow-up chips (CONV-4, answered turns only) — derived
      // from the coverage plan + proven facet evidence; no LLM call, no new
      // retrieval. General mode gets only the answer-derived lanes (chunks is
      // empty, so no facet chip can name unproven evidence).
      if (answerStatus === "answered") {
        const provenFacets = plan.facets.length
          ? [...facetEvidencePages(chunks, plan.facets)]
              .filter(([, pages]) => pages.length)
              .map(([facet]) => facet)
          : [];
        const suggestions = buildFollowupSuggestions({
          plan,
          provenFacets,
          answer: answerText,
          status: answerStatus,
        });
        if (suggestions.length) {
          const followupsFrame: NotebookFollowupsFrame = { kind: "followups", suggestions };
          controller.enqueue(enc.encode(sse(followupsFrame)));
        }
      }

      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();

      try {
        await recordTurn(ctx.tenantId, notebookId, {
          question: message,
          answerStatus,
          answerText: served ? answerText : null,
          enabledSourceDocIds: docIds,
          // D5: the machine window rides INSIDE evidence[] next to the
          // citations, discriminated by `kind`. Never in `citations` or
          // `sourceSnapshot`. Persisted only for a served turn, like `basis`.
          evidence: served
            ? [...emittedCitations, ...(machineEntry ? [machineEntry] : []), ...(visualEntry ? [visualEntry] : [])]
            : emittedCitations,
          model: servedModel,
          // 084 (#3387): persist EXACTLY what the evidence frame streamed —
          // and only for a served answer. A failed turn makes no basis claim.
          basis: served ? evidenceFrame.basis : null,
          ...assetSnapshot,
        });
      } catch (err) {
        // persistence failure must not break the stream already delivered —
        // but it must not be invisible either.
        console.error("[notebook-chat] recordTurn failed:", err instanceof Error ? err.message : err);
      }

      // Durable spend ledger (migration 080). Deliberately LAST and non-fatal:
      // the answer is already streamed and already persisted as conversation
      // history, so a telemetry outage must not retroactively destroy a correct,
      // cited answer. persistTurnUsage never throws — it returns a result and
      // logs a distinct `turn.usage.persist_failed` event, so a spend gap stays
      // diagnosable without becoming a chat outage.
      if (pendingUsage) {
        await persistTurnUsage(
          {
            tenantId: ctx.tenantId,
            notebookId,
            question: message,
            answerText: served ? answerText : null,
            citationsPresent: emittedCitations.length > 0,
            latencyMs: Date.now() - turnStartedAt,
          },
          pendingUsage,
        );
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
