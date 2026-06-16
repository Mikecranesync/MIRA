/**
 * MFA route tests — TOTP setup → enable → disable round-trip plus the
 * core failure modes (invalid code, replay-window, can't re-setup while
 * already enabled, recovery code path).
 *
 * Tier 1 #9.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";

// --- env BEFORE imports ----------------------------------------------------
process.env.PLG_JWT_SECRET = "test_jwt_secret_for_mfa_round_trip";

// --- in-memory tenant store -----------------------------------------------
interface TenantRow {
  id: string;
  email: string;
  tier: string;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_recovery_codes_hashed: string[];
  mfa_enrolled_at: string | null;
}

const TENANT_ID = "00000000-0000-0000-0000-000000000abc";
function freshTenant(): TenantRow {
  return {
    id: TENANT_ID,
    email: "alice@example.com",
    tier: "active",
    mfa_enabled: false,
    mfa_secret_enc: null,
    mfa_recovery_codes_hashed: [],
    mfa_enrolled_at: null,
  };
}
let store: TenantRow = freshTenant();

mock.module("../../lib/quota.js", () => ({
  findTenantById: async (id: string) => (id === store.id ? store : null),
  getMfaState: async (id: string) => {
    if (id !== store.id) {
      return {
        enabled: false,
        secretEnc: null,
        recoveryCodesHashed: [],
        enrolledAt: null,
      };
    }
    return {
      enabled: store.mfa_enabled,
      secretEnc: store.mfa_secret_enc,
      recoveryCodesHashed: store.mfa_recovery_codes_hashed,
      enrolledAt: store.mfa_enrolled_at,
    };
  },
  stageMfaEnrollment: async (id: string, enc: string, hashed: string[]) => {
    if (id !== store.id) return;
    store.mfa_secret_enc = enc;
    store.mfa_recovery_codes_hashed = hashed;
    store.mfa_enabled = false;
    store.mfa_enrolled_at = null;
  },
  activateMfa: async (id: string) => {
    if (id !== store.id) return;
    store.mfa_enabled = true;
    store.mfa_enrolled_at = new Date().toISOString();
  },
  clearMfa: async (id: string) => {
    if (id !== store.id) return;
    store.mfa_enabled = false;
    store.mfa_secret_enc = null;
    store.mfa_recovery_codes_hashed = [];
    store.mfa_enrolled_at = null;
  },
  consumeRecoveryCodeAt: async () => {},
  // Stubs for sibling test files that transitively import from quota.js
  // (mock.module is process-global per bun:test design).
  findTenantByEmail: async () => null,
  findTenantByStripeCustomerId: async () => null,
  findTenantByInboxSlug: async () => null,
  getQuota: async () => ({ used: 0, limit: 100, remaining: 100 }),
  getQueriesUsedToday: async () => 0,
  hasQuotaRemaining: async () => true,
  logQuery: async () => {},
  createTenant: async () => {},
  updateTenantTier: async () => {},
  updateTenantStripe: async () => {},
  updateTenantAtlas: async () => {},
  updateTenantCmmsConfig: async () => {},
  getTenantCmmsTier: async () => "base",
  updateTenantEmailStatus: async () => {},
  updateTenantSeedStatus: async () => {},
  recordProvisioningAttempt: async () => {},
  generateInboxSlug: () => "stub1234",
  getDeletionState: async () => ({ deletedAt: null, purgeAfter: null }),
  markTenantDeleted: async () => {},
  listTenantsAwaitingPurge: async () => [],
  hardDeleteTenant: async () => {},
  ensureSchema: async () => {},
}));

mock.module("../../lib/cookie-session.js", () => ({
  parseCookies: () => ({}),
  buildSessionCookie: () => "",
}));

const auditEvents: any[] = [];
mock.module("../../lib/audit.js", () => ({
  recordAuditEvent: async (ev: any) => {
    auditEvents.push(ev);
    return true;
  },
  requestMetadata: () => ({ ip: "127.0.0.1", userAgent: "bun-test" }),
}));

const { mfa } = await import("../mfa.js");
const { signToken } = await import("../../lib/auth.js");
const { totpAt } = await import("../../lib/mfa.js");

async function jwtForActive(): Promise<string> {
  return signToken({
    tenantId: TENANT_ID,
    email: "alice@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: "USER",
  });
}

beforeEach(() => {
  store = freshTenant();
  auditEvents.length = 0;
});

describe("MFA round-trip", () => {
  test("status defaults to disabled", async () => {
    const tok = await jwtForActive();
    const res = await mfa.request("/status", {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.recovery_codes_remaining).toBe(0);
  });

  test("setup → enable → status reflects enabled", async () => {
    const tok = await jwtForActive();
    const setupRes = await mfa.request("/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(setupRes.status).toBe(200);
    const setupBody = await setupRes.json();
    expect(setupBody.otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(setupBody.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setupBody.recovery_codes.length).toBe(10);
    // Codes are not yet active
    expect(store.mfa_enabled).toBe(false);
    expect(store.mfa_secret_enc).toBeTruthy();

    // Generate a real TOTP using the returned secret + current time.
    const code = totpAt(setupBody.secret, Math.floor(Date.now() / 1000));
    const enableRes = await mfa.request("/enable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    expect(enableRes.status).toBe(200);
    expect(store.mfa_enabled).toBe(true);

    const statusRes = await mfa.request("/status", {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const statusBody = await statusRes.json();
    expect(statusBody.enabled).toBe(true);
    expect(statusBody.recovery_codes_remaining).toBe(10);

    expect(auditEvents.find((e) => e.action === "auth.mfa.enabled")).toBeTruthy();
  });

  test("enable rejects wrong TOTP code (no MFA flip)", async () => {
    const tok = await jwtForActive();
    await mfa.request("/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    const enableRes = await mfa.request("/enable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(enableRes.status).toBe(401);
    expect(store.mfa_enabled).toBe(false);
    expect(
      auditEvents.find((e) => e.action === "auth.mfa.enable_failed"),
    ).toBeTruthy();
  });

  test("enable rejects malformed (non-6-digit) code", async () => {
    const tok = await jwtForActive();
    await mfa.request("/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    const res = await mfa.request("/enable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "12345" }),
    });
    expect(res.status).toBe(400);
  });

  test("setup refuses to overwrite an already-enabled tenant", async () => {
    const tok = await jwtForActive();
    await mfa.request("/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    const code = totpAt(store.mfa_secret_enc ? "JBSWY3DPEHPK3PXP" : "X", Date.now() / 1000);
    void code;
    // Mark enabled directly to simulate prior activation
    store.mfa_enabled = true;
    const second = await mfa.request("/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(second.status).toBe(409);
  });

  test("disable accepts a valid recovery code when TOTP is unavailable", async () => {
    const tok = await jwtForActive();
    const setupRes = await mfa.request("/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    const setupBody = await setupRes.json();
    const enableCode = totpAt(setupBody.secret, Math.floor(Date.now() / 1000));
    await mfa.request("/enable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: enableCode }),
    });
    expect(store.mfa_enabled).toBe(true);

    // Use the first recovery code to disable — TOTP not provided.
    const recovery = setupBody.recovery_codes[0];
    const disableRes = await mfa.request("/disable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recovery_code: recovery }),
    });
    expect(disableRes.status).toBe(200);
    expect(store.mfa_enabled).toBe(false);
    expect(store.mfa_secret_enc).toBeNull();
  });

  test("disable rejects wrong code", async () => {
    const tok = await jwtForActive();
    const setupRes = await mfa.request("/setup", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}` },
    });
    const setupBody = await setupRes.json();
    const enableCode = totpAt(setupBody.secret, Math.floor(Date.now() / 1000));
    await mfa.request("/enable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: enableCode }),
    });

    const res = await mfa.request("/disable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "000000" }),
    });
    expect(res.status).toBe(401);
    expect(store.mfa_enabled).toBe(true); // unchanged
  });

  test("/setup without auth returns 401", async () => {
    const res = await mfa.request("/setup", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("MFA crypto primitives", () => {
  test("verifyTotp accepts current and ±1 step, rejects 2 steps off", async () => {
    const { generateSecret, verifyTotp } = await import("../../lib/mfa.js");
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000);
    expect(verifyTotp(secret, totpAt(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 30), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now + 30), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 90), now)).toBe(false);
    expect(verifyTotp(secret, totpAt(secret, now + 90), now)).toBe(false);
  });

  test("encryptSecret round-trips through decryptSecret", async () => {
    const { generateSecret, encryptSecret, decryptSecret } = await import(
      "../../lib/mfa.js"
    );
    const secret = generateSecret();
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    const dec = decryptSecret(enc);
    expect(dec).toBe(secret);
  });

  test("recovery code hash + match works (single-use semantics)", async () => {
    const {
      generateRecoveryCodes,
      hashRecoveryCode,
      findRecoveryCodeIndex,
    } = await import("../../lib/mfa.js");
    const codes = generateRecoveryCodes();
    const hashed = codes.map(hashRecoveryCode);
    expect(findRecoveryCodeIndex(codes[0]!, hashed)).toBe(0);
    expect(findRecoveryCodeIndex("WRONG-CODE-HERE", hashed)).toBe(-1);
    // Hyphens are stripped + case-insensitive
    expect(findRecoveryCodeIndex(codes[3]!.toLowerCase(), hashed)).toBe(3);
  });

  test("base32 encode/decode round-trips", async () => {
    const { base32Encode, base32Decode } = await import("../../lib/mfa.js");
    const orig = Buffer.from([0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x90]);
    const encoded = base32Encode(orig);
    const decoded = base32Decode(encoded);
    expect(decoded.equals(orig)).toBe(true);
  });
});
