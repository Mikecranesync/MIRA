/** Real auth/onboarding handlers and PostgreSQL; disposable loopback database only. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ADMIN_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");
const { testPool, adminPool } = vi.hoisted(() => { const { Pool: PgPool } = require("pg"); return { testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL }) as Pool, adminPool: new PgPool({ connectionString: process.env.TEST_DATABASE_ADMIN_URL }) as Pool }; });
vi.mock("@/lib/db", () => ({ default: testPool }));
import { ensureSchema, ensureUserAndTenant, findUserByEmail, createMagicToken, ensureInvitedUser } from "@/lib/users";
import { authOptions } from "@/auth";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as requestSetup } from "@/app/api/public/onboarding/route";
import { POST as requestLogin } from "@/app/(hub)/api/auth/magic-link/route";
import { ONBOARDING_VERSION, ONBOARDING_SHA256 } from "@/capabilities/onboarding-policy";
import { assertAuthMigrationReady } from "@/capabilities/auth-schema";
import { assertTeamInvitesAllowed } from "@/capabilities/free-workspace";
import { credentialsAreCurrent } from "@/capabilities/verified-identity";
import { PILOT_SEAT_MAX_USERS } from "@/lib/config";
import bcrypt from "bcryptjs";
type TestProvider = {
    id?: string;
    options?: {
        id?: string;
        authorize: (values: Record<string, string>, request: unknown) => Promise<{
            id: string;
            tenantId?: string;
            status?: string;
            credentialEpoch?: number;
        } | null>;
    };
};
function provider(id: string) { const found = authOptions.providers.find(p => ((p as TestProvider).options?.id ?? p.id) === id) as TestProvider; return found.options!.authorize; }
function email() { return `verified-${randomUUID()}@example.test`; }
function request(body: unknown) { return new Request("https://app.factorylm.com/api/public/onboarding/", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": randomUUID() }, body: JSON.stringify(body) }); }
async function issue(address: string, intent: "technician" | "pilot" = "technician") { return createMagicToken(address, { onboarding: { intent, agreementVersion: ONBOARDING_VERSION } }); }
async function confirm(token: string, agreementVersion = ONBOARDING_VERSION) { return provider("magic-token")({ token, agreementVersion }, {}); }
async function personal(address = email()) { const result = await confirm(await issue(address)); if (!result)
    throw new Error("Verified onboarding failed"); return { id: result.id, tenantId: result.tenantId!, email: address }; }
describe.skipIf(!READY)("verified onboarding with a restricted production-shaped PostgreSQL role", () => {
    beforeAll(async () => {
        for (const target of [process.env.TEST_DATABASE_URL!, process.env.TEST_DATABASE_ADMIN_URL!]) {
            const u = new URL(target);
            if (u.hostname !== "127.0.0.1" || !u.pathname.startsWith("/factorylm_free_signup_test"))
                throw new Error("Disposable loopback database required");
        }
        await adminPool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='factorylm_app') THEN CREATE ROLE factorylm_app; END IF; END $$; ALTER ROLE factorylm_app LOGIN");
        await adminPool.query("CREATE TABLE IF NOT EXISTS hub_tenants (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,name TEXT NOT NULL,owner_user_id TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),slug TEXT,settings JSONB NOT NULL DEFAULT '{}')");
        await adminPool.query("CREATE TABLE IF NOT EXISTS hub_users (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,email TEXT NOT NULL,email_lower TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,password_hash TEXT,google_sub TEXT,tenant_id TEXT NOT NULL REFERENCES hub_tenants(id),name TEXT,role TEXT NOT NULL DEFAULT 'owner',status TEXT NOT NULL DEFAULT 'trial',trial_expires_at TIMESTAMPTZ,plan TEXT,preferences JSONB NOT NULL DEFAULT '{}',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
        await adminPool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_email_lower ON hub_users(email_lower); CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_google_sub ON hub_users(google_sub) WHERE google_sub IS NOT NULL; CREATE TABLE IF NOT EXISTS tenants(id UUID PRIMARY KEY,name TEXT NOT NULL,contact_email TEXT NOT NULL)");
        for (const name of ["107_pilot_access.sql", "108_pilot_applications.sql", "109_hub_users_terms_consent.sql", "116_verified_personal_onboarding.sql"])
            await adminPool.query(readFileSync("db/migrations/" + name, "utf8"));
        vi.stubEnv("NEON_DATABASE_URL", process.env.TEST_DATABASE_URL!);
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
        await ensureSchema();
    });
    beforeEach(() => { vi.unstubAllGlobals(); vi.stubEnv("MIRA_FREE_TECHNICIANS", "true"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1"); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("HUBSPOT_API_KEY", ""); vi.stubEnv("PLG_POSTHOG_KEY", ""); });
    afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await testPool.end(); await adminPool.end(); });
    it("runtime can use auth tables but cannot alter them", async () => { expect((await testPool.query("SELECT current_user AS role")).rows[0].role).toBe("factorylm_app"); await expect(testPool.query("ALTER TABLE hub_users ADD COLUMN forbidden_runtime_ddl TEXT")).rejects.toMatchObject({ code: "42501" }); await expect(assertAuthMigrationReady()).resolves.toBeUndefined(); });
    it("ordinary email sign-in and Google cannot create the permanent account", async () => { const address = email(); expect(await provider("magic-token")({ token: await createMagicToken(address) }, {})).toBeNull(); expect(await findUserByEmail(address)).toBeNull(); expect(await authOptions.callbacks!.signIn!({ user: { id: "google-new" }, account: { provider: "google", providerAccountId: randomUUID() }, profile: { email: address, email_verified: true } } as never)).toBe("/signup/"); expect(await findUserByEmail(address)).toBeNull(); expect((await register(request({ email: address, password: "unverified-password" }))).status).toBe(403); });
    it("onboarding requires recipient confirmation of the bound agreement", async () => { const address = email(); expect(await confirm(await issue(address), "wrong-version")).toBeNull(); expect(await findUserByEmail(address)).toBeNull(); const token = await issue(address); const result = await confirm(token); expect(result?.status).toBe("approved"); expect(await findUserByEmail(address)).toMatchObject({ status: "approved", plan: "technician_free", trialExpiresAt: null, passwordHash: null }); const { rows } = await testPool.query("SELECT terms_version,terms_sha256,terms_accepted_at FROM hub_users WHERE id=$1", [result!.id]); expect(rows[0]).toMatchObject({ terms_version: ONBOARDING_VERSION, terms_sha256: ONBOARDING_SHA256 }); expect(rows[0].terms_accepted_at).not.toBeNull(); expect(await confirm(token)).toBeNull(); });
    it("real request handlers distinguish new setup from returning sign-in before delivery", async () => { const address = email(); vi.stubEnv("RESEND_API_KEY", "synthetic-local-transport"); const mail = vi.fn(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", mail); expect((await requestLogin(request({ email: address }))).status).toBe(409); expect(mail).not.toHaveBeenCalled(); expect((await requestSetup(request({ email: address, intent: "technician", accepted: true, agreementVersion: ONBOARDING_VERSION }))).status).toBe(200); expect(await findUserByEmail(address)).toBeNull(); const { rows } = await testPool.query("SELECT token,purpose,onboarding FROM hub_magic_tokens WHERE email=$1 ORDER BY expires_at DESC LIMIT 1", [address]); expect(rows[0].purpose).toBe("onboarding"); expect(await confirm(rows[0].token)).not.toBeNull(); expect((await requestLogin(request({ email: address }))).status).toBe(200); });
    it.each([["false", "0"], ["false", "1"], ["true", "0"], ["true", "1"]])("explicit pilot is verified/pending or contact-only with free=%s review=%s", async (free, pilot) => { vi.stubEnv("MIRA_FREE_TECHNICIANS", free); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", pilot); vi.stubEnv("RESEND_API_KEY", "synthetic-local-transport"); vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 }))); const address = email(); expect((await register(request({ email: address, password: "unverified-password", signupIntent: "pilot" }))).status).toBe(403); const result = await requestSetup(request({ email: address, intent: "pilot", accepted: true, agreementVersion: ONBOARDING_VERSION })); expect(result.status).toBe(pilot === "1" ? 200 : 403); expect(await findUserByEmail(address)).toBeNull(); if (pilot === "1") {
        const { rows } = await testPool.query("SELECT token FROM hub_magic_tokens WHERE email=$1", [address]);
        const account = await confirm(rows[0].token);
        expect(account?.status).toBe("pending");
        await vi.waitFor(async () => expect((await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [account!.tenantId])).rows[0].n).toBe(1));
    } });
    it("verified owner escapes an untrusted pending application into a fresh personal workspace", async () => { vi.stubEnv("MIRA_FREE_TECHNICIANS", "false"); const address = email(); const prior = await ensureUserAndTenant({ email: address, signupIntent: "pilot", passwordHash: await bcrypt.hash("unproven-password", 4) }); await testPool.query("INSERT INTO pilot_applications(tenant_id,user_id) VALUES ($1,$2)", [prior.tenantId, prior.id]); const old = await provider("credentials")({ email: address, password: "unproven-password" }, {}); vi.stubEnv("MIRA_FREE_TECHNICIANS", "true"); const recovered = await personal(address); expect(recovered.tenantId).not.toBe(prior.tenantId); expect((await findUserByEmail(address))?.status).toBe("approved"); const previous = (await testPool.query("SELECT u.status,u.password_hash,u.credential_epoch,t.pilot_status FROM hub_users u JOIN hub_tenants t ON t.id=u.tenant_id WHERE u.id=$1", [prior.id])).rows[0]; expect(previous).toMatchObject({ status: "expired", password_hash: null, pilot_status: "pending" }); expect(credentialsAreCurrent({ credentialEpoch: old!.credentialEpoch }, { credentialEpoch: previous.credential_epoch })).toBe(false); expect((await testPool.query("SELECT original_email,personal_user_id FROM hub_onboarding_recoveries WHERE previous_user_id=$1", [prior.id])).rows[0]).toMatchObject({ original_email: address, personal_user_id: recovered.id }); expect((await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [recovered.tenantId])).rows[0].n).toBe(0); });
    it("a pilot token issued before a personal account wins cannot record a false application", async () => { const address = email(), pilotToken = await issue(address, "pilot"); const free = await personal(address); expect(await confirm(pilotToken)).toBeNull(); expect((await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [free.tenantId])).rows[0].n).toBe(0); expect((await findUserByEmail(address))?.plan).toBe("technician_free"); });
    it("ordinary verified claim removes an unproven password and old sessions", async () => { vi.stubEnv("MIRA_FREE_TECHNICIANS", "false"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0"); const address = email(); await ensureUserAndTenant({ email: address, passwordHash: await bcrypt.hash("legacy-password", 4) }); const old = await provider("credentials")({ email: address, password: "legacy-password" }, {}); expect(await provider("magic-token")({ token: await createMagicToken(address) }, {})).not.toBeNull(); const user = await findUserByEmail(address); expect(user?.passwordHash).toBeNull(); expect(credentialsAreCurrent({ credentialEpoch: old!.credentialEpoch }, user)).toBe(false); expect(await provider("credentials")({ email: address, password: "legacy-password" }, {})).toBeNull(); });
    it("free seats stay personal after rollback while paid invitations still work", async () => { const free = await personal(); vi.stubEnv("MIRA_FREE_TECHNICIANS", "false"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0"); await testPool.query("UPDATE hub_tenants SET settings='{\"signupOffer\":null}'::jsonb WHERE id=$1", [free.tenantId]); await expect(assertTeamInvitesAllowed(testPool, free.tenantId)).rejects.toThrow("one person"); await expect(ensureInvitedUser({ email: email(), tenantId: free.tenantId, role: "technician" })).rejects.toThrow("one person"); expect((await provider("magic-token")({ token: await createMagicToken(free.email) }, {}))?.status).toBe("approved"); const paid = await ensureUserAndTenant({ email: email() }); await testPool.query("UPDATE hub_users SET plan='enterprise',status='approved' WHERE id=$1", [paid.id]); expect((await ensureInvitedUser({ email: email(), tenantId: paid.tenantId, role: "technician" })).tenantId).toBe(paid.tenantId); });
    it("active pilot members retain their cap and organization deadline", async () => { vi.stubEnv("MIRA_FREE_TECHNICIANS", "false"); const pilot = await ensureUserAndTenant({ email: email(), signupIntent: "pilot" }); await testPool.query("UPDATE hub_tenants SET pilot_status='active',pilot_expires_at=NOW()+INTERVAL '30 days' WHERE id=$1", [pilot.tenantId]); await testPool.query("UPDATE hub_users SET status='trial',trial_expires_at=(SELECT pilot_expires_at FROM hub_tenants WHERE id=$1) WHERE id=$2", [pilot.tenantId, pilot.id]); for (let i = 1; i < PILOT_SEAT_MAX_USERS; i++) {
        const member = await ensureInvitedUser({ email: email(), tenantId: pilot.tenantId, role: "technician" });
        expect((await testPool.query("SELECT date_trunc('milliseconds',u.trial_expires_at)=date_trunc('milliseconds',t.pilot_expires_at) AS same FROM hub_users u JOIN hub_tenants t ON t.id=u.tenant_id WHERE u.id=$1", [member.id])).rows[0].same).toBe(true);
    } await expect(ensureInvitedUser({ email: email(), tenantId: pilot.tenantId, role: "technician" })).rejects.toThrow("5"); });
    it("a missing migration is a clear readiness failure and recovers after migration", async () => { await adminPool.query("ALTER TABLE hub_magic_tokens RENAME COLUMN purpose TO unavailable_purpose"); try {
        await expect(assertAuthMigrationReady()).rejects.toThrow("apply-migrations.yml");
    }
    finally {
        await adminPool.query("ALTER TABLE hub_magic_tokens RENAME COLUMN unavailable_purpose TO purpose");
    } await expect(assertAuthMigrationReady()).resolves.toBeUndefined(); });
});
