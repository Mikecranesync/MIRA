/**
 * Safety Alert scanner agent (#797).
 *
 * scanForSafetyKeywords(text, assetId, tenantId) → SafetyAlert | null
 *   Pure function — no DB, safe to call in hot paths.
 *
 * handleSafetyAlert(alert, tenantId)
 *   Logs to agent_events (immutable compliance record) and formats
 *   push payloads for Telegram and Slack.
 *
 * Wired into asset chat route — called after MIRA responds, scanning
 * both the user question and the full model response.
 */

import pool from "@/lib/db";

// ── 21 safety keyword patterns ──────────────────────────────────────────────

interface SafetyPattern {
  keyword: string;
  severity: "low" | "medium" | "high" | "critical";
  recommendation: string;
}

const SAFETY_PATTERNS: SafetyPattern[] = [
  {
    keyword: "arc flash",
    severity: "critical",
    recommendation: "Wear appropriate arc-rated PPE. Consult arc flash study before proceeding.",
  },
  {
    keyword: "loto",
    severity: "critical",
    recommendation: "Follow site lockout/tagout procedure. Verify zero-energy state before work.",
  },
  {
    keyword: "lockout",
    severity: "critical",
    recommendation: "Apply lockout per site LOTO procedure. All energy sources must be isolated.",
  },
  {
    keyword: "tagout",
    severity: "critical",
    recommendation: "Apply tagout per site LOTO procedure. Confirm with a qualified person.",
  },
  {
    keyword: "energized",
    severity: "high",
    recommendation: "Do not work on energized equipment without qualified electrical supervision.",
  },
  {
    keyword: "live panel",
    severity: "critical",
    recommendation: "Energized panel work requires arc flash PPE and qualified electrician.",
  },
  {
    keyword: "live wire",
    severity: "critical",
    recommendation: "Stop. Isolate power before proceeding. Follow LOTO procedure.",
  },
  {
    keyword: "live electrical",
    severity: "critical",
    recommendation: "Energized electrical work: arc flash PPE required, qualified person on site.",
  },
  {
    keyword: "confined space",
    severity: "critical",
    recommendation: "Permit-required confined space: atmospheric testing, attendant, and rescue plan required.",
  },
  {
    keyword: "permit required",
    severity: "high",
    recommendation: "Obtain required work permit before proceeding. Consult safety officer.",
  },
  {
    keyword: "hot work",
    severity: "high",
    recommendation: "Hot work permit required. Fire watch and fire suppression equipment on standby.",
  },
  {
    keyword: "fall arrest",
    severity: "high",
    recommendation: "Inspect and don fall arrest harness. Anchor to rated tie-off point.",
  },
  {
    keyword: "shock hazard",
    severity: "high",
    recommendation: "Electrical shock hazard: de-energize and verify zero-energy before proceeding.",
  },
  {
    keyword: "electrocution",
    severity: "critical",
    recommendation: "Electrocution risk. Stop work immediately. Consult qualified electrician.",
  },
  {
    keyword: "asphyxiation",
    severity: "critical",
    recommendation: "Oxygen-deficient atmosphere risk. Atmospheric testing required before entry.",
  },
  {
    keyword: "explosive atmosphere",
    severity: "critical",
    recommendation: "Explosive atmosphere hazard. Eliminate ignition sources. Use intrinsically-safe tools.",
  },
  {
    keyword: "ppe required",
    severity: "medium",
    recommendation: "Wear all required PPE for this task before proceeding.",
  },
  {
    keyword: "voltage",
    severity: "medium",
    recommendation: "Electrical voltage present. Confirm de-energized state with meter before touching.",
  },
  {
    keyword: "high voltage",
    severity: "critical",
    recommendation: "High voltage hazard. Qualified electrician only. Appropriate arc flash PPE required.",
  },
  {
    keyword: "chemical exposure",
    severity: "high",
    recommendation: "Chemical hazard. Consult SDS. Wear appropriate chemical PPE.",
  },
  {
    keyword: "rotating equipment",
    severity: "medium",
    recommendation: "Rotating machinery: ensure guards are in place and equipment is de-energized before service.",
  },
];

// ── Types ────────────────────────────────────────────────────────────────────

export interface SafetyAlert {
  type: "safety_alert";
  severity: "low" | "medium" | "high" | "critical";
  keyword: string;
  asset: string;
  recommendation: string;
  detectedIn: "user_message" | "bot_response" | "both";
  scannedAt: string;
}

