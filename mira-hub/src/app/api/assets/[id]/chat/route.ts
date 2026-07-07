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
  neutralizeReferenceText,
  type ManualChunk,
  type ManualSource,
} from "@/lib/manual-rag";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";
import { SAFETY_PHRASES } from "@/lib/safety-phrases";
import {
  buildMachineContextPacket,
  renderMachineEvidenceSection,
  type MachineContextPacket,
} from "@/lib/machine-context-packet";

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

// Review Q1 (PR #2414) — the strings below (tag_path, diff_type, severity,
// metadata.title, next_check, state/status) are DB-sourced from ingested
// anomaly-detection output, not technician/admin-authored text. The manual
// context path (manual-rag.ts buildGroundedContext) already treats this exact
// shape of untrusted text — reference content interpolated into the SYSTEM
// prompt — as a prompt-injection vector: it caps length (MAX_CONTENT_CHARS)
// then strips forged headers/instruction markers (neutralizeReferenceText).
// Apply the same defense here, at a smaller per-field cap since these are
// short labels, not paragraphs.
//
// NOTE the distinction from `context/route.ts`'s `machine_memory` block: that
// route returns these same fields as raw JSON *data* for a client to render —
// not interpolated into an LLM prompt — so it does not need this treatment.
// Only prompt interpolations (this file) require neutralizing.
const MACHINE_MEMORY_FIELD_MAX_CHARS = 120;

// Accepts `unknown` because these fields come off `Record<string, unknown>`
// rows straight from the DB driver (machine_run/machine_state_window/run_diff
// columns aren't narrowed to `string`) — coerce defensively rather than trust
// the column type.
function sanitizeMachineMemoryField(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const str = typeof value === "string" ? value : String(value);
  return neutralizeReferenceText(str.slice(0, MACHINE_MEMORY_FIELD_MAX_CHARS));
}

// Live machine evidence section is rendered by renderMachineEvidenceSection in
// @/lib/machine-context-packet (pure + unit-tested); the route passes its
// prompt-injection scrub (sanitizeMachineMemoryField) as the field sanitizer.

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

  // Ownership pre-check (#2374): verify the caller owns this asset before proceeding.
  // Returns 404 if the asset is not found for the caller's tenant (not owned).
  // DB errors do not convert to 404 — they fall through to graceful degradation.
  try {
    const c = await pool.connect();
    try {
      const ownershipRes = await c.query(
        `SELECT 1 FROM cmms_equipment WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, ctx.tenantId],
      );
      if (ownershipRes.rows.length === 0) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }
    } finally {
      c.release();
    }
  } catch {
    // DB error during ownership check — do not convert to 404.
    // Fall through to let the handler proceed with graceful degradation.
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

  // Drive-pack pre-check (#2527) — read-only pre-check against the
  // deterministic drive-pack answer service (mira-ask). If it matches, this
  // question has a manual-cited, deterministic answer that should win over a
  // generic LLM-cascade reply. Best-effort only: ANY failure, timeout,
  // non-200, or non-match falls straight through to the existing cascade
  // below — this block must never break chat.
  try {
    const askBase = process.env.MIRA_ASK_URL ?? "http://mira-ask:8011";
    const askRes = await fetch(`${askBase}/drive-pack/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.ASK_API_KEY ? { "X-Mira-Key": process.env.ASK_API_KEY } : {}),
      },
      body: JSON.stringify({ question: lastUser.content }),
      signal: AbortSignal.timeout(4000),
    });

    if (askRes.ok) {
      const askData = (await askRes.json()) as {
        pack_id?: string;
        matched?: boolean;
        answer?: string;
        answer_source?: string;
        citations?: { doc: string; page?: string | number | null }[];
      };

      if (askData.matched === true && askData.answer_source === "drive_pack" && askData.answer) {
        const citationLines = (askData.citations ?? [])
          .map((c) => `[Source: ${c.doc}${c.page ? ` p.${c.page}` : ""}]`)
          .join("\n");
        // The drive-pack answer is always static reference material, never
        // live telemetry — so the prefix below is unconditionally accurate.
        // (This pre-check runs before the machine-memory context packet is
        // built further down, so there is no clean live-vs-static signal
        // available at this point to make the prefix conditional instead.)
        const replyText = `Static pack reference — not from live telemetry.\n\n${askData.answer}${
          citationLines ? `\n\n${citationLines}` : ""
        }`;

        const askEnc = new TextEncoder();
        const askStream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(askEnc.encode(`data: ${JSON.stringify({ content: replyText })}\n\n`));
            controller.enqueue(askEnc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(askStream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Drive-Pack": String(askData.pack_id ?? ""),
          },
        });
      }
    }
  } catch {
    // Best-effort pre-check: any error/timeout falls through to the cascade.
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
  let machinePacket: MachineContextPacket | null = null;
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

      // Live machine context packet (machine_memory_intelligence_bridge) — the
      // deterministic, read-only builder that resolves uns_path (same
      // kg_entities bridge, a separate lookup not a join: cmms_equipment.
      // tenant_id is TEXT, kg_entities is UUID), reads the persisted
      // runs/windows/anomaly diffs AND the current live tag values, decodes
      // them, and derives current state + an assessment. Runs on the same
      // owner-pool client `c` used above; every underlying query filters
      // `tenant_id = $1` explicitly, so it is tenant-scoped without RLS. Own
      // try/catch so a missing 038/040/020 env (or any error) never drops the
      // asset/manual context already fetched above.
      try {
        machinePacket = await buildMachineContextPacket(c, ctx.tenantId, id);
      } catch {
        // Non-fatal: chat still works without machine context
        machinePacket = null;
      }
    } finally {
      c.release();
    }
  } catch {
    // Non-fatal: continue without DB context (graceful degradation)
    assetRow = null;
    manualChunks = [];
    verifiedRelationshipCount = 0;
    machinePacket = null;
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

  const machineMemorySection = machinePacket
    ? renderMachineEvidenceSection(machinePacket, sanitizeMachineMemoryField)
    : "";
  const withMachineMemory = machineMemorySection
    ? `${withGraph}\n\n${machineMemorySection}`
    : withGraph;
  // The top active condition's next_check — surfaced to the client alongside
  // sources so the evidence UI can render a "Next check" line (T2 Task 4). Same
  // neutralize+cap treatment as buildMachineEvidenceSection (review Q1): this
  // value is DB-sourced from the same untrusted ingest fields, and rendering
  // it verbatim would both bypass the defense (the prompt sees a neutralized
  // version while the UI shows the raw injection payload) and echo forged
  // content back to the technician.
  const rawNextCheck =
    machinePacket?.active_conditions.find((c) => c.next_check)?.next_check ?? null;
  const nextCheck = rawNextCheck ? sanitizeMachineMemoryField(rawNextCheck) : null;

  const systemPrompt = appendManualContext(withMachineMemory, manualChunks);
  const manualSources: ManualSource[] = chunksToSources(manualChunks);
  const approvedSourceCount = manualSources.filter((s) => s.verified).length;
  const approvedSummary = {
    approvedSourceCount,
    verifiedRelationshipCount,
    // Live real (non-simulated, fresh) tags now count as approved context —
    // the asset chat finally sees the current machine state as evidence.
    approvedLiveSignalCount: machinePacket?.freshness.live ?? 0,
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
