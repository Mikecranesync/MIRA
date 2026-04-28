import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { extractAndStore } from "@/lib/knowledge-graph/extractor";

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

  // Fetch asset context from DB
  let assetRow: Record<string, unknown> | null = null;
  try {
    assetRow = await withTenantContext(ctx.tenantId, (c) =>
      c.query(
        `SELECT
          equipment_number, manufacturer, model_number, serial_number,
          equipment_type, location, criticality, description,
          installation_date, last_maintenance_date, last_reported_fault,
          work_order_count
        FROM cmms_equipment
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
        [id, ctx.tenantId],
      ).then((r) => r.rows[0] ?? null),
    );
  } catch {
    // Non-fatal: continue without DB context (graceful degradation)
    assetRow = null;
  }

  const systemPrompt = assetRow
    ? buildSystemPrompt(assetRow)
    : `You are MIRA, an AI maintenance assistant for industrial equipment. Answer questions about this asset concisely and accurately. Cite manual sections when referenced.`;

  const fullMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...messages.filter((m) => m.role !== "system"),
  ];

  const enc = new TextEncoder();
  const providers = getProviders();

  const conversationId = crypto.randomUUID();
  const responseBuffer: string[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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

      controller.close();

      // Fire-and-forget KG extraction — never blocks the chat response
      const fullResponse = responseBuffer.join("");
      const userText = messages.map((m) => m.content).join(" ");
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
