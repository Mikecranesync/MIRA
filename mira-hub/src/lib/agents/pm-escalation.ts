/**
 * PM Overdue Escalation agent (#798).
 *
 * checkOverduePMs(tenantId) → OverduePM[]
 *   Queries pm_schedules for past-due items and computes escalation level.
 *
 * sendEscalation(overduePM, level)
 *   Formats push payloads (Telegram + Slack) for the appropriate audience.
 *   Deduplication: writes to agent_events; skips if an event for this PM
 *   at this level was already logged within the last 23 hours.
 *
 * runEscalationCheck(tenantId) → EscalationResult
 *   Full cycle: find overdue → deduplicate → format → log → return.
 *   Designed to be called at 8 AM daily by cron/Celery.
 *
 * Escalation chain:
 *   ≥ 1 day overdue  → Level 1: tech reminder
 *   ≥ 3 days overdue → Level 2: supervisor alert
 *   ≥ 7 days overdue → Level 3: manager alert
 */

import pool from "@/lib/db";
import { withTenantContext } from "@/lib/tenant-context";

// ── Types ────────────────────────────────────────────────────────────────────

export type EscalationLevel = 1 | 2 | 3;

export interface OverduePM {
  id: string;
  task: string;
  asset: string;
  equipmentId: string | null;
  nextDueAt: string;
  daysOverdue: number;
  escalationLevel: EscalationLevel;
}

export interface EscalationNotification {
  pm: OverduePM;
  level: EscalationLevel;
  audience: "technician" | "supervisor" | "manager";
  telegram: string;
  slack: object[];
  alreadySent: boolean;
}

export interface EscalationResult {
  tenantId: string;
  checkedAt: string;
  overduePMs: OverduePM[];
  notifications: EscalationNotification[];
  skippedDuplicates: number;
}

// ── Escalation level helpers ─────────────────────────────────────────────────

export function escalationLevel(daysOverdue: number): EscalationLevel {
  if (daysOverdue >= 7) return 3;
  if (daysOverdue >= 3) return 2;
  return 1;
}

export function escalationAudience(level: EscalationLevel): "technician" | "supervisor" | "manager" {
  if (level === 3) return "manager";
  if (level === 2) return "supervisor";
  return "technician";
}

// ── Formatters ───────────────────────────────────────────────────────────────

export function formatEscalationTelegram(pm: OverduePM, level: EscalationLevel): string {
  const icon = level === 3 ? "🚨" : level === 2 ? "⚠️" : "🔔";
  const audience = escalationAudience(level);
  const label = level === 3 ? "MANAGER ALERT" : level === 2 ? "SUPERVISOR ALERT" : "REMINDER";

  return [
    `${icon} *PM Overdue — ${label}* ${icon}`,
    `*Task:* ${pm.task}`,
    `*Asset:* ${pm.asset}`,
    `*Due date:* ${pm.nextDueAt.slice(0, 10)}`,
    `*Days overdue:* ${pm.daysOverdue}`,
    `*Escalation level:* ${level}/3 → ${audience}`,
    "",
    level === 3
      ? "⛔ This PM is critically overdue. Immediate manager review required."
      : level === 2
      ? "⚠️ This PM requires supervisor attention. Schedule within 24 hours."
      : "🔔 Friendly reminder: this PM is past due. Please schedule soon.",
    "",
    `_MIRA PM Escalation · FactoryLM_`,
  ].join("\n");
}

export function formatEscalationSlackBlocks(pm: OverduePM, level: EscalationLevel): object[] {
  const audience = escalationAudience(level);
  const levelLabel = level === 3 ? "🚨 MANAGER" : level === 2 ? "⚠️ SUPERVISOR" : "🔔 TECH";

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `PM Overdue — Level ${level}/3 (${levelLabel})`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Task:*\n${pm.task}` },
        { type: "mrkdwn", text: `*Asset:*\n${pm.asset}` },
        { type: "mrkdwn", text: `*Due:*\n${pm.nextDueAt.slice(0, 10)}` },
        { type: "mrkdwn", text: `*Days Overdue:*\n${pm.daysOverdue}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: level === 3
          ? "⛔ *Critical:* Immediate manager review required."
          : level === 2
          ? "⚠️ *Attention:* Supervisor should schedule within 24 hours."
          : "🔔 *Reminder:* PM is past due — please schedule soon.",
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `_Routed to: ${audience} · MIRA PM Escalation · FactoryLM_` },
      ],
    },
  ];
}

