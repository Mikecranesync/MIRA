import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { cascadeComplete, type CascadeMessage } from "@/lib/llm/cascade";
import {
  retrieveManualChunks,
  buildGroundedContext,
  displayPage,
  isRefusalAnswer,
  type ManualChunk,
} from "@/lib/manual-rag";
import { stripConflictingVendors } from "@/lib/vendor-relevance";

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
 * `retrieveManualChunks` under the caller's tenant applies the hybrid read law
 * (`.claude/rules/knowledge-entries-tenant-scoping.md`): the shared OEM library
 * plus this tenant's own private uploads. The quickstart route deliberately
 * runs as the public tenant and therefore cannot see a customer's uploads —
 * which is why pointing a signed-in user at it would have looked like an answer
 * while silently ignoring the manuals they uploaded themselves.
 *
 * Read-only. No writes, no asset binding, no control.
 */

type AskPayload = { question?: string; manufacturer?: string };

type ManualSource = {
  index: number;
  title: string;
  url: string | null;
  page: number | null;
  verified: boolean;
};

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

  let chunks: ManualChunk[] = [];
  try {
    chunks = await withTenantContext(ctx.tenantId, async (client) =>
      retrieveManualChunks(client, ctx.tenantId, question, { manufacturer, topK: 6 }),
    );
  } catch (err) {
    console.error("[hub/ask] retrieval failed:", err);
    // Continue — the model can still refuse with no context. A retrieval
    // outage must not become a fabricated answer.
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

  // A refusal cited nothing, so shipping citation cards beside it would be a
  // lie the user can see (#1875). Same rule the quickstart route applies.
  const citations: ManualSource[] = isRefusalAnswer(result.content)
    ? []
    : chunks.map((c, i) => ({
        index: i + 1,
        title: [c.manufacturer, c.modelNumber].filter(Boolean).join(" ") || c.title,
        url: c.sourceUrl || null,
        page: displayPage(c),
        verified: c.verified === true,
      }));

  return NextResponse.json({
    answer: result.content,
    citations,
    provider: result.provider,
  } as HubAskResponse);
}
