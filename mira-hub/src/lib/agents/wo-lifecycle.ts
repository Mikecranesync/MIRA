/**
 * WO Lifecycle agent (#897).
 *
 * checkStaleWorkOrders(tenantId) → StaleWOResult[]
 *   Finds open/in_progress WOs older than 72 hours.
 *   - If all completion fields are present  → candidate for auto-close (caller decides).
 *   - If any field is missing               → flags the WO as "needs_completion"
 *                                            and returns an alert payload for the
 *                                            assigned tech.
 *
 * This function is designed to be called by a cron/Celery task. It does NOT
 * auto-close any work order — it surfaces what needs human attention.
 */

import { withTenantContext } from "@/lib/tenant-context";
import { validateWOCompletion } from "@/lib/wo-completion-validation";

export interface StaleWOResult {
  id: string;
  workOrderNumber: string;
  title: string;
  asset: string;
  assignedTo: string | null;
  ageHours: number;
  canAutoClose: boolean;
  missing_fields: string[];
  flaggedAsNeedsCompletion: boolean;
  telegramAlert: string | null;
}

export async function checkStaleWorkOrders(tenantId: string): Promise<StaleWOResult[]> {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const rows = await withTenantContext(tenantId, (client) =>
    client
      .query<{
        id: string;
        work_order_number: string;
        title: string;
        description: string | null;
        fault_description: string | null;
        resolution: string | null;
        assigned_to: string | null;
        manufacturer: string | null;
        model_number: string | null;
        created_at: string;
      }>(
        `SELECT id, work_order_number, title, description,
                fault_description, resolution, assigned_to,
                manufacturer, model_number, created_at
         FROM work_orders
         WHERE tenant_id = $1
           AND status IN ('open', 'in_progress')
           AND created_at < $2
         ORDER BY created_at ASC`,
        [tenantId, cutoff],
      )
      .then((r) => r.rows),
  );

  const flagUpdates: Promise<void>[] = [];

  const results: StaleWOResult[] = rows.map((r) => {
    const validation = validateWOCompletion({
      title: r.title,
      description: r.description,
      fault_description: r.fault_description,
      resolution: r.resolution,
    });

    const ageHours = Math.floor(
      (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60),
    );
    const asset =
      [r.manufacturer, r.model_number].filter(Boolean).join(" ") || "Unknown asset";

    const needsFlag = !validation.valid;

    if (needsFlag) {
      flagUpdates.push(
        withTenantContext(tenantId, (client) =>
          client
            .query(
              `UPDATE work_orders
               SET status = 'needs_completion', updated_at = NOW()
               WHERE id = $1 AND tenant_id = $2
                 AND status IN ('open', 'in_progress')`,
              [r.id, tenantId],
            )
            .then(() => undefined),
        ),
      );
    }

    const telegramAlert = needsFlag
      ? [
          `⚠️ *Work order needs completion* — ${r.work_order_number}`,
          `*Task:* ${r.title}`,
          `*Asset:* ${asset}`,
          `*Age:* ${ageHours}h`,
          `*Missing fields:* ${validation.missing_fields.join(", ")}`,
          "",
          "Please add the missing details before this WO can be closed.",
          "_MIRA WO Lifecycle · FactoryLM_",
        ].join("\n")
      : null;

    return {
      id: r.id,
      workOrderNumber: r.work_order_number,
      title: r.title,
      asset,
      assignedTo: r.assigned_to,
      ageHours,
      canAutoClose: validation.valid,
      missing_fields: validation.missing_fields,
      flaggedAsNeedsCompletion: needsFlag,
      telegramAlert,
    };
  });

  await Promise.allSettled(flagUpdates);

  return results;
}
