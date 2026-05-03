/**
 * Morning Brief agent (#796).
 *
 * generateMorningBrief(tenantId) — pure data aggregation, no LLM.
 * Designed to be called at 5 AM by a cron/Celery scheduler.
 *
 * Queries:
 *   - Work orders created/closed in the last 12 hours
 *   - PMs due today + overdue PM count
 *   - Safety incidents (WOs with safety_warnings) overnight
 *   - KG entities/relationships added overnight
 */

import { withTenantContext } from "@/lib/tenant-context";

// ── Output types ────────────────────────────────────────────────────────────

export interface OvernightWO {
  id: string;
  title: string;
  status: string;
  priority: string;
  asset: string;
}

export interface PmDueToday {
  id: string;
  task: string;
  asset: string;
  nextDueAt: string;
}

export interface KgUpdateSummary {
  entitiesAdded: number;
  relationshipsAdded: number;
}

export interface MorningBrief {
  tenantId: string;
  generatedAt: string;
  windowHours: number;
  overnightWOs: {
    opened: OvernightWO[];
    closed: OvernightWO[];
  };
  pmsDueToday: PmDueToday[];
  overdueCount: number;
  safetyEvents: OvernightWO[];
  kgUpdates: KgUpdateSummary;
}

// ── Formatters ──────────────────────────────────────────────────────────────

export function formatTelegram(brief: MorningBrief): string {
  const d = brief.generatedAt.slice(0, 10);
  const lines: string[] = [
    `*🌅 MIRA Morning Brief — ${d}*`,
    `_Generated at ${brief.generatedAt.slice(11, 16)} UTC_`,
    "",
  ];

  lines.push(`*📋 Work Orders (last ${brief.windowHours}h)*`);
  if (brief.overnightWOs.opened.length === 0 && brief.overnightWOs.closed.length === 0) {
    lines.push("  No overnight activity.");
  } else {
    if (brief.overnightWOs.opened.length > 0) {
      lines.push(`  Opened: ${brief.overnightWOs.opened.length}`);
      for (const wo of brief.overnightWOs.opened.slice(0, 3)) {
        lines.push(`    • [${wo.priority.toUpperCase()}] ${wo.title} — ${wo.asset}`);
      }
      if (brief.overnightWOs.opened.length > 3) {
        lines.push(`    …and ${brief.overnightWOs.opened.length - 3} more`);
      }
    }
    if (brief.overnightWOs.closed.length > 0) {
      lines.push(`  Closed: ${brief.overnightWOs.closed.length}`);
    }
  }
  lines.push("");

  lines.push(`*📅 PM Schedules*`);
  lines.push(`  Due today: ${brief.pmsDueToday.length}`);
  if (brief.overdueCount > 0) {
    lines.push(`  ⚠️ Overdue: ${brief.overdueCount}`);
  }
  for (const pm of brief.pmsDueToday.slice(0, 3)) {
    lines.push(`    • ${pm.task} — ${pm.asset}`);
  }
  if (brief.pmsDueToday.length > 3) {
    lines.push(`    …and ${brief.pmsDueToday.length - 3} more`);
  }
  lines.push("");

  if (brief.safetyEvents.length > 0) {
    lines.push(`*🚨 Safety Events Overnight: ${brief.safetyEvents.length}*`);
    for (const ev of brief.safetyEvents.slice(0, 3)) {
      lines.push(`  ⛔ ${ev.title} — ${ev.asset}`);
    }
    lines.push("");
  }

  if (brief.kgUpdates.entitiesAdded > 0 || brief.kgUpdates.relationshipsAdded > 0) {
    lines.push(`*🧠 Knowledge Graph*`);
    lines.push(`  +${brief.kgUpdates.entitiesAdded} entities, +${brief.kgUpdates.relationshipsAdded} relationships`);
    lines.push("");
  }

  lines.push(`_Powered by MIRA · FactoryLM_`);
  return lines.join("\n");
}

export function formatSlackBlocks(brief: MorningBrief): object[] {
  const d = brief.generatedAt.slice(0, 10);
  const blocks: object[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🌅 MIRA Morning Brief — ${d}`, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Work Orders (last ${brief.windowHours}h):* ${brief.overnightWOs.opened.length} opened · ${brief.overnightWOs.closed.length} closed`,
      },
    },
  ];

  if (brief.overnightWOs.opened.length > 0) {
    const items = brief.overnightWOs.opened.slice(0, 5)
      .map((wo) => `• \`${wo.priority.toUpperCase()}\` ${wo.title} — ${wo.asset}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: items },
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*PMs Due Today*\n${brief.pmsDueToday.length}` },
      {
        type: "mrkdwn",
        text: `*Overdue PMs*\n${brief.overdueCount > 0 ? `⚠️ ${brief.overdueCount}` : "None"}`,
      },
    ],
  });

  if (brief.safetyEvents.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🚨 Safety Events: ${brief.safetyEvents.length}*\n` +
          brief.safetyEvents.slice(0, 3).map((e) => `⛔ ${e.title} — ${e.asset}`).join("\n"),
      },
    });
  }

  if (brief.kgUpdates.entitiesAdded > 0 || brief.kgUpdates.relationshipsAdded > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🧠 KG Updates:* +${brief.kgUpdates.entitiesAdded} entities · +${brief.kgUpdates.relationshipsAdded} relationships`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `_MIRA · FactoryLM · ${brief.generatedAt} UTC_` }],
  });

  return blocks;
}

