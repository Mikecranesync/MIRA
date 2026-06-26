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
  chunksToSources,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";

export const dynamic = "force-dynamic";

// ── Safety keywords (mirrors mira-bots/shared/guardrails.py SAFETY_KEYWORDS) ──
const SAFETY_PHRASES = [
  "arc flash", "loto", "lockout tagout", "lockout/tagout",
  "confined space", "fall arrest", "energized", "live wire",
  "live electrical", "shock hazard", "electrocution",
  "permit required", "hot work", "asphyxiation",
  "explosive atmosphere", "ppe required",
];

function hasSafetyKeyword(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of SAFETY_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

const SAFETY_STOP = `⛔ SAFETY STOP

This question involves a safety-critical topic. Do not proceed without:

1. Following your site's lockout/tagout (LOTO) procedure
2. Confirming all energy sources are isolated and verified zero-energy
3. Consulting a qualified person or supervisor before continuing

MIRA will not provide guidance that bypasses safety controls.
Contact your safety officer or supervisor immediately.`;

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

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json() as { messages?: ChatMessage[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return NextResponse.json({ error: "No user message" }, { status: 400 });
  }

  // Safety gate — hard stop before touching LLM
  const trigger = hasSafetyKeyword(lastUser.content);
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

  // Resolve node context + subtree-scoped chunks in one tenant-scoped (RLS) transaction.
  // Both are non-fatal: chat still answers (ungrounded, "no coverage") if either is empty.
  let nodeRow: { name: string; uns_path: string | null } | null = null;
  let nodeChunks: ManualChunk[] = [];
  try {
    const fetched = await withTenantContext(ctx.tenantId, async (c) => {
      const nodeRes = await c.query(
        `SELECT name, uns_path::text AS uns_path
           FROM kg_entities
          WHERE id = $1 AND tenant_id = $2
          LIMIT 1`,
        [id, ctx.tenantId],
      );
      const row = (nodeRes.rows[0] ?? null) as { name: string; uns_path: string | null } | null;
      if (!row) return { row: null, chunks: [] as ManualChunk[] };
      const chunks = await retrieveNodeChunks(c, ctx.tenantId, lastUser.content, {
        nodeId: id,
        unsPath: row.uns_path,
      });
      return { row, chunks };
    });
    nodeRow = fetched.row;
    nodeChunks = fetched.chunks;
  } catch {
    // Non-fatal: continue without DB context (graceful degradation)
    nodeRow = null;
    nodeChunks = [];
  }

  if (!nodeRow) {
    return NextResponse.json({ error: "node not found" }, { status: 404 });
  }

  const baseSystemPrompt = buildNodeSystemPrompt({
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

  const fullMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages.filter((m) => m.role !== "system"),
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
