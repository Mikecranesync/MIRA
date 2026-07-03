import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import pool from "@/lib/db";
import { extractAndStore } from "@/lib/knowledge-graph/extractor";
import { buildGraphContext } from "@/lib/knowledge-graph/context-builder";
import { scanBoth, handleSafetyAlert, safetyAlertSseChunk } from "@/lib/agents/safety-alert";
import {
  retrieveManualChunks,
  appendManualContext,
  buildManualUserContent,
  chunksToSources,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";
import { SAFETY_PHRASES } from "@/lib/safety-phrases";
import { fetchMachineMemory, type MachineMemory } from "@/lib/machine-memory";

export const dynamic = "force-dynamic";

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

// ── Asset context ──────────────────────────────────────────────────────────
function buildSystemPrompt(asset: Record<string, unknown>): string {
  const name = (asset.description as string) ||
    [asset.manufacturer, asset.model_number, asset.equipment_type].filter(Boolean).join(" ") ||
    "Unknown Equipment";

  return `You are MIRA, an AI maintenance assistant for industrial equipment built by FactoryLM.

## Asset in scope
- Name: ${name}
- Tag: ${asset.equipment_number ?? "—"}
- Manufacturer: ${asset.manufacturer ?? "—"}
- Model: ${asset.model_number ?? "—"}
- Serial: ${asset.serial_number ?? "—"}
- Type: ${asset.equipment_type ?? "—"}
- Location: ${asset.location ?? "—"}
- Criticality: ${asset.criticality ?? "—"}
- Install date: ${asset.installation_date ? String(asset.installation_date).slice(0, 10) : "—"}
- Last maintenance: ${asset.last_maintenance_date ? String(asset.last_maintenance_date).slice(0, 10) : "—"}
- Last fault: ${asset.last_reported_fault ?? "none recorded"}
- Work order count: ${asset.work_order_count ?? 0}

## Instructions
- Answer questions specifically about this asset using the context above.
- If you cite a manual section, say so explicitly (e.g., "Per the ${asset.manufacturer ?? "OEM"} service manual, §3.4…").
- If you are unsure, say so — never guess at safety-critical specifications.
- Keep answers concise and actionable. Techs are on the floor.
- If the question involves lockout/tagout, arc flash, confined space, or electrical safety, stop and instruct the tech to follow site safety procedures before proceeding.`;
}

// Live machine memory (T2 / seam 3) — persisted runs/state-windows/anomaly
// diffs become a citable prompt section. Machine-observed, not manual text.
function buildMachineMemorySection(memory: MachineMemory): string {
  const lines: string[] = [];
  const win = memory.latest_window;
  if (win) {
    lines.push(`- Current state: ${win.state} (since ${win.started_at})`);
  }
  const run = memory.latest_run;
  if (run) {
    lines.push(
      `- Latest run: ${run.status} (started ${run.started_at}${run.stopped_at ? `, stopped ${run.stopped_at}` : ""})`,
    );
  }
  const diffs = memory.latest_diffs.slice(0, 3);
  if (diffs.length > 0) {
    lines.push("- Recent anomalies:");
    for (const d of diffs) {
      const title =
        (d.metadata as { title?: string } | null)?.title || d.tag_path || "anomaly";
      const nextCheck = d.next_check ? ` — next check: ${d.next_check}` : "";
      lines.push(`  - [${d.diff_type ?? "diff"}] ${d.severity ?? "info"} — ${title}${nextCheck}`);
    }
  }
  if (lines.length === 0) return "";
  return `## Live Machine Memory
The following is MACHINE-OBSERVED evidence recorded from this asset's live tag history (runs, state windows, anomaly detections). Treat it as current, citable observations — cite it as "machine memory" when you use it.

${lines.join("\n")}`;
}

// Light PII scrub for the persisted question (mirrors the engine's intent —
// IP/MAC out of stored troubleshooting context). The question already went to
// the LLM providers; this only governs what we write to our own trace store.
function sanitizePII(text: string): string {
  return text
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[IP]")
    .replace(/\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g, "[MAC]");
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
  const startedAt = Date.now();

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

  // Fetch asset context + manual chunks. Both are non-fatal: chat still works
  // without them.
  //
  // #2178 — these run on the RAW owner pool (BYPASSRLS), NOT withTenantContext.
  // `knowledge_entries` is a hybrid corpus: the shared OEM library lives under
  // the system tenant (`is_private = false`), and retrieveManualChunks filters
  // `(is_private = false OR tenant_id = $caller)`. Under withTenantContext the
  // RLS policy (`tenant_id = app.tenant_id`) hides every is_private=false OEM
  // row, so a customer's asset chat saw ZERO manuals for every manufacturer and
  // refused ("I don't have specific information…"). The cmms_equipment lookup
  // is pure-tenant data, so it keeps an explicit `AND tenant_id = $2` (the IDOR
  // guard) — exactly the split /api/documents uses. See
  // `.claude/rules/knowledge-entries-tenant-scoping.md`.
  let assetRow: Record<string, unknown> | null = null;
  let manualChunks: ManualChunk[] = [];
  let verifiedRelationshipCount = 0;
  let machineMemory: MachineMemory | null = null;
  try {
    const c = await pool.connect();
    try {
      const assetRes = await c.query(
        `SELECT
          equipment_number, manufacturer, model_number, serial_number,
          equipment_type, location, criticality, description,
          installation_date, last_maintenance_date, last_reported_fault,
          work_order_count
        FROM cmms_equipment
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
        [id, ctx.tenantId],
      );
      assetRow = (assetRes.rows[0] ?? null) as Record<string, unknown> | null;
      const mfr = assetRow?.manufacturer ? String(assetRow.manufacturer) : null;
      manualChunks = await retrieveManualChunks(c, ctx.tenantId, lastUser.content, {
        manufacturer: mfr,
        allowTenantFallback: false,
      });
      if (approvedAskEnforcementEnabled()) {
        manualChunks = manualChunks.filter((chunk) => chunk.verified === true);
      }
      const relRes = await c.query(
        `WITH anchor AS (
           SELECT id
             FROM kg_entities
            WHERE tenant_id = $1
              AND approval_state = 'verified'
              AND (id::text = $2 OR entity_id = $2)
            LIMIT 1
         )
         SELECT COUNT(*)::int AS count
           FROM kg_relationships r
           JOIN anchor a ON (r.source_id = a.id OR r.target_id = a.id)
           JOIN kg_entities src
             ON src.id = r.source_id
            AND src.tenant_id = r.tenant_id
            AND src.approval_state = 'verified'
           JOIN kg_entities tgt
             ON tgt.id = r.target_id
            AND tgt.tenant_id = r.tenant_id
            AND tgt.approval_state = 'verified'
          WHERE r.tenant_id = $1
            AND r.approval_state = 'verified'`,
        [ctx.tenantId, id],
      );
      verifiedRelationshipCount = Number(relRes.rows[0]?.count ?? 0);

      // Live machine memory (T2 / seam 3) — resolve uns_path via the same
      // kg_entities bridge the context route uses (separate lookup, not a
      // join: cmms_equipment.tenant_id is TEXT, kg_entities is UUID), then
      // read the persisted runs/windows/anomaly diffs. Own try/catch so a
      // missing 038/040 env (or any machine-memory error) never drops the
      // asset/manual context already fetched above.
      try {
        const unsPath = await c
          .query(
            `SELECT uns_path::text AS uns_path
               FROM kg_entities
              WHERE tenant_id = $1
                AND entity_type = 'equipment'
                AND (id::text = $2 OR entity_id = $2)
              LIMIT 1`,
            [ctx.tenantId, id],
          )
          .then((r) => r.rows[0]?.uns_path ?? null);
        if (unsPath) {
          machineMemory = await fetchMachineMemory(c, ctx.tenantId, unsPath);
        }
      } catch {
        // Non-fatal: chat still works without machine memory
        machineMemory = null;
      }
    } finally {
      c.release();
    }
  } catch {
    // Non-fatal: continue without DB context (graceful degradation)
    assetRow = null;
    manualChunks = [];
    verifiedRelationshipCount = 0;
    machineMemory = null;
  }

  // KG graph context — fetch in parallel with (already completed) asset DB fetch
  // Returns "" if KG not populated; never throws (graceful fallback)
  const graphContext = await buildGraphContext(ctx.tenantId, lastUser.content, id).catch(() => "");

  const baseSystemPrompt = assetRow
    ? buildSystemPrompt(assetRow)
    : `You are MIRA, an AI maintenance assistant for industrial equipment. Answer questions about this asset concisely and accurately. Cite manual sections when referenced.`;

  const withGraph = graphContext
    ? `${baseSystemPrompt}\n\n## Knowledge Graph Context\nThe following relational context was retrieved from the plant knowledge graph. Use it to give more specific, history-aware answers.\n\n${graphContext}`
    : baseSystemPrompt;

  const machineMemorySection = machineMemory ? buildMachineMemorySection(machineMemory) : "";
  const withMachineMemory = machineMemorySection
    ? `${withGraph}\n\n${machineMemorySection}`
    : withGraph;
  // The newest anomaly's next_check — surfaced to the client alongside sources
  // so the evidence UI can render a "Next check" line (T2 Task 4).
  const nextCheck =
    machineMemory?.latest_diffs.find((d) => d.next_check)?.next_check ?? null;

  const systemPrompt = appendManualContext(withMachineMemory, manualChunks);
  const manualSources: ManualSource[] = chunksToSources(manualChunks);
  const approvedSourceCount = manualSources.filter((s) => s.verified).length;
  const approvedSummary = {
    approvedSourceCount,
    verifiedRelationshipCount,
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
    i === lastUserIndex
      ? { ...m, content: buildManualUserContent(m.content, manualChunks) }
      : m,
  );

  const fullMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...contextualMessages,
  ];

  const enc = new TextEncoder();
  const providers = getProviders();

  const conversationId = crypto.randomUUID();
  // Stable id for this answer's decision trace; emitted to the client up-front
  // (before any [DONE]) and used as the PK of the row written at stream end.
  const traceId = crypto.randomUUID();
  const responseBuffer: string[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Emit the trace id up-front (before any [DONE]) so the client can later
      // open "Why MIRA Thinks This". The row itself is written at stream end.
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ traceId })}\n\n`));

      // Emit retrieved sources up front so the UI can render citation chips
      // alongside the streaming answer.
      if (manualSources.length > 0) {
        controller.enqueue(
          enc.encode(
            `data: ${JSON.stringify({
              sources: manualSources,
              approved_source_count: approvedSourceCount,
            })}\n\n`,
          ),
        );
      }

      // Machine-memory next_check (T2 Task 4) — emitted up front like sources
      // so the evidence UI can render a "Next check" line with the answer.
      if (nextCheck) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ next_check: nextCheck })}\n\n`));
      }

      let served = false;
      let servedBy: string | null = null;
      for (const provider of providers) {
        try {
          served = await streamFromProvider(provider, fullMessages, controller, enc, responseBuffer);
          if (served) {
            servedBy = provider.name;
            break;
          }
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
      const safetyAlert = scanBoth(userText, fullResponse, id);
      if (safetyAlert) {
        controller.enqueue(enc.encode(safetyAlertSseChunk(safetyAlert)));
        handleSafetyAlert(safetyAlert, ctx.tenantId).catch(() => {});
      }

      // Persist a decision trace so this answer can be explained via the
      // "Why MIRA Thinks This" panel. Best-effort: never block/break the stream.
      try {
        const manualEvidence = manualChunks.map((mc) => ({
          doc:
            [mc.manufacturer, mc.modelNumber].filter(Boolean).join(" ") ||
            mc.title ||
            mc.sourceUrl ||
            "OEM document",
          page: mc.sourcePage,
          url: mc.sourceUrl || null,
          rank: mc.rank,
          verified: mc.verified === true,
        }));
        const grounded = manualSources.length > 0;
        await withTenantContext(ctx.tenantId, (c) =>
          c.query(
            `INSERT INTO decision_traces
               (trace_id, tenant_id, platform, user_question, manual_evidence,
                recommendation, citations_present, confidence, outcome,
                model_used, latency_ms)
             VALUES ($1, $2, 'hub', $3, $4::jsonb, $5, $6, $7, $8, $9, $10)`,
            [
              traceId,
              ctx.tenantId,
              sanitizePII(lastUser.content),
              JSON.stringify(manualEvidence),
              fullResponse,
              grounded,
              grounded ? "medium" : "low",
              grounded ? "resolved" : "kb_gap",
              servedBy,
              Date.now() - startedAt,
            ],
          ),
        );
      } catch {
        // non-fatal: the panel simply won't be available for this answer
      }

      controller.close();

      // Fire-and-forget KG extraction — never blocks the chat response
      if (fullResponse && process.env.NEON_DATABASE_URL) {
        extractAndStore(ctx.tenantId, id, `${userText} ${fullResponse}`, conversationId)
          .catch(() => { /* non-fatal */ });
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
