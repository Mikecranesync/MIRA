import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

interface CascadeProvider {
  name: string;
  url: string;
  key: string | undefined;
  model: string;
}

async function callLLM(prompt: string): Promise<string> {
  const providers: CascadeProvider[] = [
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

  for (const p of providers) {
    if (!p.key) continue;
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) return text;
    } catch {
      // cascade to next provider
    }
  }
  throw new Error("All LLM providers failed");
}

interface WorkOrderRow {
  id: string;
  work_order_number: string;
  equipment_id: string | null;
  manufacturer: string | null;
  model_number: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  source: string;
  title: string;
  description: string;
  tenant_id: string;
}

async function computeStats(tenantId: string) {
  const wos = await withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query<WorkOrderRow>(
      `SELECT
        id, work_order_number, equipment_id,
        manufacturer, model_number,
        status, priority, created_at, updated_at, closed_at,
        source, title, description, tenant_id
      FROM work_orders
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 500`,
      [tenantId],
    );
    return rows;
  });

  const byStatus = wos.reduce<Record<string, number>>((acc, w) => {
    acc[w.status] = (acc[w.status] ?? 0) + 1;
    return acc;
  }, {});

  // Compute MTTR from real closed_at/created_at timestamps (in hours)
  const completed = wos.filter((w) => w.status === "completed" && w.closed_at);
  let mttr = 0;
  if (completed.length > 0) {
    const durations = completed.map((w) => {
      const created = new Date(w.created_at).getTime();
      const closed = new Date(w.closed_at!).getTime();
      return (closed - created) / (1000 * 60 * 60); // Convert to hours
    });
    mttr = durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  // Count by asset (using manufacturer + model as the asset key)
  const assetFreq: Record<string, { count: number; equipmentId: string | null }> = {};
  for (const w of wos) {
    const assetKey = [w.manufacturer, w.model_number].filter(Boolean).join(" ") || "Unknown";
    if (!assetFreq[assetKey]) {
      assetFreq[assetKey] = { count: 0, equipmentId: w.equipment_id };
    }
    assetFreq[assetKey].count += 1;
  }

  const topAssetEntry = Object.entries(assetFreq).sort((a, b) => b[1].count - a[1].count)[0];
  const topProblemAsset = topAssetEntry ? topAssetEntry[0] : "none";
  const topProblemAssetWOs = topAssetEntry ? topAssetEntry[1].count : 0;

  // Count critical/high priority work orders
  const critical = wos.filter((w) => w.priority === "critical").length;
  const emergency = wos.filter((w) => w.priority === "emergency").length;

  return {
    total: wos.length,
    open: byStatus.open ?? 0,
    inprogress: byStatus.in_progress ?? 0,
    overdue: byStatus.overdue ?? 0,
    completed: byStatus.completed ?? 0,
    scheduled: byStatus.scheduled ?? 0,
    mttrHours: Math.round(mttr * 10) / 10,
    topProblemAsset,
    topProblemAssetWOs,
    criticalWOs: critical,
    emergencyWOs: emergency,
  };
}

export async function POST() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireCapability(ctx, "reports.generate");
  if (denied) return denied;

  const stats = await computeStats(ctx.tenantId);

  let assetCount = 0;
  let criticalAssets = 0;
  if (process.env.NEON_DATABASE_URL) {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE criticality = 'critical') AS crit
         FROM cmms_equipment WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      assetCount = parseInt(rows[0]?.total ?? "0", 10);
      criticalAssets = parseInt(rows[0]?.crit ?? "0", 10);
    } catch {
      // non-fatal — continue with WO stats only
    }
  }

  const prompt = `You are a maintenance intelligence assistant. Write a concise 3-paragraph executive report (under 200 words total) based on these maintenance KPIs. Use plain, professional language. Do not use markdown headers or bullet points — just flowing paragraphs.

CRITICAL INSTRUCTION: Base the report ONLY on the data provided below. Do NOT invent, assume, or reference any asset, work order, or statistic not present in this data. If a field says 'none' or counts are zero, report insufficient activity rather than inventing details.

Work Order Summary:
- Total WOs: ${stats.total} (${stats.open} open, ${stats.inprogress} in progress, ${stats.overdue} overdue, ${stats.completed} completed, ${stats.scheduled} scheduled)
- Critical WOs: ${stats.criticalWOs}, Emergency WOs: ${stats.emergencyWOs}
- Mean Time to Repair (MTTR): ${stats.mttrHours > 0 ? stats.mttrHours + "h" : "no completed work orders"}
- Top problem asset: ${stats.topProblemAsset}${stats.topProblemAssetWOs > 0 ? ` (${stats.topProblemAssetWOs} work orders)` : " (no work orders on record)"}
${assetCount > 0 ? `- Registered assets: ${assetCount} (${criticalAssets} rated critical)` : ""}

Paragraph 1: Overall maintenance health and WO status. Paragraph 2: Key risks or trends (overdue items, critical assets, emergency events). Paragraph 3: One or two recommended actions for the next 7 days.`;

  let narrative: string;
  try {
    narrative = await callLLM(prompt);
  } catch {
    return NextResponse.json({ error: "LLM unavailable — no providers configured or all failed" }, { status: 503 });
  }

  return NextResponse.json({
    narrative,
    stats: { ...stats, assetCount, criticalAssets },
    generatedAt: new Date().toISOString(),
  });
}
