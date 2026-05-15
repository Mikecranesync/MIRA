import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { cascadeComplete, type CascadeMessage } from "@/lib/llm/cascade";

export const dynamic = "force-dynamic";

interface AskPayload {
  session_id: string;
  question: string;
}

interface SessionRow {
  id: string;
  status: string;
  asset_id: string | null;
  component_id: string | null;
  transcript: Array<{ role: string; content: string; ts?: string }>;
  asset_name: string | null;
  asset_tag: string | null;
  component_name: string | null;
  component_plc_tag: string | null;
}

/**
 * POST /api/mira/ask
 *
 * Hard rule: no confirmed namespace context, no troubleshooting.
 * If session.status != 'confirmed' OR asset_id is missing, returns 412
 * (Precondition Required) with `{gate: "namespace", reason}` so the tablet
 * can show the confirmation card instead of an answer.
 *
 * On success, runs the Groq → Cerebras → Gemini cascade with a context
 * package built from the KG (asset + component template + recent signals
 * + verified relationships), appends both turns to the transcript, and
 * returns `{answer, citations, provider, session_id}`.
 *
 * Demo-grade: no streaming, no SSE. Tablet shows a typing indicator while
 * this runs (~2–5 s typical).
 */
export async function POST(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  let body: AskPayload;
  try {
    body = (await req.json()) as AskPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.session_id || !body.question || typeof body.question !== "string") {
    return NextResponse.json(
      { error: "session_id_and_question_required" },
      { status: 400 },
    );
  }

  // ── 1. Load session + enforce the gate ────────────────────────────────
  const session = await withTenantContext<SessionRow | null>(ctx.tenantId, (c) =>
    c
      .query(
        `SELECT s.id, s.status, s.asset_id, s.component_id, s.transcript,
                a.name AS asset_name, a.entity_id AS asset_tag,
                i.component_name, i.plc_tag AS component_plc_tag
           FROM troubleshooting_sessions s
           LEFT JOIN kg_entities a ON a.id = s.asset_id
           LEFT JOIN installed_component_instances i ON i.id = s.component_id
          WHERE s.tenant_id = $1 AND s.id = $2
          LIMIT 1`,
        [ctx.tenantId, body.session_id],
      )
      .then((r: { rows: SessionRow[] }) => r.rows[0] ?? null),
  );

  if (!session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if (session.status !== "confirmed" || !session.asset_id) {
    return NextResponse.json(
      {
        gate: "namespace",
        reason:
          "Confirm the asset (and component, if known) before troubleshooting. POST /api/sessions/confirm first.",
        session_id: session.id,
        current_status: session.status,
      },
      { status: 412 },
    );
  }

  // ── 2. Build grounding context ────────────────────────────────────────
  const grounding = await withTenantContext(ctx.tenantId, async (c) => {
    const asset = session.asset_id;
    const component = session.component_id;

    const components = await c
      .query(
        `SELECT i.id, i.component_name, i.canonical_name, i.plc_tag, i.installed_location,
                t.manufacturer, t.model, t.common_failure_modes, t.troubleshooting_steps,
                t.signal_behavior
           FROM installed_component_instances i
           LEFT JOIN component_templates t ON t.id = i.template_id
          WHERE i.tenant_id = $1 AND i.asset_id = $2
          ORDER BY i.component_name`,
        [ctx.tenantId, asset],
      )
      .then((r: { rows: Record<string, unknown>[] }) => r.rows);

    const edges = await c
      .query(
        `SELECT r.relationship_type, r.confidence,
                src.entity_type AS s_type, src.name AS s_name,
                tgt.entity_type AS t_type, tgt.name AS t_name
           FROM kg_relationships r
           JOIN kg_entities src ON src.id = r.source_id
           JOIN kg_entities tgt ON tgt.id = r.target_id
          WHERE r.tenant_id = $1
            AND (r.source_id = $2 OR r.target_id = $2 OR r.source_id = ANY($3::uuid[]))
          ORDER BY r.confidence DESC
          LIMIT 30`,
        [ctx.tenantId, asset, components.map((cmp: Record<string, unknown>) => cmp.id)],
      )
      .then((r: { rows: Record<string, unknown>[] }) => r.rows);

    const recentSignals = await c
      .query(
        `SELECT e.created_at, e.value_text, e.value_numeric, e.value_bool,
                e.simulated, i.component_name, i.plc_tag
           FROM live_signal_events e
           JOIN installed_component_instances i ON i.id = e.component_id
          WHERE e.tenant_id = $1 AND i.asset_id = $2
          ORDER BY e.created_at DESC
          LIMIT 10`,
        [ctx.tenantId, asset],
      )
      .then((r: { rows: Record<string, unknown>[] }) => r.rows);

    return { components, edges, recentSignals, focusComponentId: component };
  });

  // ── 3. Compose system prompt with citations available to model ────────
  const focusCmp = (grounding.components as Array<Record<string, unknown>>).find(
    (cmp) => cmp.id === grounding.focusComponentId,
  );

  const citationItems: Array<{ id: string; label: string }> = [];
  let citationCounter = 1;
  function cite(label: string): string {
    const id = `[C${citationCounter++}]`;
    citationItems.push({ id, label });
    return id;
  }

  const lines: string[] = [
    `You are MIRA, an industrial maintenance diagnostic assistant. You are talking to a technician on a tablet at the equipment.`,
    ``,
    `## Asset in scope (confirmed)`,
    `- Name: ${session.asset_name ?? "—"}`,
    `- Asset tag: ${session.asset_tag ?? "—"} ${cite(`asset row ${session.asset_id}`)}`,
  ];
  if (focusCmp) {
    lines.push(
      `- Focus component: ${focusCmp.component_name as string} (${(focusCmp.manufacturer as string) ?? "—"} ${(focusCmp.model as string) ?? ""}) ${cite(`component row ${focusCmp.id as string}`)}`,
      `- PLC tag: ${(focusCmp.plc_tag as string) ?? "—"}`,
    );
    const tsteps = focusCmp.troubleshooting_steps as Array<Record<string, unknown>> | null;
    if (tsteps && Array.isArray(tsteps) && tsteps.length > 0) {
      lines.push(`- Troubleshooting steps for this component ${cite(`component_template.troubleshooting_steps`)}:`);
      for (const step of tsteps.slice(0, 8)) {
        lines.push(`  ${step.step ?? "?"}. ${step.action ?? ""}`);
      }
    }
    const failures = focusCmp.common_failure_modes as Array<Record<string, unknown>> | null;
    if (failures && Array.isArray(failures) && failures.length > 0) {
      lines.push(`- Known failure modes ${cite(`component_template.common_failure_modes`)}:`);
      for (const f of failures.slice(0, 6)) {
        lines.push(`  • ${f.mode ?? ""}: ${f.symptom ?? ""} (${f.severity ?? ""})`);
      }
    }
  }
  lines.push(``, `## Components on this asset`);
  for (const cmp of grounding.components as Array<Record<string, unknown>>) {
    lines.push(
      `- ${cmp.component_name as string}` +
        (cmp.plc_tag ? ` → PLC tag ${cmp.plc_tag as string}` : "") +
        (cmp.manufacturer ? ` [${cmp.manufacturer as string} ${(cmp.model as string) ?? ""}]` : ""),
    );
  }
  if (grounding.edges.length > 0) {
    lines.push(``, `## Verified relationships (from knowledge graph)`);
    for (const e of grounding.edges.slice(0, 20)) {
      lines.push(
        `- (${(e.s_type as string)}) ${(e.s_name as string)} —${(e.relationship_type as string)}→ (${(e.t_type as string)}) ${(e.t_name as string)} [conf ${Number(e.confidence).toFixed(2)}]`,
      );
    }
  }
  if (grounding.recentSignals.length > 0) {
    lines.push(``, `## Recent signal samples (last 10) ${cite(`live_signal_events`)}`);
    for (const s of grounding.recentSignals as Array<Record<string, unknown>>) {
      const val = s.value_text ?? s.value_numeric ?? s.value_bool;
      lines.push(`- ${s.created_at as string} | ${s.component_name as string} (${s.plc_tag as string}) = ${String(val)}${s.simulated ? " [SIM]" : ""}`);
    }
  }
  lines.push(
    ``,
    `## Instructions`,
    `- Answer using only the asset/component/signal/relationship context above. If the answer isn't supported by that context, say so explicitly.`,
    `- Cite which row in the context backs each factual claim using the [C1], [C2], ... markers shown.`,
    `- For safety-critical work (LOTO, arc flash, confined space, electrical), instruct the tech to follow site safety procedures before touching anything.`,
    `- Keep answers under 6 short sentences. Techs are at the equipment.`,
  );

  const systemPrompt = lines.join("\n");

  // ── 4. Call cascade ───────────────────────────────────────────────────
  const messages: CascadeMessage[] = [
    { role: "system", content: systemPrompt },
    ...session.transcript
      .filter((t) => t.role === "user" || t.role === "assistant")
      .slice(-6)
      .map((t) => ({ role: t.role as "user" | "assistant", content: t.content })),
    { role: "user", content: body.question },
  ];

  const result = await cascadeComplete(messages, { temperature: 0.2, maxTokens: 500, timeoutMs: 20_000 });

  if (!result) {
    return NextResponse.json(
      {
        error: "all_providers_unavailable",
        gate: "provider_outage",
      },
      { status: 503 },
    );
  }

  // ── 5. Append to transcript ───────────────────────────────────────────
  const userTurn = { role: "user", content: body.question, ts: new Date().toISOString() };
  const assistantTurn = {
    role: "assistant",
    content: result.content,
    ts: new Date().toISOString(),
    provider: result.provider,
    citations: citationItems,
  };

  await withTenantContext(ctx.tenantId, (c) =>
    c.query(
      `UPDATE troubleshooting_sessions
          SET transcript = transcript || $3::jsonb,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [ctx.tenantId, session.id, JSON.stringify([userTurn, assistantTurn])],
    ),
  );

  return NextResponse.json({
    session_id: session.id,
    answer: result.content,
    provider: result.provider,
    duration_ms: result.durationMs,
    citations: citationItems,
  });
}