// ── Deduplication via agent_events ───────────────────────────────────────────

async function wasRecentlySent(
  tenantId: string,
  pmId: string,
  level: EscalationLevel,
  withinHours = 23,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);

    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM agent_events
       WHERE tenant_id = $1
         AND event_type = 'pm_escalation'
         AND asset_id = $2
         AND payload->>'escalationLevel' = $3
         AND created_at >= NOW() - INTERVAL '1 hour' * $4`,
      [tenantId, pmId, String(level), withinHours],
    );
    await client.query("COMMIT");
    return parseInt(rows[0]?.count ?? "0", 10) > 0;
  } catch {
    await client.query("ROLLBACK");
    return false; // fail-open: send if we can't check
  } finally {
    client.release();
  }
}

async function logEscalation(
  tenantId: string,
  pm: OverduePM,
  level: EscalationLevel,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE factorylm_app");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    await client.query(
      `INSERT INTO agent_events (tenant_id, event_type, severity, asset_id, keyword, payload)
       VALUES ($1, 'pm_escalation', $2, $3, $4, $5)`,
      [
        tenantId,
        level === 3 ? "critical" : level === 2 ? "high" : "medium",
        pm.id,
        `level_${level}`,
        JSON.stringify({ ...pm, escalationLevel: level }),
      ],
    );
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
}

// ── Main entry points ────────────────────────────────────────────────────────

export async function checkOverduePMs(tenantId: string): Promise<OverduePM[]> {
  const now = new Date().toISOString();

  const rows = await withTenantContext(tenantId, (client) =>
    client.query<{
      id: string;
      task: string;
      next_due_at: string;
      equipment_id: string | null;
      manufacturer: string | null;
      model_number: string | null;
    }>(
      `SELECT ps.id, ps.task, ps.next_due_at, ps.equipment_id,
              eq.manufacturer, eq.model_number
       FROM pm_schedules ps
       LEFT JOIN cmms_equipment eq ON eq.id = ps.equipment_id
       WHERE ps.tenant_id = $1
         AND ps.next_due_at < $2
         AND (ps.last_completed_at IS NULL
              OR ps.last_completed_at < ps.next_due_at)
       ORDER BY ps.next_due_at`,
      [tenantId, now],
    ).then((r) => r.rows),
  );

  return rows.map((r) => {
    const dueMs = new Date(r.next_due_at).getTime();
    const daysOverdue = Math.floor((Date.now() - dueMs) / (1000 * 60 * 60 * 24));
    const level = escalationLevel(daysOverdue);
    return {
      id: r.id,
      task: r.task,
      asset: [r.manufacturer, r.model_number].filter(Boolean).join(" ") || "Unknown",
      equipmentId: r.equipment_id,
      nextDueAt: r.next_due_at,
      daysOverdue,
      escalationLevel: level,
    };
  });
}

export async function sendEscalation(
  pm: OverduePM,
  level: EscalationLevel,
  tenantId: string,
): Promise<EscalationNotification> {
  const alreadySent = await wasRecentlySent(tenantId, pm.id, level);

  if (!alreadySent) {
    logEscalation(tenantId, pm, level).catch(() => {});
  }

  return {
    pm,
    level,
    audience: escalationAudience(level),
    telegram: formatEscalationTelegram(pm, level),
    slack: formatEscalationSlackBlocks(pm, level),
    alreadySent,
  };
}

export async function runEscalationCheck(tenantId: string): Promise<EscalationResult> {
  const checkedAt = new Date().toISOString();
  const overduePMs = await checkOverduePMs(tenantId);

  const notifications: EscalationNotification[] = [];
  let skippedDuplicates = 0;

  for (const pm of overduePMs) {
    const notif = await sendEscalation(pm, pm.escalationLevel, tenantId);
    if (notif.alreadySent) {
      skippedDuplicates++;
    } else {
      notifications.push(notif);
    }
  }

  return { tenantId, checkedAt, overduePMs, notifications, skippedDuplicates };
}
