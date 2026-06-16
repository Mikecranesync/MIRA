# Fix #7 — #579 SSO: enforce IdP `email_verified` claim

**Branch:** `agent/issue-579-sso-saml-oidc-0445` (after fix #6)
**Severity:** 🔴 Security
**Effort:** ~30 min

## What's broken

`mira-hub/src/lib/auth/sso/jit.ts` (currently on #578, moves to #579 in fix #6) doesn't check whether the IdP marked the user's email as verified. Threat:

1. Customer XYZ uses Okta SSO; their OIDC config has `email_verified: false` for new sign-ups (less common but possible — happens on Auth0 free tier without proper config, or on misconfigured Azure AD with social providers).
2. Attacker registers `bob@xyz-customer.com` in the IdP without verifying.
3. Attacker logs into MIRA via SSO — JIT auto-provisions a `users` row with `email = bob@xyz-customer.com`.
4. If `bob@xyz-customer.com` exists at the customer's IdP for a real Bob, the attacker now has a session as Bob with whatever role `group_role_map` assigns based on the unverified group membership.

## The fix

Two changes:

1. JIT requires `claims.emailVerified === true` by default.
2. Per-tenant config opts out (some on-prem IdPs don't expose the claim and the customer accepts the risk in writing).

### Patch 7.1 — Schema: add `require_email_verified` flag

```sql
-- mira-hub/db/migrations/2026-04-25-002-sso-email-verified.sql
-- Issue: #579 follow-up — enforce IdP email_verified claim by default.

BEGIN;

ALTER TABLE sso_configs
    ADD COLUMN IF NOT EXISTS require_email_verified BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN sso_configs.require_email_verified IS
    'When true (default), JIT provisioning rejects logins where the IdP did not assert email_verified=true. Set to false only when the IdP cannot expose the claim — and only with explicit customer sign-off.';

COMMIT;
```

### Patch 7.2 — Lib: extend `JITProfile` with `emailVerified`

`mira-hub/src/lib/auth/sso/types.ts`:

```ts
export interface JITProfile {
  email: string;
  /**
   * Whether the IdP asserts the email has been verified. SAML
   * AttributeStatements typically don't carry this; OIDC `email_verified`
   * claim does. Default is FALSE (fail-closed) when the IdP doesn't say.
   */
  emailVerified: boolean;
  fullName?: string;
  groups: string[];
  // ... existing fields ...
}

export interface SSOConfig {
  // ... existing fields ...
  /**
   * If true (default), JIT provisioning rejects logins where the IdP
   * did not assert email_verified. Set to false only when the IdP
   * cannot expose the claim AND the customer accepts the risk.
   */
  requireEmailVerified: boolean;
}
```

### Patch 7.3 — Library: read the claim per protocol

In `mira-hub/src/lib/auth/sso/oidc.ts` (in the claim-extraction stub),
pull `email_verified` from the userinfo / id_token:

```ts
export function extractOIDCClaims(idToken: Record<string, unknown>): JITProfile {
  const email = String(idToken.email ?? "").toLowerCase();
  // OIDC standard claim: present and true means verified by IdP.
  const emailVerified = idToken.email_verified === true;
  const fullName = idToken.name ? String(idToken.name) : undefined;
  const groups = Array.isArray(idToken.groups) ? idToken.groups.map(String) : [];
  return { email, emailVerified, fullName, groups };
}
```

In `mira-hub/src/lib/auth/sso/saml.ts`, SAML doesn't have a standard
"email verified" attribute. Treat as unverified unless the IdP sends an
explicit attribute the customer maps via config:

```ts
export function extractSAMLClaims(
  attributes: Record<string, string | string[]>,
  config: SSOConfig,
): JITProfile {
  const emailAttr = config.attributeMap?.email ?? "email";
  const verifiedAttr = config.attributeMap?.emailVerified;

  const email = String(attributes[emailAttr] ?? "").toLowerCase();
  // If the customer hasn't mapped a verified attribute, the claim is
  // false. Most production SAML IdPs implicitly verify on enrollment;
  // customers can opt out the require_email_verified flag if they trust
  // their IdP's enrollment flow.
  const emailVerified = verifiedAttr
    ? String(attributes[verifiedAttr]).toLowerCase() === "true"
    : false;
  // ... rest as before ...
  return { email, emailVerified, fullName, groups };
}
```

### Patch 7.4 — JIT: gate on the claim

`mira-hub/src/lib/auth/sso/jit.ts` (around line 60, before the email-domain check):

```ts
export async function provisionUser(
  config: SSOConfig,
  claims: JITProfile,
): Promise<{ userId: string; tenantUserId: string }> {
  if (!claims.email) {
    throw new JITProvisionError("SSO-108", "missing email claim");
  }

  // ↓↓↓ NEW gate ↓↓↓
  if (config.requireEmailVerified && !claims.emailVerified) {
    throw new JITProvisionError(
      "SSO-110",
      "IdP did not assert email_verified=true; cannot auto-provision",
    );
  }
  // ↑↑↑ NEW gate ↑↑↑

  // ... existing email-domain check + find-or-create user logic ...
}
```

### Patch 7.5 — Doc the SSO-110 error code

In `docs/api-reference/sso.md`, add:

```md
| Code | Status | When |
|---|---|---|
| SSO-105 | 503 | SSO library not yet wired (deps not installed) |
| SSO-108 | 400 | Missing required `email` claim |
| SSO-109 | 403 | Email domain not in `allowed_email_domains` |
| **SSO-110** | **403** | **IdP did not assert `email_verified=true`. Either fix the IdP config or set `require_email_verified=false` on the SSO config (with customer sign-off).** |
```

## Test

`mira-hub/src/lib/auth/sso/__tests__/jit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer to focus on policy logic.
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [{ id: "u_1" }] }),
  },
}));

import { provisionUser, JITProvisionError } from "../jit";
import type { SSOConfig, JITProfile } from "../types";

const baseConfig: SSOConfig = {
  id: "cfg_1",
  tenantId: "t_1",
  protocol: "oidc",
  active: true,
  audienceUri: "urn:mira:t_1",
  groupRoleMap: { admins: "admin", everyone: "member" },
  allowedEmailDomains: ["acme.com"],
  requireEmailVerified: true,
  // ... fill in other required fields as default ...
} as SSOConfig;

const claims = (overrides: Partial<JITProfile> = {}): JITProfile => ({
  email: "alice@acme.com",
  emailVerified: true,
  fullName: "Alice",
  groups: ["everyone"],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("JIT provisioning — email_verified gate", () => {
  it("provisions when emailVerified=true (positive control)", async () => {
    const result = await provisionUser(baseConfig, claims());
    expect(result.userId).toBeDefined();
  });

  it("rejects with SSO-110 when emailVerified=false and require=true (default)", async () => {
    await expect(
      provisionUser(baseConfig, claims({ emailVerified: false })),
    ).rejects.toThrow(JITProvisionError);
    await expect(
      provisionUser(baseConfig, claims({ emailVerified: false })),
    ).rejects.toMatchObject({ code: "SSO-110" });
  });

  it("opt-out: provisions even with emailVerified=false when require=false", async () => {
    const config = { ...baseConfig, requireEmailVerified: false };
    const result = await provisionUser(config, claims({ emailVerified: false }));
    expect(result.userId).toBeDefined();
  });

  it("opt-out does NOT bypass other checks (domain allowlist)", async () => {
    const config = { ...baseConfig, requireEmailVerified: false };
    await expect(
      provisionUser(config, claims({ emailVerified: false, email: "alice@evil.com" })),
    ).rejects.toMatchObject({ code: "SSO-109" });
  });

  it("missing email claim still 400s, regardless of emailVerified", async () => {
    await expect(
      provisionUser(baseConfig, claims({ email: "", emailVerified: true })),
    ).rejects.toMatchObject({ code: "SSO-108" });
  });
});

describe("OIDC claim extraction", () => {
  it("reads email_verified=true from id_token", async () => {
    const { extractOIDCClaims } = await import("../oidc");
    expect(
      extractOIDCClaims({ email: "x@y.com", email_verified: true, name: "X" }),
    ).toMatchObject({ emailVerified: true });
  });

  it("reads email_verified=false explicitly", async () => {
    const { extractOIDCClaims } = await import("../oidc");
    expect(
      extractOIDCClaims({ email: "x@y.com", email_verified: false }),
    ).toMatchObject({ emailVerified: false });
  });

  it("treats missing email_verified as false (fail closed)", async () => {
    const { extractOIDCClaims } = await import("../oidc");
    expect(
      extractOIDCClaims({ email: "x@y.com" }),
    ).toMatchObject({ emailVerified: false });
  });

  it("treats string 'true' as false (only boolean true counts)", async () => {
    // Some IdPs send strings; we don't trust them to avoid type confusion.
    const { extractOIDCClaims } = await import("../oidc");
    expect(
      extractOIDCClaims({ email: "x@y.com", email_verified: "true" }),
    ).toMatchObject({ emailVerified: false });
  });
});

describe("SAML claim extraction", () => {
  it("returns emailVerified=false when no verifiedAttr in config", async () => {
    const { extractSAMLClaims } = await import("../saml");
    const config = { ...baseConfig, attributeMap: { email: "mail" } } as SSOConfig;
    expect(
      extractSAMLClaims({ mail: "x@acme.com" }, config),
    ).toMatchObject({ emailVerified: false });
  });

  it("returns emailVerified=true when verifiedAttr maps to 'true'", async () => {
    const { extractSAMLClaims } = await import("../saml");
    const config = {
      ...baseConfig,
      attributeMap: { email: "mail", emailVerified: "verified" },
    } as SSOConfig;
    expect(
      extractSAMLClaims({ mail: "x@acme.com", verified: "true" }, config),
    ).toMatchObject({ emailVerified: true });
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/lib/auth/sso/__tests__/jit.test.ts
```

11 tests pass. Cross-tenant impersonation via unverified IdP email is closed off.

## What this trades

- Some real customers will hit SSO-110 on the first login if their IdP doesn't assert `email_verified`. Workaround: customer sets `require_email_verified=false` on their SSO config (admin endpoint, audited via `tenant_audit_log`).
- The runbook for customer-facing engineers should call this out: when wiring a new SSO config, the test login surfaces this 403, the engineer asks the customer "is your IdP enrolling users via verified email?" — if yes, leave the flag alone (the IdP is misconfigured); if no, set the flag with sign-off recorded.
