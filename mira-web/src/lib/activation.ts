/**
 * Three-step post-Stripe activation finalizer.
 *
 * Step A (Atlas CMMS signup) is fatal — if it fails, we don't proceed
 * to seed or email, and the user sees a Retry button on /activated.
 * Step B (demo seed) is non-fatal — the user gets an empty CMMS but
 * still receives their login link.
 * Step C (email) is tracked so support can resend on failure.
 *
 * Idempotent: if atlas_provisioning_status is already 'ok', Step A is
 * skipped. Steps B and C always run (they may have been the ones that
 * failed on the first attempt).
 */
import type { Tenant } from "./quota";

export interface ActivationDeps {
  signupUser: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    company: string,
  ) => Promise<{ companyId: number; userId: number; accessToken: string }>;
  updateTenantAtlas: (
    id: string,
    companyId: number,
    userId: number,
    status: "ok" | "failed",
  ) => Promise<void>;
  seedDemoData: (token: string | undefined, tenantId: string) => Promise<void>;
  updateTenantSeedStatus: (
    id: string,
    status: "pending" | "ok" | "failed",
  ) => Promise<void>;
  signToken: (payload: {
    tenantId: string;
    email: string;
    tier: string;
    atlasCompanyId: number;
    atlasUserId: number;
    atlasRole: "ADMIN" | "USER";
  }) => Promise<string>;
  sendActivatedEmail: (
    email: string,
    firstName: string,
    company: string,
    token: string,
  ) => Promise<boolean>;
  updateTenantEmailStatus: (
    id: string,
    status: "pending" | "sent" | "failed",
  ) => Promise<void>;
  recordProvisioningAttempt: (
    id: string,
    error: string | null,
  ) => Promise<void>;
  deriveAtlasPassword: (id: string) => string;
}

export interface ActivationResult {
  atlas: "ok" | "failed";
  demo: "ok" | "failed" | "pending";
  email: "sent" | "failed" | "pending";
  token: string | null;
}

export async function finalizeActivation(
  tenant: Tenant,
  deps: ActivationDeps,
): Promise<ActivationResult> {
  let atlasCompanyId = tenant.atlas_company_id;
  let atlasUserId = tenant.atlas_user_id;
  let atlasToken = "";
  let atlasStatus: "ok" | "failed" = tenant.atlas_provisioning_status === "ok" ? "ok" : "failed";
  const firstName = tenant.first_name || tenant.email.split("@")[0];

  // Step A: Atlas provisioning — skip if already ok (idempotent retry)
  if (tenant.atlas_provisioning_status !== "ok") {
    try {
      const password = deps.deriveAtlasPassword(tenant.id);
      const company = tenant.company || `${tenant.email.split("@")[0]}'s Plant`;
      const atlas = await deps.signupUser(tenant.email, password, firstName, "", company);
      atlasCompanyId = atlas.companyId;
      atlasUserId = atlas.userId;
      atlasToken = atlas.accessToken;
      try {
        await deps.updateTenantAtlas(tenant.id, atlasCompanyId, atlasUserId, "ok");
        await deps.recordProvisioningAttempt(tenant.id, null);
      } catch (dbErr) {
        console.error("[activation] bookkeeping (atlas-ok) failed:", dbErr);
      }
      atlasStatus = "ok";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await deps.updateTenantAtlas(tenant.id, 0, 0, "failed");
        await deps.recordProvisioningAttempt(tenant.id, msg);
      } catch (dbErr) {
        console.error("[activation] bookkeeping (atlas-failed) failed:", dbErr);
      }
      return { atlas: "failed", demo: "pending", email: "pending", token: null };
    }
  }

  // Step B: Demo seed — non-fatal
  let demoStatus: "ok" | "failed" = "ok";
  try {
    await deps.seedDemoData(atlasToken || undefined, tenant.id);
    await deps.updateTenantSeedStatus(tenant.id, "ok");
  } catch {
    await deps.updateTenantSeedStatus(tenant.id, "failed");
    demoStatus = "failed";
  }

  // Step C: Activation email
  let token: string | null = null;
  let emailStatus: "sent" | "failed" = "failed";
  try {
    token = await deps.signToken({
      tenantId: tenant.id,
      email: tenant.email,
      tier: "active",
      atlasCompanyId,
      atlasUserId,
      atlasRole: "ADMIN",
    });
    const sent = await deps.sendActivatedEmail(tenant.email, firstName, tenant.company, token);
    emailStatus = sent ? "sent" : "failed";
    await deps.updateTenantEmailStatus(tenant.id, emailStatus);
  } catch (err) {
    console.error("[activation] step C (email) failed:", err);
    emailStatus = "failed";
    try {
      await deps.updateTenantEmailStatus(tenant.id, "failed");
    } catch (dbErr) {
      console.error("[activation] bookkeeping (email-failed) failed:", dbErr);
    }
  }

  return { atlas: atlasStatus, demo: demoStatus, email: emailStatus, token };
}