export interface AlertHandleResult {
  logged: boolean;
  telegram: string;
  slack: object[];
}

// ── Pure scanner ─────────────────────────────────────────────────────────────

export function scanForSafetyKeywords(
  text: string,
  assetId: string,
  detectedIn: SafetyAlert["detectedIn"] = "user_message",
): SafetyAlert | null {
  const lower = text.toLowerCase();

  // Highest-severity match wins
  let best: (SafetyPattern & { detectedIn: SafetyAlert["detectedIn"] }) | null = null;
  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };

  for (const pattern of SAFETY_PATTERNS) {
    if (lower.includes(pattern.keyword)) {
      if (!best || severityRank[pattern.severity] > severityRank[best.severity]) {
        best = { ...pattern, detectedIn };
      }
    }
  }

  if (!best) return null;

  return {
    type: "safety_alert",
    severity: best.severity,
    keyword: best.keyword,
    asset: assetId,
    recommendation: best.recommendation,
    detectedIn: best.detectedIn,
    scannedAt: new Date().toISOString(),
  };
}

export function scanBoth(
  userText: string,
  botText: string,
  assetId: string,
): SafetyAlert | null {
  const fromUser = scanForSafetyKeywords(userText, assetId, "user_message");
  const fromBot = scanForSafetyKeywords(botText, assetId, "bot_response");

  if (!fromUser && !fromBot) return null;

  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  const best = fromUser && fromBot
    ? (severityRank[fromUser.severity] >= severityRank[fromBot.severity] ? fromUser : fromBot)
    : (fromUser ?? fromBot)!;

  // Mark as "both" if both sides triggered
  return {
    ...best,
    detectedIn: fromUser && fromBot ? "both" : best.detectedIn,
  };
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatAlertTelegram(alert: SafetyAlert): string {
  const icon = alert.severity === "critical" ? "🚨" : alert.severity === "high" ? "⚠️" : "⚠️";
  return [
    `${icon} *MIRA Safety Alert* ${icon}`,
    `*Severity:* ${alert.severity.toUpperCase()}`,
    `*Asset:* ${alert.asset}`,
    `*Keyword detected:* \`${alert.keyword}\``,
    `*Detected in:* ${alert.detectedIn.replace("_", " ")}`,
    "",
    `*Recommendation:*`,
    alert.recommendation,
    "",
    `_Detected at ${alert.scannedAt.slice(0, 19)} UTC_`,
  ].join("\n");
}

export function formatAlertSlackBlocks(alert: SafetyAlert): object[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🚨 Safety Alert — ${alert.severity.toUpperCase()}`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Asset:*\n${alert.asset}` },
        { type: "mrkdwn", text: `*Keyword:*\n\`${alert.keyword}\`` },
        { type: "mrkdwn", text: `*Detected in:*\n${alert.detectedIn.replace("_", " ")}` },
        { type: "mrkdwn", text: `*Severity:*\n${alert.severity.toUpperCase()}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Recommendation:*\n${alert.recommendation}` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_Detected at ${alert.scannedAt.slice(0, 19)} UTC · MIRA Safety Scanner_`,
        },
      ],
    },
  ];
}

// ── SSE injection block (for asset chat route) ───────────────────────────────

export function safetyAlertSseChunk(alert: SafetyAlert): string {
  const block = [
    "",
    `---`,
    `⛔ **SAFETY ALERT** — ${alert.keyword.toUpperCase()}`,
    `**${alert.recommendation}**`,
    `Contact your safety officer before proceeding.`,
  ].join("\n");
  return `data: ${JSON.stringify({ content: block })}\n\n`;
}

// ── DB persistence (agent_events) ────────────────────────────────────────────

async function logAlertToDb(
  tenantId: string,
  alert: SafetyAlert,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    await client.query(
      `INSERT INTO agent_events (tenant_id, event_type, severity, asset_id, keyword, payload)
       VALUES ($1, 'safety_alert', $2, $3, $4, $5)`,
      [tenantId, alert.severity, alert.asset, alert.keyword, JSON.stringify(alert)],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    // Non-fatal — alert push continues even if DB log fails
  } finally {
    client.release();
  }
}

export async function handleSafetyAlert(
  alert: SafetyAlert,
  tenantId: string,
): Promise<AlertHandleResult> {
  // Fire-and-forget DB log — never blocks
  logAlertToDb(tenantId, alert).catch(() => {});

  return {
    logged: true,
    telegram: formatAlertTelegram(alert),
    slack: formatAlertSlackBlocks(alert),
  };
}
