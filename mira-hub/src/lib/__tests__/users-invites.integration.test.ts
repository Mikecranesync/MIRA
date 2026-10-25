// #4370 — real-Postgres proof for the magic-token TTL change (parent-provided
// disposable instance; see TASK-2026-10-16-pilot-crew-login.md "PRIMARY
// INSPECTION follow-up"). The mocked-pool suite in users-invites.test.ts
// proves the SQL/params shape; this suite proves the actual Postgres
// `NOW() + interval` and `used_at IS NULL` semantics against real rows —
// no mock can substitute for the database's own clock comparison.
//
// Two different things need proving, and they must NOT be conflated:
//   (a) createMagicToken() writes the CORRECT interval in the first place
//       (read back the real expires_at it wrote — no backdating here, or
//       the test would pass even if the TTL branch were deleted entirely).
//   (b) validateMagicToken()'s `WHERE expires_at > NOW()` boundary and its
//       `used_at IS NULL` replay guard behave correctly at the boundary —
//       tested by controlled backdating (the same technique
//       duplicate-upload-owner.integration.test.ts uses via `ageSeconds`),
//       which is legitimate for this half because it isn't the thing being
//       proven in (a).
//
// Requires (local/disposable only — never staging/prod):
//   TEST_DATABASE_URL      postgres
//   MIRA_TEST_DB_CONFIRM   DISPOSABLE
// Run: npx vitest run --config vitest.integration.config.ts src/lib/__tests__/users-invites.integration.test.ts

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");

const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});

vi.mock("@/lib/db", () => ({ default: testPool }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import { createMagicToken, ensureSchema, validateMagicToken } from "../users";
import { INVITE_MAGIC_LINK_TTL_MINUTES } from "@/lib/config";

const TENANT = randomUUID();
const INVITED_EMAIL = `invited-${randomUUID()}@example.com`;
const ORDINARY_EMAIL = `owner-${randomUUID()}@example.com`;

async function minutesUntilExpiry(token: string): Promise<number> {
  const { rows } = await testPool.query<{ minutes: string }>(
    `SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) / 60 AS minutes
     FROM hub_magic_tokens WHERE token = $1`,
    [token],
  );
  return Number(rows[0].minutes);
}

/** Rewrites a token's `expires_at` directly — the only way to exercise
 *  Postgres's real `NOW() + interval` boundary deterministically without
 *  sleeping the test runner for 15/24 real hours. Used ONLY for part (b)
 *  above (validateMagicToken's query logic), never to fake part (a). */
async function backdateExpiry(token: string, remaining: string): Promise<void> {
  await testPool.query(
    `UPDATE hub_magic_tokens SET expires_at = NOW() + $2::interval WHERE token = $1`,
    [token, remaining],
  );
}

describe.skipIf(!READY)("magic token TTL against real Postgres (#4370)", () => {
  beforeAll(async () => {
    await ensureSchema();
  });

  afterAll(async () => {
    await testPool.query(
      `DELETE FROM hub_magic_tokens WHERE tenant_id = $1 OR email = LOWER($2) OR email = LOWER($3)`,
      [TENANT, ORDINARY_EMAIL, `expired-${ORDINARY_EMAIL}`],
    );
    await testPool.query(`DELETE FROM hub_users WHERE tenant_id = $1`, [TENANT]);
    await testPool.end();
  });

  // Part (a): createMagicToken itself writes the right interval. No
  // backdating — this reads back exactly what the function under test wrote.
  it("createMagicToken writes the invite TTL for an invitation (tenantId set), ~15m for an ordinary link", async () => {
    const inviteToken = await createMagicToken(INVITED_EMAIL, {
      tenantId: TENANT,
      role: "technician",
      invitedBy: "user-admin",
    });
    const ordinaryToken = await createMagicToken(ORDINARY_EMAIL);

    const inviteMinutes = await minutesUntilExpiry(inviteToken);
    const ordinaryMinutes = await minutesUntilExpiry(ordinaryToken);

    // #4664 owns the length via INVITE_MAGIC_LINK_TTL_MINUTES (the pilot window).
    expect(inviteMinutes).toBeGreaterThan(INVITE_MAGIC_LINK_TTL_MINUTES - 2);
    expect(inviteMinutes).toBeLessThan(INVITE_MAGIC_LINK_TTL_MINUTES + 2);
    expect(ordinaryMinutes).toBeGreaterThan(15 - 2);
    expect(ordinaryMinutes).toBeLessThan(15 + 2);
  });

  // Part (b): validateMagicToken's real `WHERE expires_at > NOW()` boundary,
  // exercised via controlled backdating.
  it("an invitation token is still valid 16 minutes in — past the old 15-minute boundary", async () => {
    const token = await createMagicToken(`past15-${INVITED_EMAIL}`, {
      tenantId: TENANT,
      role: "technician",
      invitedBy: "user-admin",
    });
    // Leave ~23h44m of real validity — a token a tech opens later in the
    // shift. Absolute remaining time, so it holds for any invite TTL that
    // exceeds it (INVITE_MAGIC_LINK_TTL_MINUTES is the pilot window, #4664).
    await backdateExpiry(token, "23 hours 44 minutes");

    await expect(validateMagicToken(token)).resolves.toMatchObject({
      email: `past15-${INVITED_EMAIL}`.toLowerCase(),
      tenantId: TENANT,
    });
  });

  it("an invitation token is expired once past its expiry boundary", async () => {
    const token = await createMagicToken(`expired-${INVITED_EMAIL}`, {
      tenantId: TENANT,
      role: "technician",
      invitedBy: "user-admin",
    });
    // One minute PAST expiry, whatever the invite TTL is.
    await backdateExpiry(token, "-1 minute");

    await expect(validateMagicToken(token)).resolves.toBeNull();
  });

  it("an ordinary sign-in link (no tenantId) still expires at 15 minutes", async () => {
    const token = await createMagicToken(`expired-${ORDINARY_EMAIL}`);
    // Simulate 16 minutes elapsed on a 15-min-TTL token — one minute PAST
    // expiry, proving the ordinary flow was NOT widened by this change.
    await backdateExpiry(token, "-1 minute");

    await expect(validateMagicToken(token)).resolves.toBeNull();
  });

  it("a consumed token cannot replay — the second validate of the SAME token fails for real", async () => {
    const token = await createMagicToken(`replay-${INVITED_EMAIL}`, {
      tenantId: TENANT,
      role: "technician",
      invitedBy: "user-admin",
    });

    const first = await validateMagicToken(token);
    expect(first).toMatchObject({ tenantId: TENANT });

    const second = await validateMagicToken(token);
    expect(second).toBeNull();
  });
});
