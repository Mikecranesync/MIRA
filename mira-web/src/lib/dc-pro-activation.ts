/**
 * Drive Commander Pro activation — shared between the Stripe success redirect
 * and the Stripe webhook.
 *
 * The success redirect runs synchronously when the buyer lands on the page after
 * checkout; the webhook arrives asynchronously (usually within seconds). Both
 * paths call ensureDCProTenant so that whichever fires first upserts the tenant
 * and whichever fires second is a no-op (idempotent). Neither path calls
 * finalizeActivation / CMMS / Hub provisioning — DC Pro is a separate product
 * with a separate entitlement delivery path (JWT cookie + tier column).
 */

import {
  findTenantByEmail,
  findTenantById,
  createTenant,
  updateTenantStripe,
  updateTenantTier,
} from "./quota.js";
import { recordAuditEvent } from "./audit.js";

export interface DCProSession {
  email: string;
  customerId: string;
  subscriptionId: string;
}

export interface DCProTenant {
  id: string;
  email: string;
  tier: string;
}

/**
 * Find-or-create a DC Pro tenant and guarantee tier=drive_commander_pro.
 *
 * Idempotent: calling this twice for the same email is safe — the second call
 * is a no-op at the DB level (findTenantByEmail → existing row, tier already
 * set, updateTenantStripe is an upsert-equivalent UPDATE).
 *
 * Does NOT call finalizeActivation, Atlas signup, Hub provisioning, or any
 * CMMS path. Those are for the team CMMS product, not DC Pro.
 *
 * Returns the tenant row (possibly freshly created), or null if the email is
 * empty or a DB error prevents creation (caller treats null as "try again on
 * webhook").
 */
export async function ensureDCProTenant(
  verified: DCProSession,
): Promise<DCProTenant | null> {
  if (!verified.email) return null;

  let tenant = await findTenantByEmail(verified.email).catch(() => null);

  if (!tenant) {
    const newId = crypto.randomUUID();
    try {
      await createTenant({
        id: newId,
        email: verified.email,
        company: verified.email.split("@")[1] || "unknown",
        firstName: "",
        tier: "drive_commander_pro",
        atlasPassword: "",
        atlasCompanyId: 0,
        atlasUserId: 0,
      });
      tenant = await findTenantById(newId).catch(() => null);
    } catch {
      return null;
    }
  }

  if (!tenant) return null;

  // updateTenantStripe is idempotent — safe to call every time.
  await updateTenantStripe(tenant.id, verified.customerId, verified.subscriptionId).catch(() => null);

  // Preserve "active" tier (paid CMMS subscriber who also bought DC Pro).
  // Any other tier gets bumped to drive_commander_pro.
  if (tenant.tier !== "active" && tenant.tier !== "drive_commander_pro") {
    await updateTenantTier(tenant.id, "drive_commander_pro").catch(() => null);
    tenant = { ...tenant, tier: "drive_commander_pro" };
  }

  void recordAuditEvent({
    tenantId: tenant.id,
    actorType: "system",
    actorId: "stripe.dc_pro",
    action: "drive_commander_pro.purchased",
    resource: verified.subscriptionId,
    metadata: {
      customer_id: verified.customerId,
      subscription_id: verified.subscriptionId,
    },
  });

  return tenant;
}
