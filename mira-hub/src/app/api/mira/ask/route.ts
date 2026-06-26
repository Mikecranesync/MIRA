import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { cascadeComplete, type CascadeMessage } from "@/lib/llm/cascade";
import { countTransitions } from "@/lib/signal-recorder";
import { extractTrace, recordQueryTrace, type TraceGroundingLike } from "@/lib/knowledge-graph/trace";
import { clientIpHash, rateLimited } from "@/lib/ip-rate-limit";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "@/lib/approved-context";

export const dynamic = "force-dynamic";

// Authenticated, but reachable via the shared public demo bearer token (the
// expo-booth iPad), and it fires the shared free-tier cascade. Per-IP rate
// limit so a leaked/shared token can't drain the cohort's quota. Higher cap
// than the fully-public quickstart door. See @/lib/ip-rate-limit.
const MIRA_ASK_MAX_PER_MIN = 40;

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
 * "How many times in the last N {seconds|minutes}" → window in seconds.
 *
 * Demo cases:
 *   "how many times did I flag it in the last minute" → 60
 *   "transitions over the last 30 seconds"             → 30
 *   "how often in the last 5 minutes"                  → 300
 *
 * Returns null when no recognizable window phrase is present.
 */
function parseTransitionWindow(q: string): number | null {
  const m = q
    .toLowerCase()
    .match(/(?:last|past)\s+(?:(\d+)\s*)?(seconds?|secs?|minutes?|mins?|minute|min|second|sec)/);
  if (!m) {
    // Also catch the bare "in the last minute" phrasing (no number).
    if (/last\s+minute\b/.test(q.toLowerCase())) return 60;
    if (/last\s+second\b/.test(q.toLowerCase())) return 1;
    return null;
  }
  const n = m[1] ? Number(m[1]) : 1;
  const unit = m[2];
  const isMinute = unit.startsWith("min");
  return Math.max(1, isMinute ? n * 60 : n);
}

/**
 * True when the question implies a recurring-fault investigation worth
 * recording as a diagnostic trend. Demo trigger phrases include
 * "keeps shutting off", "trips frequently", "intermittent", etc.
 */
