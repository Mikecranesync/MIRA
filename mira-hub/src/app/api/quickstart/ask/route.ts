import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { withTenantContext } from "@/lib/tenant-context";
import { cascadeComplete, type CascadeMessage } from "@/lib/llm/cascade";
import {
  retrieveManualChunks,
  buildGroundedContext,
  displayPage,
  isRefusalAnswer,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";
import { stripConflictingVendors } from "@/lib/vendor-relevance";
import { flagDirectiveFor, hazardBanner, matchSafetyStop } from "@/lib/safety-classifier";

export const dynamic = "force-dynamic";

// Per-IP-hash rate limit for this public, unauthenticated LLM endpoint.
// In-memory (per-instance) — sufficient while the hub runs as a single
// container (see root CLAUDE.md Container Map). Mirrors the intent of
// /api/public/report's DB-backed IP-hash limiter. If the hub scales
// horizontally, port to a shared store / quickstart_rate table.
const QUICKSTART_MAX_PER_MIN = 20;
const QUICKSTART_WINDOW_MS = 60_000;
const quickstartHits = new Map<string, number[]>();

function quickstartRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const cutoff = now - QUICKSTART_WINDOW_MS;
  const hits = (quickstartHits.get(ipHash) ?? []).filter((t) => t > cutoff);
  hits.push(now);
  quickstartHits.set(ipHash, hits);
  if (quickstartHits.size > 5000) {
    for (const [k, v] of quickstartHits) {
      if (v.every((t) => t <= cutoff)) quickstartHits.delete(k);
    }
  }
  return hits.length > QUICKSTART_MAX_PER_MIN;
}

// See /api/quickstart/manufacturers/route.ts for the rationale on
// QUICKSTART_TENANT_ID. Production sets it via Doppler / docker-compose;
// fallback is the founder's tenant where the seeded OEM corpus lives.
const QUICKSTART_FALLBACK_TENANT_ID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3";

function quickstartTenantId(): string {
  return process.env.QUICKSTART_TENANT_ID?.trim() || QUICKSTART_FALLBACK_TENANT_ID;
}

interface AskPayload {
  manufacturer?: string;
  question?: string;
}

interface AskResponse {
  answer: string;
  citations: ManualSource[];
  provider: string | null;
}

const SYSTEM_PROMPT = [
  "You are MIRA, a maintenance intelligence assistant for industrial",
  "equipment. You are answering an anonymous user on a public quickstart",
  "page — they have no namespace yet, and you must NEVER pretend to know",
  "their plant context.",
  "",
  "Rules:",
  "- ALWAYS answer. A technician with a down machine needs help now; a",
  "  refusal sends them to a generic chatbot that will not show its source.",
  "- Two kinds of statement, never mixed up:",
  "  1. From a manual: anything the CONTEXT block supports. Cite it with",
  "     [n] markers matching the numbered chunks. Only the plain [n] form.",
  "  2. General guidance: anything the CONTEXT does not cover. Put it",
  "     under the heading 'General guidance (not from a manual):' and give",
  "     practical, standard industrial-maintenance advice.",
  "- Never state a specific parameter number, register address, terminal",
  "  number, torque/voltage/current value, part number or fault-code meaning",
  "  unless a CONTEXT chunk you cite says it. For those, say which manual",
  "  section to check instead (e.g. 'the drive manual's parameter list').",
  "- Answer in the language the technician wrote in. Keep manual titles,",
  "  parameter names and citations as they are.",
  "- Keep answers tight — 4-8 short bullets max. A maintenance tech is",
  "  reading this on a phone in a noisy plant.",
  "- Lead with the most likely cause + a specific corrective step. Then",
  "  list 2-3 alternative causes ranked by probability.",
  "- End with a one-line confirmation question if the symptom is",
  "  ambiguous (e.g. 'Is the drive faulting on power-up or under load?').",
].join("\n");

