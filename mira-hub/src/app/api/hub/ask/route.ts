import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { cascadeComplete, type CascadeMessage } from "@/lib/llm/cascade";
import {
  retrieveManualChunks,
  retrieveNodeChunks,
  buildGroundedContext,
  chunksToSources,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";
import { clientIpHash, rateLimited } from "@/lib/ip-rate-limit";
import { stripConflictingVendors } from "@/lib/vendor-relevance";
import { flagDirectiveFor, hazardBanner, matchSafetyStop, safetyFlagHeaders, withSafetyFlag } from "@/lib/safety-classifier";
import { englishSearchQuery, withAnswerLanguage } from "@/capabilities/answer-language";
import { normalizeCitationMarkers, withStepSafety } from "@/capabilities/answer-shape";
import { translateForSearch } from "@/capabilities/translate-for-search";
import type { EvidenceBasis } from "@/lib/notebook-chat-types";
import { askUserContent, confirmedSourceDocIds, preferOwnDocuments } from "@/capabilities/confirmed-sources";

/** Per-minute allowance for one tenant, and separately for one client IP.
 *  Deliberately generous for a technician typing questions, and far below what
 *  a script would need to matter. */
const HUB_ASK_MAX_PER_MIN = 20;

/**
 * The citation cards an answer is allowed to ship, by two rules that must agree.
 *
 * 1. NUMBERING — `chunksToSources` is the documented conversion contract that
 *    pairs with `buildGroundedContext`, which numbers by UNIQUE source key: two
 *    excerpts from the same document page are both `[1]`. Rebuilding the cards
 *    locally with `i + 1` numbered the RAW chunks instead, so the model's `[2]`
 *    pointed at the wrong card and a phantom `[3]` appeared.
 *
 * 2. REFUSAL — a refusal cites nothing, so cards beside it are a lie the user
 *    can see (#1875). The previous check was `isRefusalAnswer`, which substring
 *    matches a QUICKSTART-specific sentence; this route has its own prompt and
 *    its own phrasing, so a refusal here went undetected and shipped every
 *    retrieved card. Keying on the MARKERS the answer actually used is
 *    phrasing-independent: no `[n]` resolving to a returned source means
 *    nothing was cited, in any wording.
 *
 * Exported and pure so both rules are asserted on data rather than inferred
 * from the shape of the source.
 */
export function selectCitations(chunks: ManualChunk[], answer: string): ManualSource[] {
  const all = chunksToSources(chunks);
  const cited = new Set([...answer.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  return all.filter((s) => cited.has(s.index));
}

/**
 * POST /api/hub/ask — the signed-in technician's general question.
 *
 * Why this exists
 * ---------------
 * `/quickstart` already gives a STRANGER a composer and a cited answer. A
 * signed-in technician had no equivalent: every Hub chat surface is scoped to
 * something (an asset, a notebook, a namespace node), and `/api/mira/ask`
 * returns 412 without confirmed namespace context. So the one user who has
 * uploaded their own manuals was the one user who could not simply ask a
 * question — and the home screen's "Ask MIRA" was a link to a Telegram bot.
 *
 * This is NOT a hole in the UNS confirmation gate. That gate governs
 * ASSET-SPECIFIC troubleshooting; `.claude/rules/uns-confirmation-gate.md`
 * exempts general and educational questions explicitly, which is exactly what
 * `/quickstart` has been answering in public all along. The difference here is
 * only WHOSE corpus is searched.
 *
 * Which corpus
 * ------------
 * `retrieveManualChunks` on the RAW owner pool, with the caller's tenant passed
 * as the predicate argument, applies the hybrid read law
 * (`.claude/rules/knowledge-entries-tenant-scoping.md`): the shared OEM library
 * plus this tenant's own private uploads. The quickstart route deliberately
 * runs as the public tenant and therefore cannot see a customer's uploads —
 * which is why pointing a signed-in user at it would have looked like an answer
 * while silently ignoring the manuals they uploaded themselves.
 *
 * Read-only. No writes, no asset binding, no control.
 */

type AskPayload = { question?: string; manufacturer?: string };

export type HubAskResponse = {
  answer: string;
  citations: ManualSource[];
  provider: string | null;
  /** What the answer rests on — the shared basis vocabulary (`EvidenceBasis`,
   *  migration 084, `EvidenceBasisKind` in the shell), so the L5 badge is
   *  server-driven and an unknown value never maps to a stronger claim.
   *  `oem_documentation` = the answer cited a retrieved manual chunk;
   *  `general_reasoning` = answered from general knowledge; null = no answer. */
  basis: EvidenceBasis | null;
};

// L0 of the ChatGPT-first lock (wiki/architecture/chatgpt-first-maintenance-genie.md
// §2.2, §3): an UNBOUND question may be answered from the model's general
// knowledge and is labelled `general_reasoning`; a retrieval miss must not
// collapse into sources-miss copy. What stays forbidden is inventing facts
// that only a specific machine's documentation could supply.
const SYSTEM_PROMPT = [
  "You are MIRA, a maintenance intelligence assistant for industrial",
  "equipment. You are answering a signed-in maintenance technician asking a",
  "GENERAL question — one not yet bound to a specific machine in their",
  "namespace. Their own uploaded manuals and the shared OEM library are",
  "searched for every question; any supporting excerpts appear in CONTEXT,",
  "which also says when that search was unavailable.",
  "",
  "Rules:",
  "- Answer the question. Answer it from your general maintenance and",
  "  industrial-equipment knowledge whenever the CONTEXT has no excerpt that",
  "  supports it — an educational or general question deserves a clear,",
  "  useful answer, never a refusal.",
  "- When a CONTEXT excerpt supports a claim, cite it with [n] markers",
  "  matching the numbered chunks. When the CONTEXT does not support the",
  "  answer, do not cite it; say in one short line that their plant docs",
  "  did not match, then give the general answer anyway.",
  "- Do NOT invent machine-specific facts: fault codes, part numbers, torque",
  "  specs, parameter names or manual references that are not in CONTEXT.",
  "  If the answer would need one, say so and say which manual would carry it.",
  "- NEVER claim to know which machine they are standing at. You have no",
  "  confirmed asset context here. If the answer would differ by machine,",
  "  say which detail you would need.",
  "- Keep answers tight — 4-8 short bullets max. A technician is reading",
  "  this on a phone in a noisy plant.",
  "- For a troubleshooting question, lead with the most likely cause + a",
  "  specific corrective step, then 2-3 alternatives ranked by probability.",
].join("\n");

export async function POST(req: Request) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  let body: AskPayload;
  try {
    body = (await req.json()) as AskPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (question.length > 1000) {
    return NextResponse.json({ error: "question too long (>1000 chars)" }, { status: 400 });
  }
  const manufacturer = (body.manufacturer ?? "").trim() || null;

  // SAFETY HARD-STOP — before the rate limiter, before retrieval, before any
  // provider call, exactly as the asset, node and notebook chat routes gate.
  // The classifier carries the educational carve-out ("what is LOTO?" is a
  // question, not a hazard report), so the general questions this route exists
  // for still answer; a hazard report never reaches a model that has been told
  // to answer rather than refuse. Same body shape as the other routes' stops:
  // the stop text as the answer, `X-Safety-Stop` naming the trigger.
  // OWNER DECISION 2026-09-27 (Mike): "no answer blocking, just safety flags".
  // A matched hazard adds a prompt directive and a banner above the answer;
  // it never replaces the answer.
  const safetyTrigger = matchSafetyStop(question);

  // Cost control BEFORE retrieval or inference. This endpoint is authenticated,
  // but authentication is not an allowance: one trial or compromised account
  // could otherwise drive unbounded paid cascade completions. Keyed on the
  // TENANT so a single account cannot spend the workspace's budget, with the
  // IP hash as a secondary key so one compromised session cannot exhaust the
  // whole tenant either. The public quickstart route limits 20/min and
  // `/api/mira/ask` limits by IP hash; this is the authenticated equivalent.
  if (
    rateLimited("hub-ask-tenant", ctx.tenantId, HUB_ASK_MAX_PER_MIN, 60_000) ||
    rateLimited("hub-ask-ip", await clientIpHash(), HUB_ASK_MAX_PER_MIN, 60_000)
  ) {
    return NextResponse.json(
      { error: withSafetyFlag("You are asking faster than MIRA can answer. Try again in a minute.", safetyTrigger) },
      { status: 429, headers: safetyFlagHeaders(safetyTrigger) },
    );
  }

  // Non-English questions search the English corpus in English (answered in their own language).
  const searchQuery = await englishSearchQuery(question, translateForSearch);
  let chunks: ManualChunk[] = [];
  let retrievalFailed = false;
  let ownDocumentsFailed = false;
  let ownDocumentsPartial = false;
  {
    // #2178 — the RAW owner pool (BYPASSRLS), NOT withTenantContext.
    //
    // `knowledge_entries` is a hybrid corpus: the shared OEM library lives
    // under the system tenant with `is_private = false`, and
    // retrieveManualChunks filters `(is_private = false OR tenant_id = $1)`.
    // `withTenantContext` issues `SET LOCAL ROLE factorylm_app`, which
    // activates the RLS policy `tenant_id = current_setting('app.current_tenant_id')`
    // (003_kb_hardening.sql:52). RLS ANDs on top of the hybrid predicate and
    // collapses it to `tenant_id = $caller`, so every OEM row becomes
    // invisible and a customer sees ZERO manuals for every manufacturer.
    //
    // The first version of this route used withTenantContext, copied from
    // `/api/quickstart/ask`. That shape is safe THERE only because quickstart
    // passes `quickstartTenantId()` — it IS the corpus owner, so scoping to
    // its own tenant returns the library. This route passes the CUSTOMER's
    // tenant, where the identical call has the opposite effect. Same code,
    // opposite outcome, and the failure is silent: retrieval returns no rows
    // rather than erroring, and the model then refuses politely.
    //
    // See `.claude/rules/knowledge-entries-tenant-scoping.md` line 47 and the
    // matching comment in `api/assets/[id]/chat/route.ts`.
    const client = await pool.connect();
    try {
      const library = await retrieveManualChunks(client, ctx.tenantId, searchQuery, {
        manufacturer,
        topK: 6,
      });
      // #3437 — the technician's OWN manuals. Under
      // MIRA_ENFORCE_APPROVED_RETRIEVAL (prod) the library read above keeps
      // only `verified = true` rows, and a private upload is never verified, so
      // this route answered from the OEM library alone while claiming to search
      // "your manuals". A document the tenant CONFIRMED as a notebook source is
      // admitted here, exactly as notebook chat admits it; unconfirmed uploads
      // stay out. The doc set is the boundary (validatedDocScope), the tenant
      // predicate stays in the SQL, and the node argument is unused in that mode.
      let own: ManualChunk[] = [];
      try {
        const { docIds, truncated } = await confirmedSourceDocIds(client, ctx.tenantId);
        if (truncated) {
          console.warn(`[hub/ask] confirmed documents exceed ${docIds.length}; searching the most recent`);
          ownDocumentsPartial = true;
        }
        if (docIds.length > 0) {
          own = await retrieveNodeChunks(client, ctx.tenantId, searchQuery, {
            nodeId: ctx.tenantId,
            unsPath: null,
            topK: 6,
            docIds,
            validatedDocScope: true,
            approvedSourceDocIds: docIds,
          });
        }
      } catch (err) {
        // The library answer still stands, but the model must know the
        // technician's own manuals were not searched (askUserContent).
        console.warn("[hub/ask] confirmed-document retrieval failed:", err);
        ownDocumentsFailed = true;
      }
      chunks = preferOwnDocuments(own, library, 6);
    } catch (err) {
      console.error("[hub/ask] retrieval failed:", err);
      // Continue and answer from general knowledge, but SAY the search was
      // unavailable (F3): an outage must never be reported to the technician
      // as "your documents did not match", and must never become a fabricated
      // citation — with no chunks nothing can be cited.
      retrievalFailed = true;
    } finally {
      client.release();
    }
  }

  chunks = stripConflictingVendors(chunks, manufacturer ?? question);

  const context = buildGroundedContext(chunks);
  const messages: CascadeMessage[] = [
    {
      role: "system",
      content: withStepSafety(withAnswerLanguage(
        safetyTrigger ? `${SYSTEM_PROMPT}\n\n${flagDirectiveFor(safetyTrigger)}` : SYSTEM_PROMPT,
      )),
    },
    {
      role: "user",
      content: askUserContent(context, question, {
        library: retrievalFailed,
        ownDocuments: ownDocumentsFailed,
        ownDocumentsPartial,
      }),
    },
  ];

  const result = await cascadeComplete(messages, {
    maxTokens: 700,
    temperature: 0.1,
    timeoutMs: 20_000,
  });

  if (!result) {
    return NextResponse.json(
      {
        answer: withSafetyFlag("Sorry — every model provider is unreachable right now. Try again in a minute.", safetyTrigger),
        citations: [],
        provider: null,
        basis: null,
      } as HubAskResponse,
      { status: 503, headers: safetyFlagHeaders(safetyTrigger) },
    );
  }

  // Citations, by two rules that must agree with each other.
  //
  // 1. NUMBERING — `chunksToSources` is the documented conversion contract
  //    (manual-rag.ts). `buildGroundedContext` numbers by UNIQUE source key, so
  //    two excerpts from the same document page are both `[1]`. Rebuilding the
  //    cards locally with `i + 1` numbered the RAW chunks instead, so the
  //    model's `[2]` pointed at the wrong card and a phantom `[3]` appeared.
  //    Use the helper the context builder is paired with, never a second
  //    numbering.
  //
  // 2. REFUSAL — a refusal cites nothing, so cards beside it are a lie the
  //    user can see (#1875). The previous check was `isRefusalAnswer`, which
  //    substring-matches a QUICKSTART-specific sentence; this route has its own
  //    prompt and its own phrasing, so a refusal here went undetected and
  //    shipped every retrieved card. Keying on the MARKERS the answer actually
  //    used is phrasing-independent: no `[n]` resolving to a returned source
  //    means nothing was cited, whatever words were chosen.
  const answerText = normalizeCitationMarkers(result.content);
  const citations: ManualSource[] = selectCitations(chunks, answerText);

  // L5 honesty badge: the basis is what the answer actually used, not what
  // was retrieved — chunks the model did not cite are a retrieval miss.
  return NextResponse.json(
    {
      answer: safetyTrigger ? `${hazardBanner(safetyTrigger)}\n\n${answerText}` : answerText,
      citations,
      provider: result.provider,
      basis: citations.length > 0 ? "oem_documentation" : "general_reasoning",
    } as HubAskResponse,
    safetyTrigger ? { headers: { "X-Safety-Flag": safetyTrigger } } : undefined,
  );
}
