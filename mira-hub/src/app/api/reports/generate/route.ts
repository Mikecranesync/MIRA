import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { sessionOr401 } from "@/lib/session";
import { WORK_ORDERS } from "@/lib/workorders-data";

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

function computeStats() {
  const wos = WORK_ORDERS;
  const byStatus = wos.reduce<Record<string, number>>((acc, w) => {
    acc[w.status] = (acc[w.status] ?? 0) + 1;
    return acc;
  }, {});

  const completed = wos.filter((w) => w.status === "completed");
  const mttr = completed.length
    ? completed.reduce((s, w) => s + w.estimatedH, 0) / completed.length
    : 0;

  const assetFreq: Record<string, number> = {};
  for (const w of wos) assetFreq[w.asset] = (assetFreq[w.asset] ?? 0) + 1;
  const topAsset = Object.entries(assetFreq).sort((a, b) => b[1] - a[1])[0];

  const critical = wos.filter((w) => w.priority === "Critical").length;
  const emergency = wos.filter((w) => w.type === "Emergency").length;

  return {
    total: wos.length,
    open: byStatus.open ?? 0,
    inprogress: byStatus.inprogress ?? 0,
    overdue: byStatus.overdue ?? 0,
    completed: byStatus.completed ?? 0,
    scheduled: byStatus.scheduled ?? 0,
    mttrHours: Math.round(mttr * 10) / 10,
    topProblemAsset: topAsset?.[0] ?? "—",
    topProblemAssetWOs: topAsset?.[1] ?? 0,
    criticalWOs: critical,
    emergencyWOs: emergency,
  };
}

export async function POST() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const stats = computeStats();

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

  const prompt = `You are a maintenance intelligence assistant. Write a concise 3-paragraph executive report (under 200 words total) based on these maintenance KPIs for the past 30 days. Use plain, professional language. Do not use markdown headers or bullet points — just flowing paragraphs.

Work Order Summary:
- Total WOs: ${stats.total} (${stats.open} open, ${stats.inprogress} in progress, ${stats.overdue} overdue, ${stats.completed} completed, ${stats.scheduled} scheduled)
- Critical WOs: ${stats.criticalWOs}, Emergency WOs: ${stats.emergencyWOs}
- Mean Time to Repair (MTTR): ${stats.mttrHours}h
- Top problem asset: ${stats.topProblemAsset} (${stats.topProblemAssetWOs} work orders)
${assetCount > 0 ? `- Registered assets: ${assetCount} (${criticalAssets} rated critical criticality)` : ""}

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
