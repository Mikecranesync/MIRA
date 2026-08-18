// Hub folder=brain — Ask MIRA at a namespace node.
//
// Spec: docs/specs/uns-node-centric-knowledge-spec.md (Slice — subtree-grounded node chat)
//
// Cloned from the asset chat route (/api/assets/[id]/chat) per spec §4 ("clone … swap
// asset-context+retrieval for node-subtree retrieval"). The cascade + safety hard-stop +
// citation machinery are intentionally duplicated leaf code, kept identical to the asset
// path so the demoed asset chat stays untouched. Differences from the asset route:
//   - retrieval is subtree-scoped (retrieveNodeChunks), with NO tenant-wide fallback;
//   - the system prompt is node/UNS-context, not asset make/model;
//   - no asset-scoped KG graph context or fire-and-forget KG extraction.
//
// The node selection IS the UNS location-confirmation gate (UNS-020): the user explicitly
// chose this node, so node-scoped chat is gate-compliant by construction. The pre-LLM
// safety keyword hard-stop is preserved.

import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { scanBoth, handleSafetyAlert, safetyAlertSseChunk } from "@/lib/agents/safety-alert";
import {
  retrieveNodeChunks,
  appendManualContext,
  buildManualUserContent,
  buildDocScopedSystemPrompt,
  chunksToSources,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";
import { matchSafetyStop, SAFETY_STOP } from "@/lib/safety-classifier";
import { linkedDocIdsForNode } from "@/lib/workspace-files";

export const dynamic = "force-dynamic";

// ── LLM Cascade (Groq → Cerebras → Gemini) ────────────────────────────────
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CascadeProvider {
  name: string;
  url: string;
  key: string | undefined;
  model: string;
}

function getProviders(): CascadeProvider[] {
  return [
    {
      name: "Groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
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

async function streamFromProvider(
  provider: CascadeProvider,
  messages: ChatMessage[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  enc: TextEncoder,
  responseBuffer: string[],
): Promise<boolean> {
  if (!provider.key) return false;

  let res: Response;
  try {
    res = await fetch(provider.url, {
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
        // gpt-oss spends completion tokens on reasoning; low effort preserves
        // the 800-token budget for the streamed answer.
        ...(provider.model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return false;
  }

  if (!res.ok || !res.body) return false;

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";

  while (true) {
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
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        return true;
      }
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string }; finish_reason?: string }[];
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          responseBuffer.push(delta);
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ content: delta })}\n\n`));
        }
        if (parsed.choices?.[0]?.finish_reason === "stop") {
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          return true;
        }
      } catch {
        // malformed SSE chunk — skip
      }
    }
  }
  return true;
}

// ── Node context ─────────────────────────────────────────────────────────────
function buildNodeSystemPrompt(node: { name: string; unsPath: string | null }): string {
  return `You are MIRA, an AI maintenance assistant for industrial equipment built by FactoryLM.

## Namespace node in scope
- Node: ${node.name}
- UNS path: ${node.unsPath ?? "—"}

This node, and every node beneath it in the namespace, is the technician's confirmed work
context. The documentation below was attached to this part of the namespace.

## Instructions
- Answer using ONLY the documentation provided below.
- Cite sources with [n] markers matching the numbered documentation blocks.
- If the documentation does not cover the question, say so plainly — never guess at
  specifications, torque values, fault codes, or safety procedures.
- Keep answers concise and actionable. Techs are on the floor.
- If the question involves lockout/tagout, arc flash, confined space, or electrical safety,
  stop and instruct the tech to follow site safety procedures before proceeding.`;
}

/**
 * Merge the node-stamped pass with the file-link pass, keeping the highest-rank
 * copy of each distinct passage. Dedupe key is source + page + a content prefix:
 * the same chunk reached by both paths must be cited once.
 */
function mergeChunks(primary: ManualChunk[], extra: ManualChunk[]): ManualChunk[] {
  const seen = new Set<string>();
  const out: ManualChunk[] = [];
  for (const chunk of [...primary, ...extra].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))) {
    const key = `${chunk.sourceUrl ?? ""}|${chunk.sourcePage ?? ""}|${(chunk.content ?? "").slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chunk);
  }
  return out;
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let body: { messages?: ChatMessage[]; docId?: string };
  try {
    body = await req.json() as { messages?: ChatMessage[]; docId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }

  // ARPK Phase 1a — optional document scope. docId = hub_uploads.id, stamped as
  // knowledge_entries.doc_id on every v2 chunk. Validated here, resolved below
  // (chunk-side, under RLS) so an unknown/foreign docId is a 404, not an
  // ungrounded chat with a misleading scope banner.
  const docId = typeof body.docId === "string" && body.docId.length > 0 ? body.docId : null;
  if (docId && !/^[0-9a-f-]{36}$/i.test(docId)) {
    return NextResponse.json({ error: "invalid docId" }, { status: 400 });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return NextResponse.json({ error: "No user message" }, { status: 400 });
  }

  // Safety gate — hard stop before touching LLM
  const trigger = matchSafetyStop(lastUser.content);
  if (trigger) {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const words = SAFETY_STOP.split(" ");
        for (const word of words) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ content: word + " " })}\n\n`));
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Safety-Stop": trigger,
      },
    });
  }

  // Canonical files (migration 075): documents attached to THIS node through
  // workspace_file_links. The link derivation IS the membership proof, so these
  // ids may be retrieved with validatedDocScope — a document ingested once
  // under another node keeps that node's chunk stamp and would otherwise be
  // invisible here. This only WIDENS the default node ask: an explicit docId
  // keeps today's exact behavior, and the node-stamped pass still runs, so
  // legacy documents are unaffected. Read before (not inside) the retrieval
  // transaction — nesting withTenantContext would hold two of the pool's five
  // clients per request. A failure here is non-fatal.
  let linkedDocIds: string[] = [];
  if (!docId) {
    try {
      linkedDocIds = await linkedDocIdsForNode(ctx.tenantId, id);
    } catch (err) {
      console.warn("[api/namespace/node/:id/chat] linked doc lookup skipped", err);
    }
  }

  // Resolve node context (+ optional document) + scoped chunks in one
  // tenant-scoped (RLS) transaction. Node/doc misses are fatal (404); empty
  // retrieval is not — chat still answers ("no coverage").
  let nodeRow: { name: string; uns_path: string | null } | null = null;
  let docFilename: string | null = null;
  let docMissing = false;
  let nodeChunks: ManualChunk[] = [];
  try {
    const fetched = await withTenantContext(ctx.tenantId, async (c) => {
      const nodeRes = await c.query(
        `SELECT name, uns_path::text AS uns_path
           FROM kg_entities
          WHERE id = $1 AND tenant_id = $2
            AND approval_state = 'verified'
          LIMIT 1`,
        [id, ctx.tenantId],
      );
      const row = (nodeRes.rows[0] ?? null) as { name: string; uns_path: string | null } | null;
      if (!row) return { row: null, chunks: [] as ManualChunk[], filename: null, missing: false };

      // Document scope: resolve the filename from the doc's own chunks
      // (chunk-side, RLS-visible — the same reason retrieveNodeChunks reads
      // metadata->>'node_id' instead of joining hub_uploads, which has no RLS).
      let filename: string | null = null;
      if (docId) {
        const docRes = await c.query(
          `SELECT metadata->>'filename' AS filename
             FROM knowledge_entries
            WHERE tenant_id = $1 AND doc_id = $2::uuid AND ingest_route = 'v2'
            LIMIT 1`,
          [ctx.tenantId, docId],
        );
        filename = (docRes.rows[0]?.filename as string | undefined) ?? null;
        if (!filename) return { row, chunks: [] as ManualChunk[], filename: null, missing: true };
      }

      const chunks = await retrieveNodeChunks(c, ctx.tenantId, lastUser.content, {
        nodeId: id,
        unsPath: row.uns_path,
        ...(docId ? { docId } : {}),
      });
      let allChunks = chunks;
      if (linkedDocIds.length > 0) {
        const linkedChunks = await retrieveNodeChunks(c, ctx.tenantId, lastUser.content, {
          nodeId: id,
          unsPath: row.uns_path,
          docIds: linkedDocIds,
          validatedDocScope: true,
        });
        allChunks = mergeChunks(chunks, linkedChunks);
      }
      const approvedChunks = approvedAskEnforcementEnabled()
        ? allChunks.filter((chunk) => chunk.verified === true)
        : allChunks;
      return { row, chunks: approvedChunks, filename, missing: false };
    });
    nodeRow = fetched.row;
    nodeChunks = fetched.chunks;
    docFilename = fetched.filename;
    docMissing = fetched.missing;
  } catch {
    // Non-fatal: continue without DB context (graceful degradation)
    nodeRow = null;
    nodeChunks = [];
  }

  if (!nodeRow) {
    return NextResponse.json({ error: "node not found" }, { status: 404 });
  }
  if (docId && docMissing) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }

  const baseSystemPrompt =
    docId && docFilename
      ? buildDocScopedSystemPrompt({
          filename: docFilename,
          nodeName: nodeRow.name,
          unsPath: nodeRow.uns_path,
        })
      : buildNodeSystemPrompt({
          name: nodeRow.name,
          unsPath: nodeRow.uns_path,
        });
  const systemPrompt = appendManualContext(baseSystemPrompt, nodeChunks);
  const nodeSources: ManualSource[] = chunksToSources(nodeChunks);
  const approvedSourceCount = nodeSources.filter((s) => s.verified).length;
  const safetyLabel = nodeRow.name || id;
  const approvedSummary = {
    approvedSourceCount,
    verifiedRelationshipCount: 0,
    approvedLiveSignalCount: 0,
  };

  if (approvedAskEnforcementEnabled() && !approvedContextReady(approvedSummary)) {
    return NextResponse.json(buildApprovedContextRefusal(approvedSummary), { status: 412 });
  }

  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  const lastUserIndex = (() => {
    for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
      if (nonSystemMessages[i].role === "user") return i;
    }
    return -1;
  })();
  const contextualMessages = nonSystemMessages.map((m, i) =>
    i === lastUserIndex ? { ...m, content: buildManualUserContent(m.content, nodeChunks) } : m,
  );

  const fullMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...contextualMessages,
  ];

  const enc = new TextEncoder();
  const providers = getProviders();
  const responseBuffer: string[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Emit retrieved sources up front so the UI can render citation chips
      // alongside the streaming answer.
      if (nodeSources.length > 0) {
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({
              sources: nodeSources,
              approved_source_count: approvedSourceCount,
            })}\n\n`,
          ),
        );
      }

      let served = false;
      for (const provider of providers) {
        try {
          served = await streamFromProvider(provider, fullMessages, controller, enc, responseBuffer);
          if (served) break;
        } catch {
          // cascade
        }
      }

      if (!served) {
        const msg = "MIRA is temporarily unavailable. All inference providers are down. Please try again in a moment.";
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ content: msg })}\n\n`));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      }

      // Safety alert scan — runs after full response is assembled, before close
      const fullResponse = responseBuffer.join("");
      const userText = messages.map((m) => m.content).join(" ");
      const safetyAlert = scanBoth(userText, fullResponse, safetyLabel);
      if (safetyAlert) {
        controller.enqueue(enc.encode(safetyAlertSseChunk(safetyAlert)));
        handleSafetyAlert(safetyAlert, ctx.tenantId).catch(() => {});
      }

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
