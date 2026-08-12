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
 * deltas, `status` last, then `data: [DONE]`.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { recordTurn, validateChatSources } from "@/lib/equipment-notebooks";
import {
  appendManualContext,
  buildManualUserContent,
  retrieveNodeChunks,
  type ManualChunk,
} from "@/lib/manual-rag";
import type {
  EvidenceCitation,
  NotebookContentFrame,
  NotebookSourcesFrame,
  NotebookStatusFrame,
} from "@/lib/notebook-chat-types";

export const dynamic = "force-dynamic";

const BASE_SYSTEM_PROMPT = `You are MIRA, a maintenance assistant answering questions about ONE specific machine using ONLY the reference excerpts provided below.
Rules:
1. Ground every factual claim in the numbered reference excerpts and cite them inline like [1] or [2].
2. Preserve units, fault codes, part numbers, and terminal identifiers EXACTLY as written.
3. If the excerpts do not contain the answer, say you could not find it in the selected sources — never guess.
4. Distinguish what the manual says from your own inference; keep inference clearly labeled.
5. Be concise and practical — the reader is a technician standing at the machine.`;

type CascadeProvider = { name: string; url: string; key?: string; model: string };

function providers(): CascadeProvider[] {
  return [
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    },
    {
      name: "Cerebras",
      url: "https://api.cerebras.ai/v1/chat/completions",
      key: process.env.CEREBRAS_API_KEY,
      model: process.env.CEREBRAS_MODEL ?? "llama3.1-8b",
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
      quote: c.content.slice(0, 240),
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

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id: notebookId } = await params;

  let body: { message?: string; sourceDocIds?: string[] };
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

  // PRD §27: no sources selected is an explicit, honest state — not a silent
  // fall-through to the global corpus.
  const validated = await validateChatSources(ctx.tenantId, notebookId, body.sourceDocIds ?? []);
  if (!validated.ok) {
    const status =
      validated.error === "notebook_not_found"
        ? 404
        : validated.error === "no_sources_selected"
          ? 422
          : 403;
    return NextResponse.json({ error: validated.error }, { status });
  }

  const { docIds, nodeId } = validated;
  const chunks = await withTenantContext(ctx.tenantId, (client) =>
    retrieveNodeChunks(client, ctx.tenantId, message, {
      nodeId,
      unsPath: null, // notebook nodes are standalone; scope is the doc set
      topK: 6,
      docIds,
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

  const citations = await buildCitations(ctx.tenantId, chunks);
  const systemPrompt = appendManualContext(BASE_SYSTEM_PROMPT, chunks);
  // appendManualContext only appends the grounding RULES — the excerpts
  // themselves ride in the user message (injection-hardened data channel),
  // same as the asset-chat and node-chat routes.
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildManualUserContent(message, chunks) },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sourcesFrame: NotebookSourcesFrame = {
        kind: "sources",
        citations,
        sourceSnapshot: docIds,
      };
      controller.enqueue(enc.encode(sse(sourcesFrame)));

      const responseBuffer: string[] = [];
      let served = false;
      let servedModel: string | null = null;

      for (const provider of providers()) {
        if (!provider.key) continue;
        try {
          const res = await fetch(provider.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.key}`,
            },
            body: JSON.stringify({
              model: provider.model,
              messages,
              stream: true,
              max_tokens: 800,
              temperature: 0.3,
            }),
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok || !res.body) continue;
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
                };
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  responseBuffer.push(delta);
                  const frame: NotebookContentFrame = { kind: "content", content: delta };
                  controller.enqueue(enc.encode(sse(frame)));
                }
                if (parsed.choices?.[0]?.finish_reason === "stop") finished = true;
              } catch {
                // partial frame — keep buffering
              }
            }
          }
          if (responseBuffer.length > 0) {
            served = true;
            servedModel = `${provider.name}:${provider.model}`;
            break;
          }
        } catch {
          continue; // cascade to next provider
        }
      }

      const answerText = responseBuffer.join("");
      const statusFrame: NotebookStatusFrame = served
        ? { kind: "status", status: "answered" }
        : { kind: "status", status: "error", message: "No answer provider available." };
      controller.enqueue(enc.encode(sse(statusFrame)));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();

      try {
        await recordTurn(ctx.tenantId, notebookId, {
          question: message,
          answerStatus: served ? "answered" : "error",
          answerText: served ? answerText : null,
          enabledSourceDocIds: docIds,
          evidence: citations,
          model: servedModel,
        });
      } catch {
        // persistence failure must not break the stream already delivered
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