// ── Core aggregation ────────────────────────────────────────────────────────

export async function generateMorningBrief(
  tenantId: string,
  windowHours = 12,
): Promise<MorningBrief> {
  const generatedAt = new Date().toISOString();
  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
  const todayEnd = new Date().toISOString().slice(0, 10) + "T23:59:59Z";

  const result = await withTenantContext(tenantId, async (client) => {
    const [openedWOs, closedWOs, pmsDue, overdueRes, safetyRes, kgEntRes, kgRelRes] =
      await Promise.all([
        // WOs created in last N hours
        client.query<{
          id: string; title: string; status: string; priority: string;
          manufacturer: string | null; model_number: string | null;
        }>(
          `SELECT wo.id, wo.title, wo.status, wo.priority,
                  eq.manufacturer, eq.model_number
           FROM work_orders wo
           LEFT JOIN cmms_equipment eq ON eq.id = wo.equipment_id
           WHERE wo.tenant_id = $1 AND wo.created_at >= $2
           ORDER BY wo.created_at DESC
           LIMIT 20`,
          [tenantId, windowStart],
        ),

        // WOs closed in last N hours
        client.query<{
          id: string; title: string; status: string; priority: string;
          manufacturer: string | null; model_number: string | null;
        }>(
          `SELECT wo.id, wo.title, wo.status, wo.priority,
                  eq.manufacturer, eq.model_number
           FROM work_orders wo
           LEFT JOIN cmms_equipment eq ON eq.id = wo.equipment_id
           WHERE wo.tenant_id = $1
             AND wo.status IN ('complete', 'completed', 'COMPLETE', 'COMPLETED')
             AND wo.updated_at >= $2
           ORDER BY wo.updated_at DESC
           LIMIT 20`,
          [tenantId, windowStart],
        ),

        // PMs due today
        client.query<{
          id: string; task: string; next_due_at: string;
          manufacturer: string | null; model_number: string | null;
        }>(
          `SELECT ps.id, ps.task, ps.next_due_at,
                  eq.manufacturer, eq.model_number
           FROM pm_schedules ps
           LEFT JOIN cmms_equipment eq ON eq.id = ps.equipment_id
           WHERE ps.tenant_id = $1
             AND ps.next_due_at >= $2
             AND ps.next_due_at <= $3
           ORDER BY ps.next_due_at`,
          [tenantId, todayStart, todayEnd],
        ),

        // Overdue PM count
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM pm_schedules
           WHERE tenant_id = $1 AND next_due_at < $2`,
          [tenantId, todayStart],
        ),

        // Safety events: WOs with non-empty safety_warnings created overnight
        client.query<{
          id: string; title: string; status: string; priority: string;
          manufacturer: string | null; model_number: string | null;
        }>(
          `SELECT wo.id, wo.title, wo.status, wo.priority,
                  eq.manufacturer, eq.model_number
           FROM work_orders wo
           LEFT JOIN cmms_equipment eq ON eq.id = wo.equipment_id
           WHERE wo.tenant_id = $1
             AND wo.created_at >= $2
             AND array_length(wo.safety_warnings, 1) > 0
           ORDER BY wo.created_at DESC
           LIMIT 10`,
          [tenantId, windowStart],
        ),

        // KG entities added overnight
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM kg_entities
           WHERE tenant_id = $1 AND created_at >= $2`,
          [tenantId, windowStart],
        ),

        // KG relationships added overnight
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM kg_relationships
           WHERE tenant_id = $1 AND created_at >= $2`,
          [tenantId, windowStart],
        ),
      ]);

    function toWO(r: {
      id: string; title: string; status: string; priority: string;
      manufacturer: string | null; model_number: string | null;
    }): OvernightWO {
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        asset: [r.manufacturer, r.model_number].filter(Boolean).join(" ") || "Unknown",
      };
    }

    return {
      overnightWOs: {
        opened: openedWOs.rows.map(toWO),
        closed: closedWOs.rows.map(toWO),
      },
      pmsDueToday: pmsDue.rows.map((r) => ({
        id: r.id,
        task: r.task,
        asset: [r.manufacturer, r.model_number].filter(Boolean).join(" ") || "Unknown",
        nextDueAt: r.next_due_at,
      })),
      overdueCount: parseInt(overdueRes.rows[0]?.count ?? "0", 10),
      safetyEvents: safetyRes.rows.map(toWO),
      kgUpdates: {
        entitiesAdded: parseInt(kgEntRes.rows[0]?.count ?? "0", 10),
        relationshipsAdded: parseInt(kgRelRes.rows[0]?.count ?? "0", 10),
      },
    };
  });

  return {
    tenantId,
    generatedAt,
    windowHours,
    ...result,
  };
}