function mentionsRecurringFailure(q: string): boolean {
  const lower = q.toLowerCase();
  return [
    "keeps shutting off",
    "keeps tripping",
    "keeps faulting",
    "keeps cutting out",
    "trips frequently",
    "trips occasionally",
    "intermittent",
    "shuts off",
    "shuts down",
    "won't stay running",
    "wont stay running",
    "stops randomly",
    "stops occasionally",
  ].some((phrase) => lower.includes(phrase));
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

  // Rate limit before any work — we never store raw IPs.
  if (rateLimited("mira-ask", await clientIpHash(), MIRA_ASK_MAX_PER_MIN, 60_000)) {
    return NextResponse.json(
      { error: "Too many requests — slow down and try again in a minute." },
      { status: 429 },
    );
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

  // ── 1b. Question-pattern parsing ─────────────────────────────────────
  // Extract two demo-specific signals from the question text so the
  // grounding step can pre-compute facts the LLM otherwise can't:
  //   - transitionWindowSec: "how many times in the last N seconds/minutes"
  //   - proposeTrend       : "keeps shutting off", "trips frequently", etc.
  // Both are cheap heuristics — the LLM still composes the final reply.
  const transitionWindowSec = parseTransitionWindow(body.question);
  const proposeTrend = mentionsRecurringFailure(body.question);

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
            AND r.approval_state = 'verified'
            AND src.approval_state = 'verified'
            AND tgt.approval_state = 'verified'
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

    // live_signal_cache snapshot for the current state of every topic on
    // this asset — answers "is the PLC seeing X *right now*" without
    // scanning the event log.
    const currentSignals = await c
      .query(
        `SELECT cache.plc_tag,
                cache.last_value_text, cache.last_value_numeric, cache.last_value_bool,
                cache.last_changed_at, cache.last_seen_at,
                i.component_name
           FROM live_signal_cache cache
           LEFT JOIN installed_component_instances i ON i.id = cache.component_id
          WHERE cache.tenant_id = $1
            AND (i.asset_id = $2 OR cache.component_id IS NULL)
          ORDER BY cache.last_changed_at DESC`,
        [ctx.tenantId, asset],
      )
      .then((r: { rows: Record<string, unknown>[] }) => r.rows);

    // Pre-compute a transition count when the user asked "how many times…"
    let transitionFact: {
      topic: string;
      component_name: string | null;
      count: number;
      window_seconds: number;
    } | null = null;
    if (transitionWindowSec) {
      // Scope to the focus component if one is set, else fall back to the
      // first component on the asset (the demo has a clear hero — PE-001).
      const focus =
        (components as Array<Record<string, unknown>>).find(
          (cmp) => cmp.id === component,
        ) ?? (components as Array<Record<string, unknown>>)[0];
      const focusTag = (focus?.plc_tag as string | null) ?? null;
      const focusId = (focus?.id as string | null) ?? null;
      if (focusTag || focusId) {
        try {
          const tc = await countTransitions(c, {
            tenantId: ctx.tenantId,
            plcTag: focusTag,
            componentId: focusTag ? null : focusId,
            windowSeconds: transitionWindowSec,
          });
          transitionFact = {
            topic: focusTag ?? focusId ?? "",
            component_name: (focus?.component_name as string | null) ?? null,
            count: tc.transitions,
            window_seconds: tc.windowSeconds,
          };
        } catch (err) {
          console.warn("[api/mira/ask] countTransitions failed", err);
        }
      }
    }

    return {
      components,
      edges,
      recentSignals,
      currentSignals,
      focusComponentId: component,
      transitionFact,
    };
  });

  // ── 3. Compose system prompt with citations available to model ────────
  const approvedSummary = {
    approvedSourceCount: 0,
    verifiedRelationshipCount: grounding.edges.length,
    approvedLiveSignalCount:
      ((grounding.currentSignals as Array<Record<string, unknown>> | undefined)?.length ?? 0) +
      (grounding.recentSignals.length ?? 0),
  };

  if (approvedAskEnforcementEnabled() && !approvedContextReady(approvedSummary)) {
    return NextResponse.json(buildApprovedContextRefusal(approvedSummary), { status: 412 });
  }

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
  const currentSignals = (grounding as { currentSignals?: Array<Record<string, unknown>> })
    .currentSignals;
  if (currentSignals && currentSignals.length > 0) {
    lines.push(``, `## Current signal state ${cite(`live_signal_cache`)}`);
    for (const s of currentSignals) {
      const val =
        s.last_value_text ?? s.last_value_numeric ?? s.last_value_bool;
      lines.push(
        `- ${s.component_name ? `${s.component_name as string} ` : ""}(${s.plc_tag as string}) = ${String(val)} since ${s.last_changed_at as string}`,
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
  const transitionFact = (grounding as {
    transitionFact?: {
      topic: string;
      component_name: string | null;
      count: number;
      window_seconds: number;
    } | null;
  }).transitionFact;
  if (transitionFact) {
    lines.push(
      ``,
      `## Transition count ${cite(`live_signal_events window function`)}`,
      `- ${transitionFact.component_name ?? transitionFact.topic} changed value ${transitionFact.count} time(s) in the last ${transitionFact.window_seconds} second(s).`,
    );
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

  // ── 5b. Capture reasoning trace (best-effort; never blocks the answer) ──
  // The grounding's component ids are installed_component_instances ids — a
  // different id-space than the graph (kg_entities.id). So resolve the edge
  // endpoint NAMES that MIRA actually cited back to kg_entities.id; combined
  // with the anchor asset, that lights up the real traversed subgraph on
  // /graph rather than just the anchor. Name collisions can over-highlight
  // slightly — acceptable for a reasoning overlay.
  try {
    const traced = extractTrace(
      grounding as unknown as TraceGroundingLike,
      (session.asset_id as string | null) ?? null,
    );
    const rootId = (session.asset_id as string | null) ?? null;
    const names = [
      ...new Set(traced.edges.flatMap((e) => [e.sName, e.tName]).filter((n) => n.length > 0)),
    ];
    await withTenantContext(ctx.tenantId, async (c) => {
      const entityIds = new Set<string>();
      if (rootId) entityIds.add(rootId);
      if (names.length > 0) {
        const res = await c.query<{ id: string }>(
          `SELECT id FROM kg_entities WHERE tenant_id = $1::uuid AND name = ANY($2::text[])`,
          [ctx.tenantId, names],
        );
        for (const row of res.rows) entityIds.add(row.id);
      }
      if (entityIds.size === 0) return;
      await recordQueryTrace(c, ctx.tenantId, {
        sessionId: session.id,
        questionTurnIndex: 0,
        rootId,
        question: body.question,
        provider: result.provider,
        extracted: { entityIds: [...entityIds], edges: traced.edges },
      });
    });
  } catch (err) {
    console.error("[mira/ask] trace capture failed (non-fatal):", err);
  }

  // ── 6. Diagnostic trend proposal ─────────────────────────────────────
  // When the question implies a recurring fault, return a `trend_proposal`
  // payload alongside the answer. The tablet UI can render an "Open trend
  // session" affordance from this. The trend is NOT auto-created — the
  // tablet calls a follow-up endpoint with the user's confirmation, which
  // keeps unsolicited writes out of diagnostic_trend_sessions.
  let trendProposal:
    | {
        name: string;
        hypothesis: string;
        watched_topics: string[];
        suggested_duration_seconds: number;
      }
    | null = null;
  if (proposeTrend) {
    const componentRows = grounding.components as Array<Record<string, unknown>>;
    const watchedTopics = componentRows
      .map((cmp) => cmp.plc_tag as string | null)
      .filter((tag): tag is string => Boolean(tag));
    if (watchedTopics.length > 0) {
      trendProposal = {
        name: `Recurring-fault watch on ${session.asset_name ?? "asset"}`,
        hypothesis: `User reports recurring failure (\"${body.question.slice(0, 120)}\"). Watching all bound PLC tags for transitions during a ${120}-second window to localize the first edge.`,
        watched_topics: watchedTopics,
        suggested_duration_seconds: 120,
      };
    }
  }

  return NextResponse.json({
    session_id: session.id,
    answer: result.content,
    provider: result.provider,
    duration_ms: result.durationMs,
    citations: citationItems,
    transition_fact: transitionFact ?? null,
    trend_proposal: trendProposal,
  });
}
