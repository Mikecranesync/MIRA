/** Actual register handler + actual PostgreSQL; synthetic local database only. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import { authOptions } from "@/auth";
import bcrypt from "bcryptjs";
import { createMagicToken, ensureInvitedUser, setUserPreferences } from "@/lib/users";
import { credentialsAreCurrent } from "@/capabilities/verified-identity";
import { assertTeamInvitesAllowed } from "@/capabilities/free-workspace";
import { refreshEntitlementClaims } from "@/capabilities/session-entitlement";

const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");
const { testPool } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool: PgPool } = require("pg");
  return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool };
});
vi.mock("@/lib/db", () => ({ default: testPool }));
// The pipeline's unrelated tables are outside this disposable auth fixture.
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import { ensureSchema, ensureUserAndTenant, findUserByEmail } from "@/lib/users";
import { POST } from "@/app/api/auth/register/route";
import { publicSignupPolicy } from "@/capabilities/free-technician-signup";
import { PILOT_WINDOW_DAYS, PILOT_SEAT_MAX_USERS } from "@/lib/config";

type TestProvider = { id?: string; options?: { id?: string; authorize: (values: Record<string, string>, request: unknown) => Promise<{ id: string; tenantId?: string; status?: string; credentialEpoch?: number } | null> } };
function provider(id: string) {
  const found = authOptions.providers.find(value => ((value as TestProvider).options?.id ?? value.id) === id) as TestProvider;
  if (!found?.options?.authorize) throw new Error("Missing real credentials provider: " + id);
  return found.options.authorize;
}
async function verifiedAccount(address: string) {
  const token = await createMagicToken(address);
  const result = await provider("magic-token")({ token }, {});
  if (!result) throw new Error("Actual email-token authorization failed");
  return { id: result.id, tenantId: result.tenantId!, email: address };
}

function email() { return `tech-${randomUUID()}@example.test`; }
function request(address: string) {
  return new Request("https://app.factorylm.com/api/auth/register/", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": randomUUID() },
    body: JSON.stringify({ email: address, password: "local-test-password", name: "Synthetic technician" }),
  });
}

describe.skipIf(!READY)("free-technician registration against PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(process.env.TEST_DATABASE_URL!);
    if (target.hostname !== "127.0.0.1" || !target.pathname.startsWith("/factorylm_free_signup_test")) {
      throw new Error("This suite requires its own disposable loopback database");
    }
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
    vi.stubEnv("NEON_DATABASE_URL", process.env.TEST_DATABASE_URL!);
    vi.stubEnv("HUBSPOT_API_KEY", "");
    await testPool.query("CREATE TABLE IF NOT EXISTS tenants (id uuid PRIMARY KEY, name text NOT NULL, contact_email text NOT NULL)");
    await ensureSchema();
    await testPool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app') THEN CREATE ROLE factorylm_app; END IF; END $$");
    for (const name of ["107_pilot_access.sql", "108_pilot_applications.sql"]) await testPool.query(readFileSync("db/migrations/" + name, "utf8"));
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("PLG_POSTHOG_KEY", "");
  });
  beforeEach(() => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
  });
  afterAll(async () => { vi.unstubAllEnvs(); await testPool.end(); });

  it("requires actual email-token proof before creating an approved free workspace", async () => {
    const address = email();
    expect((await POST(request(address))).status).toBe(403);
    expect(await findUserByEmail(address)).toBeNull();
    await expect(ensureUserAndTenant({ email: address, passwordHash: "unverified" })).rejects.toThrow("Verify your email");
    const account = await verifiedAccount(address);
    const user = await findUserByEmail(address);
    expect(user).toMatchObject({ id: account.id, tenantId: account.tenantId, status: "approved", plan: "technician_free", trialExpiresAt: null, role: "owner", passwordHash: null });
    const { rows } = await testPool.query("SELECT id FROM tenants WHERE id = $1", [account.tenantId]);
    expect(rows).toHaveLength(1);
  });

  it("does not gain a trial deadline when its creation is older than the pilot window", async () => {
    const address = email();
    const created = await ensureUserAndTenant({ email: address, verifiedEmail: true });
    await testPool.query("UPDATE hub_users SET created_at = NOW() - INTERVAL '90 days' WHERE id = $1", [created.id]);
    await ensureUserAndTenant({ email: address, verifiedEmail: true });
    const user = await findUserByEmail(address);
    expect(user).toMatchObject({ status: "approved", trialExpiresAt: null, plan: "technician_free" });
  });

  it("keeps an existing free account free when signup rollout is disabled", async () => {
    const address = email();
    const first = await ensureUserAndTenant({ email: address, verifiedEmail: true });
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
    expect(await ensureUserAndTenant({ email: address })).toEqual(first);
    expect(await findUserByEmail(address)).toMatchObject({ status: "approved", trialExpiresAt: null, plan: "technician_free" });
  });

  it("preserves the old trial clock when free signup is not enabled", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
    const created = await ensureUserAndTenant({ email: email() });
    const { rows } = await testPool.query("SELECT status, plan, EXTRACT(EPOCH FROM (trial_expires_at - NOW())) / 86400 AS days FROM hub_users WHERE id=$1", [created.id]);
    expect(rows[0].status).toBe("trial");
    expect(rows[0].plan).toBeNull();
    expect(Number(rows[0].days)).toBeGreaterThan(PILOT_WINDOW_DAYS - 0.01);
    expect(Number(rows[0].days)).toBeLessThanOrEqual(PILOT_WINDOW_DAYS);
  });

  it("keeps an explicit plant pilot approval-required", async () => {
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1");
    const address = email();
    const created = await ensureUserAndTenant({ email: address, signupIntent: "pilot" });
    expect(await findUserByEmail(address)).toMatchObject({ status: "pending", trialExpiresAt: null, plan: null });
    const { rows } = await testPool.query("SELECT pilot_status FROM hub_tenants WHERE id = $1", [created.tenantId]);
    expect(rows[0].pilot_status).toBe("pending");
    expect(publicSignupPolicy("pilot").requiresApproval).toBe(true);
  });

  it("opens a free personal workspace without disabling or joining the existing pilot cohort", async () => {
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1");
    const address = email();
    const created = await ensureUserAndTenant({ email: address, verifiedEmail: true });
    expect(await findUserByEmail(address)).toMatchObject({ status: "approved", trialExpiresAt: null, plan: "technician_free" });
    const { rows } = await testPool.query("SELECT pilot_status FROM hub_tenants WHERE id = $1", [created.tenantId]);
    expect(rows[0].pilot_status).toBeNull();
    expect(publicSignupPolicy().kind).toBe("free_technician");
  });

  it("repeated verified email sign-in retains one workspace", async () => {
    const address = email();
    const first = await verifiedAccount(address);
    expect(await verifiedAccount(address)).toEqual(first);
    const { rows } = await testPool.query("SELECT COUNT(*) AS n FROM hub_users WHERE email_lower = lower($1)", [address]);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("retains pilot intent through real registration and records one application", async () => {
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1");
    const address = email();
    const response = await POST(new Request("https://app.factorylm.com/api/auth/register/", { method: "POST", headers: {"Content-Type":"application/json", "x-forwarded-for":randomUUID()}, body: JSON.stringify({email:address,password:"local-pilot-password",signupIntent:"pilot"}) }));
    expect(response.status).toBe(201);
    const user = await findUserByEmail(address);
    expect(user).toMatchObject({status:"pending",plan:null,trialExpiresAt:null});
    await vi.waitFor(async () => {
      const { rows } = await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [user!.tenantId]);
      expect(rows[0].n).toBe(1);
    });
  });

  it("a verified Google claim removes an unproven password and revokes its older sessions", async () => {
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
    const address = email();
    await ensureUserAndTenant({ email:address, passwordHash:await bcrypt.hash("unproven-password",4) });
    const old = await provider("credentials")({email:address,password:"unproven-password"},{});
    expect(old?.status).toBe("trial");
    vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
    const googleUser = {id:"google-user",email:address};
    expect(await authOptions.callbacks!.signIn!({user:googleUser, account:{provider:"google",providerAccountId:randomUUID()},profile:{email:address,email_verified:true}} as never)).toBe(true);
    const current = await findUserByEmail(address);
    expect(current?.passwordHash).toBeNull();
    expect(current?.credentialEpoch).toBe(1);
    expect(await provider("credentials")({email:address,password:"unproven-password"},{})).toBeNull();
    expect(credentialsAreCurrent({credentialEpoch:old!.credentialEpoch},current)).toBe(false);
    await setUserPreferences(current!.id,{credentialEpoch:0});
    expect(credentialsAreCurrent({credentialEpoch:old!.credentialEpoch},await findUserByEmail(address))).toBe(false);
    const stale = await refreshEntitlementClaims({uid:old!.id,credentialEpoch:old!.credentialEpoch,status:"trial"},findUserByEmail.bind(null,address));
    expect(stale.uid).toBeUndefined();
    // Existing access terms are not promoted by claiming the identity.
    expect(current?.status).toBe("trial");
  });

  it("does not accept an unverified Google email as an identity claim", async () => {
    const address=email();
    expect(await authOptions.callbacks!.signIn!({user:{id:"google-user"},account:{provider:"google",providerAccountId:randomUUID()},profile:{email:address,email_verified:false}} as never)).toBe(false);
    expect(await findUserByEmail(address)).toBeNull();
  });

  it("enforces one-person free workspaces at invite creation and old-token redemption even after rollback", async () => {
    const free = await verifiedAccount(email());
    vi.stubEnv("MIRA_FREE_TECHNICIANS","false");
    await testPool.query("UPDATE hub_tenants SET settings = '{\"signupOffer\":null}'::jsonb WHERE id=$1",[free.tenantId]);
    await expect(assertTeamInvitesAllowed(testPool,free.tenantId)).rejects.toThrow("one person");
    await expect(ensureInvitedUser({email:email(),tenantId:free.tenantId,role:"technician"})).rejects.toThrow("one person");
    const {rows}=await testPool.query("SELECT count(*)::int AS n FROM hub_users WHERE tenant_id=$1",[free.tenantId]);
    expect(rows[0].n).toBe(1);
    const paid=await ensureUserAndTenant({email:email()});
    await testPool.query("UPDATE hub_users SET status='approved',plan='enterprise' WHERE id=$1",[paid.id]);
    await expect(assertTeamInvitesAllowed(testPool,paid.tenantId)).resolves.toBeUndefined();
    const member=await ensureInvitedUser({email:email(),tenantId:paid.tenantId,role:"technician"});
    expect(member.tenantId).toBe(paid.tenantId);
  });

  it("preserves the active pilot seat cap and organization deadline", async () => {
    vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED","1");
    const pilot = await ensureUserAndTenant({email:email(),signupIntent:"pilot"});
    await testPool.query("UPDATE hub_tenants SET pilot_status='active',pilot_expires_at=NOW()+INTERVAL '30 days' WHERE id=$1",[pilot.tenantId]);
    await testPool.query("UPDATE hub_users SET status='trial',trial_expires_at=(SELECT pilot_expires_at FROM hub_tenants WHERE id=$1) WHERE id=$2",[pilot.tenantId,pilot.id]);
    for(let i=1;i<PILOT_SEAT_MAX_USERS;i++) {
      const member = await ensureInvitedUser({email:email(),tenantId:pilot.tenantId,role:"technician"});
      const {rows}=await testPool.query("SELECT u.status,date_trunc('milliseconds',u.trial_expires_at)=date_trunc('milliseconds',t.pilot_expires_at) AS same_deadline FROM hub_users u JOIN hub_tenants t ON t.id=u.tenant_id WHERE u.id=$1",[member.id]);
      expect(rows[0]).toMatchObject({status:"trial",same_deadline:true});
    }
    await expect(ensureInvitedUser({email:email(),tenantId:pilot.tenantId,role:"technician"})).rejects.toThrow("5");
  });
});
