/**
 * MFA endpoints — TOTP enrollment, activation, disable.
 *
 * Tier 1 #9 of the security roadmap. Free on every tier (Starter $97/mo
 * and Team $497/mo); SSO is the upsell, not MFA.
 *
 * Flow:
 *   1. POST /api/auth/mfa/setup       → generate secret (staged), return
 *                                        otpauth:// URI + recovery codes
 *                                        (codes shown ONCE — caller
 *                                        responsible for displaying).
 *   2. POST /api/auth/mfa/enable      → user submits TOTP code; if it
 *                                        verifies against the staged
 *                                        secret, mfa_enabled = true.
 *   3. POST /api/auth/mfa/disable     → user submits a current TOTP code
 *                                        (re-auth); on success, all MFA
 *                                        state is cleared.
 *   4. GET  /api/auth/mfa/status      → reports whether MFA is enabled
 *                                        for the authed tenant.
 *
 * NOTE — login-flow integration (challenge after magic-link click) lives
 * in server.ts /activated path; this module just provides the primitives.
 * If mfa_enabled = true, the activated handler will pivot to a "needs
 * MFA" page that POSTs to a /api/auth/mfa/login-challenge endpoint —
 * that endpoint is the next follow-up; not in this initial cut.
 *
 * Rate limiting: caller (mira-web) should add a per-tenant rate limit on
 * /enable, /disable, and (when added) /login-challenge — 5 attempts per
 * minute is enough to defeat online brute-force without inconveniencing
 * humans. Not implemented here; tracked as follow-up.
 */
import { Hono } from "hono";
import { requireActive, type MiraTokenPayload } from "../lib/auth.js";
import {
  generateSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  provisioningUri,
  encryptSecret,
  decryptSecret,
  verifyTotp,
  findRecoveryCodeIndex,
} from "../lib/mfa.js";
import {
  getMfaState,
  stageMfaEnrollment,
  activateMfa,
  clearMfa,
  findTenantById,
} from "../lib/quota.js";
import { recordAuditEvent, requestMetadata } from "../lib/audit.js";

export const mfa = new Hono();

mfa.get("/status", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const state = await getMfaState(user.sub);
  return c.json({
    enabled: state.enabled,
    enrolled_at: state.enrolledAt,
    recovery_codes_remaining: state.recoveryCodesHashed.length,
  });
});

mfa.post("/setup", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const tenant = await findTenantById(user.sub);
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  // If MFA is already enabled, refuse to overwrite — they must disable
  // first. Prevents an attacker with a stolen session from rotating the
  // authenticator without the existing TOTP code.
  const existing = await getMfaState(user.sub);
  if (existing.enabled) {
    return c.json(
      { error: "MFA already enabled — disable first to re-enroll" },
      409,
    );
  }

  const secretBase32 = generateSecret();
  const recoveryCodes = generateRecoveryCodes();
  const recoveryHashed = recoveryCodes.map(hashRecoveryCode);

  await stageMfaEnrollment(
    user.sub,
    encryptSecret(secretBase32),
    recoveryHashed,
  );

  const meta = requestMetadata(c);
  void recordAuditEvent({
    tenantId: user.sub,
    action: "auth.mfa.setup_initiated",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return c.json({
    otpauth_uri: provisioningUri(secretBase32, tenant.email),
    secret: secretBase32, // shown once for manual-entry users
    recovery_codes: recoveryCodes, // SHOWN ONCE — caller must persist on user side
  });
});

mfa.post("/enable", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const body = (await c.req.json().catch(() => null)) as
    | { code?: string }
    | null;
  const code = (body?.code ?? "").trim();
  if (!/^\d{6}$/.test(code)) {
    return c.json({ error: "Provide a 6-digit TOTP code" }, 400);
  }

  const state = await getMfaState(user.sub);
  if (state.enabled) {
    return c.json({ error: "MFA already enabled" }, 409);
  }
  if (!state.secretEnc) {
    return c.json({ error: "No staged enrollment — call /setup first" }, 400);
  }

  let secretBase32: string;
  try {
    secretBase32 = decryptSecret(state.secretEnc);
  } catch {
    return c.json({ error: "MFA secret decryption failed" }, 500);
  }

  if (!verifyTotp(secretBase32, code)) {
    const meta = requestMetadata(c);
    void recordAuditEvent({
      tenantId: user.sub,
      action: "auth.mfa.enable_failed",
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { reason: "invalid_code" },
    });
    return c.json({ error: "Invalid TOTP code" }, 401);
  }

  await activateMfa(user.sub);
  const meta = requestMetadata(c);
  void recordAuditEvent({
    tenantId: user.sub,
    action: "auth.mfa.enabled",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return c.json({ ok: true });
});

mfa.post("/disable", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const body = (await c.req.json().catch(() => null)) as
    | { code?: string; recovery_code?: string }
    | null;
  const code = (body?.code ?? "").trim();
  const recovery = (body?.recovery_code ?? "").trim();

  const state = await getMfaState(user.sub);
  if (!state.enabled || !state.secretEnc) {
    return c.json({ error: "MFA is not enabled" }, 409);
  }

  let secretBase32: string;
  try {
    secretBase32 = decryptSecret(state.secretEnc);
  } catch {
    return c.json({ error: "MFA secret decryption failed" }, 500);
  }

  let pass = false;
  if (/^\d{6}$/.test(code) && verifyTotp(secretBase32, code)) {
    pass = true;
  } else if (recovery && state.recoveryCodesHashed.length > 0) {
    const idx = findRecoveryCodeIndex(recovery, state.recoveryCodesHashed);
    if (idx >= 0) pass = true;
  }

  if (!pass) {
    const meta = requestMetadata(c);
    void recordAuditEvent({
      tenantId: user.sub,
      action: "auth.mfa.disable_failed",
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return c.json({ error: "Invalid TOTP or recovery code" }, 401);
  }

  await clearMfa(user.sub);
  const meta = requestMetadata(c);
  void recordAuditEvent({
    tenantId: user.sub,
    action: "auth.mfa.disabled",
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return c.json({ ok: true });
});

export default mfa;
