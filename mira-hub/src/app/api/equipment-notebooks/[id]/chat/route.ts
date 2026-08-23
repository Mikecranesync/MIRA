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
 * Frames (typed — src/lib/notebook-chat-types.ts): `sources` first, `content`
 * deltas, `status` last, then `data: [DONE]`. Under MIRA_CANONICAL_SEAM a
 * `usage` frame carrying per-turn spend is emitted before `status`; existing
 * clients ignore unknown kinds (mira-mobile sse.ts is an if/else-if chain),
 * so the addition is backward compatible.
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
import type {
  EvidenceCitation,
  NotebookContentFrame,
  NotebookSafetyFrame,
  NotebookSourcesFrame,
  NotebookStatusFrame,
} from "@/lib/notebook-chat-types";

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
  }
  return citations;
}

/** gpt-oss models emit OpenAI-style citation markers (`【3】`, `【4†L1-L7】`)
 *  instead of `[3]`. Normalize to `[n]` so the UI renders clickable chips and
 *  citation-entailment can match. Streaming-safe: a delta that ends mid-marker
 *  (an open `【` with no closing `】`) is held back until the marker completes. */
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

  let body: { message?: string; sourceDocIds?: string[]; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
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
      await recordTurn(ctx.tenantId, notebookId, {
        question: message,
        answerStatus: "answered",
        answerText: SAFETY_STOP,
        enabledSourceDocIds: [],
        evidence: [],
        model: null,
      });
      return safetyStopResponse(safetyTrigger, []);
    }
    const status =
      validated.error === "notebook_not_found"
        ? 404
        : validated.error === "no_sources_selected"
          ? 422
          : 403;
    return NextResponse.json({ error: validated.error }, { status });
  }

  const { docIds, nodeId } = validated;

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
    await recordTurn(ctx.tenantId, notebookId, {
      question: message,
      answerStatus: "answered",
      answerText: SAFETY_STOP,
      enabledSourceDocIds: docIds,
      evidence: [],
      model: null,
      ...assetSnapshot,
    });
    return safetyStopResponse(safetyTrigger, docIds);
  }

  const retrievalQuery = buildRetrievalQuery(message, history);
  const chunks = await withTenantContext(ctx.tenantId, (client) =>
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
    }),
  );

  const enc = new TextEncoder();

  if (chunks.length === 0) {
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

  const citations = await buildCitations(ctx.tenantId, chunks, message);

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
  const systemPrompt = appendManualContext(BASE_SYSTEM_PROMPT, chunks) + machineContext + coverageDirective;
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Citations are emitted AFTER generation, filtered to what the answer
      // actually cited — so a refusal ships no pages and a grounded answer ships
      // only its supporting evidence (no retrieved-but-unused pages as proof).
      const responseBuffer: string[] = [];
      const normalize = makeCitationNormalizer();
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

      cascade: for (const provider of cascadeProviders) {
        if (!provider.key) continue;
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
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok || !res.body) {
            // Record the attempt BEFORE continuing: an HTTP-level rejection is
            // a fallback just as much as a thrown error, and skipping it here
            // made a Cerebras-served turn report routeReason 'primary'.
            if (seam) attempted.push(provider.name);
            continue;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buffer = "";
          let finished = false;
          while (!finished) {
            const { done, value } = await reader.read();
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
                  const norm = normalize.push(delta);
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
            const tail = normalize.flush();
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

      const answerText = responseBuffer.join("");

      // Determine the honest status + which citations to ship. A refusal ships
      // ZERO citations (no irrelevant pages as proof) and is recorded as
      // insufficient_evidence; a grounded answer ships only the [n] it used.
      const refused = served && isRefusal(answerText);
      const emittedCitations = !served || refused ? [] : citationsUsedInAnswer(answerText, citations);
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
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();

      try {
        await recordTurn(ctx.tenantId, notebookId, {
          question: message,
          answerStatus,
          answerText: served ? answerText : null,
          enabledSourceDocIds: docIds,
          evidence: emittedCitations,
          model: servedModel,
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
