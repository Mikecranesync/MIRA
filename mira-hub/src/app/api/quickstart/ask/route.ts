import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { withTenantContext } from "@/lib/tenant-context";
import { cascadeComplete, type CascadeMessage } from "@/lib/llm/cascade";
import {
  retrieveManualChunks,
  buildGroundedContext,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";

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
  "- Cite-or-refuse. If the context block has no supporting chunk for the",
  "  user's question, say so plainly: 'I don't have manuals for that in",
  "  the public knowledge base — sign up to upload your own and I can",
  "  help.' Do NOT invent fault codes, part numbers, torque specs, or",
  "  manual references.",
  "- When you do cite, use [n] markers matching the numbered chunks in the",
  "  CONTEXT block.",
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
 * Gemini cascade. The system prompt enforces cite-or-refuse — there is
 * no plant context, so any answer not backed by a chunk must be a refusal.
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

  const context = buildGroundedContext(chunks);
  const userMsg = context
    ? `CONTEXT:\n${context}\n\n---\n\nUSER QUESTION:\n${question}`
    : `(no manuals indexed for this question yet)\n\nUSER QUESTION:\n${question}`;

  const messages: CascadeMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
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

  const citations: ManualSource[] = chunks.map((c, i) => ({
    index: i + 1,
    title: [c.manufacturer, c.modelNumber].filter(Boolean).join(" ") || c.title,
    url: c.sourceUrl || null,
    page: c.sourcePage,
  }));

  return NextResponse.json({
    answer: result.content,
    citations,
    provider: result.provider,
  } as AskResponse);
}
