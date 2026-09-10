import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { cascadeComplete, type CascadeMessage } from "@/lib/llm/cascade";
import {
  retrieveManualChunks,
  buildGroundedContext,
  chunksToSources,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";
import { clientIpHash, rateLimited } from "@/lib/ip-rate-limit";
import { stripConflictingVendors } from "@/lib/vendor-relevance";

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
};

const SYSTEM_PROMPT = [
  "You are MIRA, a maintenance intelligence assistant for industrial",
  "equipment. You are answering a signed-in maintenance technician asking a",
  "GENERAL question — one not yet bound to a specific machine in their",
  "namespace. You may search their own uploaded manuals as well as the",
  "shared OEM library.",
  "",
  "Rules:",
  "- Cite-or-refuse. If the context block has no supporting chunk, say so",
  "  plainly and suggest uploading the manual. Do NOT invent fault codes,",
  "  part numbers, torque specs, or manual references.",
  "- NEVER claim to know which machine they are standing at. You have no",
  "  confirmed asset context here. If the answer would differ by machine,",
  "  say which detail you would need.",
  "- When you cite, use [n] markers matching the numbered CONTEXT chunks.",
  "- Keep answers tight — 4-8 short bullets max. A technician is reading",
  "  this on a phone in a noisy plant.",
  "- Lead with the most likely cause + a specific corrective step, then",
  "  2-3 alternatives ranked by probability.",
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
      { error: "You are asking faster than MIRA can answer. Try again in a minute." },
      { status: 429 },
    );
  }

  let chunks: ManualChunk[] = [];
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
      chunks = await retrieveManualChunks(client, ctx.tenantId, question, {
        manufacturer,
        topK: 6,
      });
    } catch (err) {
      console.error("[hub/ask] retrieval failed:", err);
      // Continue — the model can still refuse with no context. A retrieval
      // outage must not become a fabricated answer.
    } finally {
      client.release();
    }
  }

  chunks = stripConflictingVendors(chunks, manufacturer ?? question);

  const context = buildGroundedContext(chunks);
  const messages: CascadeMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: context
        ? `CONTEXT:\n${context}\n\n---\n\nUSER QUESTION:\n${question}`
        : `(no manuals indexed for this question yet)\n\nUSER QUESTION:\n${question}`,
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
        answer: "Sorry — every model provider is unreachable right now. Try again in a minute.",
        citations: [],
        provider: null,
      } as HubAskResponse,
      { status: 503 },
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
  const citations: ManualSource[] = selectCitations(chunks, result.content);

  return NextResponse.json({
    answer: result.content,
    citations,
    provider: result.provider,
  } as HubAskResponse);
}