/**
 * POST /api/quickstart/ask
 *
 * Public, no-auth answer endpoint for the Twilio-moment landing page.
 * Runs BM25 against `knowledge_entries` (manufacturer-scoped if provided),
 * builds a grounded context, and runs the standard Groq → Cerebras →
 * Gemini cascade. The system prompt separates cited manual facts ([n]) from
 * labeled general guidance; it answers instead of refusing (2026-09-27).
 *
 * Body: { manufacturer?: string; question: string }
 * Returns: { answer, citations: [{ index, title, url, page }], provider }
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  // Rate limit before any work — we never store raw IPs.
  const rlHdrs = await headers();
  const rawIp =
    rlHdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    rlHdrs.get("x-real-ip") ??
    "unknown";
  const ipHash = createHash("sha256").update(rawIp).digest("hex");
  if (quickstartRateLimited(ipHash)) {
    return NextResponse.json(
      { error: "Too many requests — slow down and try again in a minute." },
      { status: 429 },
    );
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
    return NextResponse.json(
      { error: "question too long (>1000 chars)" },
      { status: 400 },
    );
  }
  const manufacturer = (body.manufacturer ?? "").trim() || null;

  // SAFETY HARD-STOP — before retrieval and before any provider call, as every
  // other chat route gates (asset, node, notebook, hub/ask). The IP rate limit
  // above necessarily runs first: the question is not known until the body is
  // parsed. The classifier carries the educational carve-out ("what is LOTO?"
  // is a question, not a hazard report), so the stranger questions this route
  // exists for still answer. Same stop shape as the sibling routes (#3876).
  // OWNER DECISION 2026-09-27 (Mike): "no answer blocking, just safety flags".
  // A matched hazard adds a prompt directive and a banner above the answer;
  // it never replaces the answer.
  const safetyTrigger = matchSafetyStop(question);

  // Pull the top-K chunks.
  let chunks: ManualChunk[] = [];
  try {
    chunks = await withTenantContext(quickstartTenantId(), async (client) =>
      retrieveManualChunks(client, quickstartTenantId(), question, {
        manufacturer,
        topK: 6,
      }),
    );
  } catch (err) {
    console.error("[quickstart/ask] retrieval failed:", err);
    // Continue — the model can still refuse with no context.
  }

  // Cross-vendor conflict strip (mirrors rag_worker.CROSS_VENDOR_FILTER): the
  // tenant-only / OR fallback in retrieveManualChunks can surface a chunk from
  // the wrong manufacturer (e.g. a Siemens chunk for a Danfoss question). Drop
  // those before they reach the context and the citation list. Prefer the
  // explicit manufacturer the user picked; otherwise infer the vendor from the
  // question text. No-op when no vendor resolves, and never strips to empty.
  chunks = stripConflictingVendors(chunks, manufacturer ?? question);

  const context = buildGroundedContext(chunks);
  const userMsg = context
    ? `CONTEXT:\n${context}\n\n---\n\nUSER QUESTION:\n${question}`
    : `(no manuals indexed for this question yet)\n\nUSER QUESTION:\n${question}`;

  const messages: CascadeMessage[] = [
    {
      role: "system",
      content: safetyTrigger ? `${SYSTEM_PROMPT}\n\n${flagDirectiveFor(safetyTrigger)}` : SYSTEM_PROMPT,
    },
    { role: "user", content: userMsg },
  ];

  const result = await cascadeComplete(messages, {
    maxTokens: 700,
    temperature: 0.1,
    timeoutMs: 20_000,
  });

  if (!result) {
    return NextResponse.json(
      {
        answer:
          "Sorry — every model provider is unreachable right now. Try again in a minute.",
        citations: [],
        provider: null,
      } as AskResponse,
      { status: 503 },
    );
  }

  // Suppress phantom citation cards on a refusal: chunks render 1:1, so an
  // answer that says "I don't have manuals for that" would otherwise ship with
  // up-to-6 citation cards — the contradiction reported in PR #1875. When the
  // model refuses, it cited nothing, so the citation list is a lie. (#1875)
  // Model citation hygiene (#4032): some providers emit their own tool-citation
  // markers ("【1†L3-L4】"); normalize them to the [n] form the page renders.
  const answerText = result.content.replace(/【(\d{1,2})†[^】]*】/g, "[$1]");
  // Ship only the sources the answer actually cited: a general-guidance answer
  // must not arrive with six unrelated source cards (the #1875 contradiction,
  // generalized now that the route answers instead of refusing).
  const cited = new Set([...answerText.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  const citations: ManualSource[] = isRefusalAnswer(answerText)
    ? []
    : chunks.map((c, i) => ({
        index: i + 1,
        title: [c.manufacturer, c.modelNumber].filter(Boolean).join(" ") || c.title,
        url: c.sourceUrl || null,
        // #2910: suppress a page label when it's actually the chunk ordinal
        // (legacy ingest mis-stamp) so we never show an impossible page like p.1254.
        page: displayPage(c),
        verified: c.verified === true,
      })).filter((s) => cited.has(s.index));

  return NextResponse.json(
    {
      answer: safetyTrigger ? `${hazardBanner(safetyTrigger)}\n\n${answerText}` : answerText,
      citations,
      provider: result.provider,
    } as AskResponse,
    safetyTrigger ? { headers: { "X-Safety-Flag": safetyTrigger } } : undefined,
  );
}
