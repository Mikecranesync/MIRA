/** Real auth/onboarding handlers and PostgreSQL; disposable loopback database only. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Pool } from "pg";
const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_ADMIN_URL && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE");
const { testPool, adminPool, scope } = vi.hoisted(() => {
    const { Pool: PgPool } = require("pg");
    const scope = "auth_proof_" + require("node:crypto").randomUUID().replaceAll("-", "");
    return { scope, testPool: new PgPool({ connectionString: process.env.TEST_DATABASE_URL, options: "-c search_path=" + scope }) as Pool, adminPool: new PgPool({ connectionString: process.env.TEST_DATABASE_ADMIN_URL, options: "-c search_path=" + scope }) as Pool };
});
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
import { GET as health } from "@/app/api/health/route";
vi.mock("@/capabilities/embed-retry-sweep", () => ({ ensureEmbedRetrySweep: vi.fn() }));
vi.mock("@/capabilities/hybrid-retrieval", () => ({ warmQueryEmbedder: vi.fn(async () => undefined) }));
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
async function personal(address = email()) {
    const result = await confirm(await issue(address));
    if (!result)
        throw new Error("Verified onboarding failed");
    return { id: result.id, tenantId: result.tenantId!, email: address };
}
describe.skipIf(!READY)("verified onboarding with a restricted production-shaped PostgreSQL role", () => {
    beforeAll(async () => {
        for (const target of [process.env.TEST_DATABASE_URL!, process.env.TEST_DATABASE_ADMIN_URL!]) {
            const u = new URL(target);
            if (u.hostname !== "127.0.0.1" || !u.pathname.startsWith("/factorylm_free_signup_test"))
                throw new Error("Disposable loopback database required");
        }
        await adminPool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='factorylm_app') THEN CREATE ROLE factorylm_app; END IF; END $$; ALTER ROLE factorylm_app LOGIN");
        await adminPool.query(`CREATE SCHEMA ${scope}; GRANT USAGE ON SCHEMA ${scope} TO factorylm_app`);
        await adminPool.query(readFileSync("../mira-core/mira-ingest/db/migrations/008_hub_users_tenants.sql", "utf8"));
        await adminPool.query("CREATE TABLE tenants(id UUID PRIMARY KEY,name TEXT NOT NULL,contact_email TEXT NOT NULL)");
        for (const name of ["107_pilot_access.sql", "108_pilot_applications.sql", "109_hub_users_terms_consent.sql", "116_verified_personal_onboarding.sql"])
            await adminPool.query(readFileSync("db/migrations/" + name, "utf8"));
        await expect(assertAuthMigrationReady()).rejects.toThrow("through 117");
        vi.stubEnv("NEON_DATABASE_URL", process.env.TEST_DATABASE_URL!);
        vi.stubEnv("INGEST_URL", "http://127.0.0.1:9");
        const incomplete = await health();
        expect(incomplete.status).toBe(503);
        expect(await incomplete.json()).toMatchObject({reason:"auth_schema_prerequisite"});
        await adminPool.query(readFileSync("db/migrations/117_auth_schema_and_identity_provenance.sql", "utf8"));
        await adminPool.query(readFileSync("db/migrations/117_auth_schema_and_identity_provenance.sql", "utf8"));
        vi.stubEnv("NEON_DATABASE_URL", process.env.TEST_DATABASE_URL!);
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
        await ensureSchema();
    });
    beforeEach(() => { vi.unstubAllGlobals(); vi.stubEnv("MIRA_FREE_TECHNICIANS", "true"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1"); vi.stubEnv("RESEND_API_KEY", ""); vi.stubEnv("HUBSPOT_API_KEY", ""); vi.stubEnv("PLG_POSTHOG_KEY", ""); });
    afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await testPool.end(); await adminPool.query(`DROP SCHEMA ${scope} CASCADE`); await adminPool.end(); });
    it("runtime can use auth tables but cannot alter them", async () => { expect((await testPool.query("SELECT current_user AS role")).rows[0].role).toBe("factorylm_app"); await expect(testPool.query("ALTER TABLE hub_users ADD COLUMN forbidden_runtime_ddl TEXT")).rejects.toMatchObject({ code: "42501" }); await expect(assertAuthMigrationReady()).resolves.toBeUndefined(); });
    it("ordinary email sign-in and Google cannot create the permanent account", async () => { const address = email(); expect(await provider("magic-token")({ token: await createMagicToken(address) }, {})).toBeNull(); expect(await findUserByEmail(address)).toBeNull(); expect(await authOptions.callbacks!.signIn!({ user: { id: "google-new" }, account: { provider: "google", providerAccountId: randomUUID() }, profile: { email: address, email_verified: true } } as never)).toBe("/signup/"); expect(await findUserByEmail(address)).toBeNull(); expect((await register(request({ email: address, password: "unverified-password" }))).status).toBe(403); });
    it("onboarding requires recipient confirmation of the bound agreement", async () => { const address = email(); expect(await confirm(await issue(address), "wrong-version")).toBeNull(); expect(await findUserByEmail(address)).toBeNull(); const token = await issue(address); const result = await confirm(token); expect(result?.status).toBe("approved"); expect(await findUserByEmail(address)).toMatchObject({ status: "approved", plan: "technician_free", trialExpiresAt: null, passwordHash: null }); const { rows } = await testPool.query("SELECT terms_version,terms_sha256,terms_accepted_at FROM hub_users WHERE id=$1", [result!.id]); expect(rows[0]).toMatchObject({ terms_version: ONBOARDING_VERSION, terms_sha256: ONBOARDING_SHA256 }); expect(rows[0].terms_accepted_at).not.toBeNull(); expect(await confirm(token)).toBeNull(); });
    it("real request handlers distinguish new setup from returning sign-in before delivery", async () => { const address = email(); vi.stubEnv("RESEND_API_KEY", "synthetic-local-transport"); const mail = vi.fn(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", mail); expect((await requestLogin(request({ email: address }))).status).toBe(200); expect(mail).not.toHaveBeenCalled(); expect((await requestSetup(request({ email: address, intent: "technician", accepted: true, agreementVersion: ONBOARDING_VERSION }))).status).toBe(200); expect(await findUserByEmail(address)).toBeNull(); const { rows } = await testPool.query("SELECT token,purpose,onboarding FROM hub_magic_tokens WHERE email=$1 ORDER BY expires_at DESC LIMIT 1", [address]); expect(rows[0].purpose).toBe("onboarding"); expect(await confirm(rows[0].token)).not.toBeNull(); expect((await requestLogin(request({ email: address }))).status).toBe(200); });
    it.each([["false", "0"], ["false", "1"], ["true", "0"], ["true", "1"]])("explicit pilot is verified/pending or contact-only with free=%s review=%s", async (free, pilot) => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", free);
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", pilot);
        vi.stubEnv("RESEND_API_KEY", "synthetic-local-transport");
        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
        const address = email();
        expect((await register(request({ email: address, password: "unverified-password", signupIntent: "pilot" }))).status).toBe(403);
        const result = await requestSetup(request({ email: address, intent: "pilot", accepted: true, agreementVersion: ONBOARDING_VERSION }));
        expect(result.status).toBe(pilot === "1" ? 200 : 403);
        expect(await findUserByEmail(address)).toBeNull();
        if (pilot === "1") {
            const { rows } = await testPool.query("SELECT token FROM hub_magic_tokens WHERE email=$1", [address]);
            const account = await confirm(rows[0].token);
            expect(account?.status).toBe("pending");
            await vi.waitFor(async () => expect((await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [account!.tenantId])).rows[0].n).toBe(1));
        }
    });
    it("a personal setup link never retires a legacy pending pilot: password, application and session stay intact (F17/F23)", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        const address = email();
        const prior = await ensureUserAndTenant({ email: address, signupIntent: "pilot", passwordHash: await bcrypt.hash("unproven-password", 4) });
        await testPool.query("INSERT INTO pilot_applications(tenant_id,user_id) VALUES ($1,$2)", [prior.tenantId, prior.id]);
        const old = await provider("credentials")({ email: address, password: "unproven-password" }, {});
        const before = (await testPool.query("SELECT password_hash,credential_epoch FROM hub_users WHERE id=$1", [prior.id])).rows[0];
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
        const token = await issue(address);
        expect(await confirm(token)).toBeNull();
        const after = (await testPool.query("SELECT u.email,u.status,u.password_hash,u.credential_epoch,u.google_sub,t.pilot_status,t.owner_user_id FROM hub_users u JOIN hub_tenants t ON t.id=u.tenant_id WHERE u.id=$1", [prior.id])).rows[0];
        expect(after).toMatchObject({ email: address, status: "pending", password_hash: before.password_hash, credential_epoch: before.credential_epoch, pilot_status: "pending" });
        expect(credentialsAreCurrent({ credentialEpoch: old!.credentialEpoch }, { credentialEpoch: after.credential_epoch })).toBe(true);
        expect(await provider("credentials")({ email: address, password: "unproven-password" }, {})).not.toBeNull();
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_users WHERE email_lower=LOWER($1)", [address])).rows[0].n).toBe(1);
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_onboarding_recoveries WHERE previous_user_id=$1", [prior.id])).rows[0].n).toBe(0);
        expect((await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [prior.tenantId])).rows[0].n).toBe(1);
        // The refused link was not consumed by a half-done recovery.
        expect((await testPool.query("SELECT used_at FROM hub_magic_tokens WHERE token=$1", [token])).rows[0].used_at).toBeNull();
    });
    it("an already-linked Google subject still signs in over an unknown-provenance password; a new subject cannot claim it (F24)", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
        const address = email(), linked = "google-linked-" + randomUUID();
        const user = await ensureUserAndTenant({ email: address, passwordHash: await bcrypt.hash("legacy-linked-password", 4) });
        await testPool.query("UPDATE hub_users SET password_provenance='unknown',google_sub=$2 WHERE id=$1", [user.id, linked]);
        const google = (sub: string) => authOptions.callbacks!.signIn!({ user: { id: "google-user" }, account: { provider: "google", providerAccountId: sub }, profile: { email: address, email_verified: true } } as never);
        expect(await google(linked)).toBe(true);
        expect(await findUserByEmail(address)).toMatchObject({ id: user.id, passwordProvenance: "unknown", credentialEpoch: 0 });
        expect(await provider("credentials")({ email: address, password: "legacy-linked-password" }, {})).not.toBeNull();
        await expect(google("google-new-" + randomUUID())).rejects.toThrow("operator review");
        expect((await testPool.query("SELECT google_sub FROM hub_users WHERE id=$1", [user.id])).rows[0].google_sub).toBe(linked);
        expect(await provider("credentials")({ email: address, password: "legacy-linked-password" }, {})).not.toBeNull();
    });
    it("a linked Google subject with a renamed address signs in without verifying the old stored address (F27)", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
        const stored = email(), renamed = email(), linked = "google-renamed-" + randomUUID();
        const user = await ensureUserAndTenant({ email: stored, passwordHash: await bcrypt.hash("renamed-password", 4) });
        await testPool.query("UPDATE hub_users SET google_sub=$2 WHERE id=$1", [user.id, linked]);
        const before = (await testPool.query("SELECT email,password_hash,credential_epoch,email_verified_at FROM hub_users WHERE id=$1", [user.id])).rows[0];
        expect(before.email_verified_at).toBeNull();
        expect(await authOptions.callbacks!.signIn!({ user: { id: "google-user" }, account: { provider: "google", providerAccountId: linked }, profile: { email: renamed, email_verified: true } } as never)).toBe(true);
        expect((await testPool.query("SELECT email,password_hash,credential_epoch,email_verified_at FROM hub_users WHERE id=$1", [user.id])).rows[0]).toEqual(before);
    });
    it.each([["0"], ["1"]])("a re-invite cannot change access for an unknown-provenance identity, pilot review=%s (F28)", async (pilot) => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", pilot);
        const owner = await ensureUserAndTenant({ email: email(), signupIntent: pilot === "1" ? "pilot" : undefined });
        await testPool.query("UPDATE hub_users SET plan='enterprise',status='approved' WHERE id=$1", [owner.id]);
        if (pilot === "1")
            await testPool.query("UPDATE hub_tenants SET pilot_status='active',pilot_expires_at=NOW()+INTERVAL '30 days' WHERE id=$1", [owner.tenantId]);
        const address = email();
        const member = await ensureInvitedUser({ email: address, tenantId: owner.tenantId, role: "technician" });
        await testPool.query("UPDATE hub_users SET password_hash=$2,password_provenance='unknown',status='expired' WHERE id=$1", [member.id, await bcrypt.hash("unknown-member-password", 4)]);
        const snapshot = async () => (await testPool.query("SELECT role,status,credential_epoch,password_hash,email_verified_at,trial_expires_at FROM hub_users WHERE id=$1", [member.id])).rows[0];
        const before = await snapshot();
        const token = await createMagicToken(address, { tenantId: owner.tenantId, role: "admin" });
        expect(await provider("magic-token")({ token }, {})).toBeNull();
        expect(await snapshot()).toEqual(before);
        expect((await testPool.query("SELECT used_at FROM hub_magic_tokens WHERE token=$1", [token])).rows[0].used_at).toBeNull();
        // The in-transaction guard holds even if the pre-check is bypassed.
        await expect(ensureInvitedUser({ email: address, tenantId: owner.tenantId, role: "admin" })).rejects.toThrow("operator review");
        expect(await snapshot()).toEqual(before);
        // Eligible control: an operator-provenance identity is re-invited exactly once.
        await testPool.query("UPDATE hub_users SET password_provenance='operator' WHERE id=$1", [member.id]);
        const ok = await createMagicToken(address, { tenantId: owner.tenantId, role: "admin" });
        expect((await provider("magic-token")({ token: ok }, {}))?.id).toBe(member.id);
        expect((await snapshot()).role).toBe("admin");
        expect(await provider("magic-token")({ token: ok }, {})).toBeNull();
    });
    it("a technician setup request for a legacy pending pilot sends no mail and mints no token (F29)", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        const legacy = email();
        await ensureUserAndTenant({ email: legacy, signupIntent: "pilot", passwordHash: await bcrypt.hash("legacy-pending", 4) });
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
        vi.stubEnv("RESEND_API_KEY", "synthetic-local-transport");
        const mail = vi.fn(async () => new Response("{}", { status: 200 }));
        vi.stubGlobal("fetch", mail);
        const body = (address: string) => ({ email: address, intent: "technician", accepted: true, agreementVersion: ONBOARDING_VERSION });
        const refused = await requestSetup(request(body(legacy)));
        expect(mail).not.toHaveBeenCalled();
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_magic_tokens WHERE email=$1", [legacy])).rows[0].n).toBe(0);
        const control = email();
        const accepted = await requestSetup(request(body(control)));
        expect(mail).toHaveBeenCalledTimes(1);
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_magic_tokens WHERE email=$1", [control])).rows[0].n).toBe(1);
        expect(refused.status).toBe(accepted.status);
        expect(await refused.json()).toEqual(await accepted.json());
    });
    it("a pilot token issued before a personal account wins cannot record a false application", async () => { const address = email(), pilotToken = await issue(address, "pilot"); const free = await personal(address); expect(await confirm(pilotToken)).toBeNull(); expect((await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [free.tenantId])).rows[0].n).toBe(0); expect((await findUserByEmail(address))?.plan).toBe("technician_free"); });
    it("ordinary verified claim removes an unproven password and old sessions", async () => { vi.stubEnv("MIRA_FREE_TECHNICIANS", "false"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0"); const address = email(); await ensureUserAndTenant({ email: address, passwordHash: await bcrypt.hash("legacy-password", 4) }); const old = await provider("credentials")({ email: address, password: "legacy-password" }, {}); expect(await provider("magic-token")({ token: await createMagicToken(address) }, {})).not.toBeNull(); const user = await findUserByEmail(address); expect(user?.passwordHash).toBeNull(); expect(credentialsAreCurrent({ credentialEpoch: old!.credentialEpoch }, user)).toBe(false); expect(await provider("credentials")({ email: address, password: "legacy-password" }, {})).toBeNull(); });
    it("free seats stay personal after rollback while paid invitations still work", async () => { const free = await personal(); vi.stubEnv("MIRA_FREE_TECHNICIANS", "false"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0"); await testPool.query("UPDATE hub_users SET preferences='{\"signupOffer\":null}'::jsonb WHERE id=$1", [free.id]); await expect(assertTeamInvitesAllowed(testPool, free.tenantId)).rejects.toThrow("one person"); await expect(ensureInvitedUser({ email: email(), tenantId: free.tenantId, role: "technician" })).rejects.toThrow("one person"); expect((await provider("magic-token")({ token: await createMagicToken(free.email) }, {}))?.status).toBe("approved"); const paid = await ensureUserAndTenant({ email: email() }); await testPool.query("UPDATE hub_users SET plan='enterprise',status='approved' WHERE id=$1", [paid.id]); expect((await ensureInvitedUser({ email: email(), tenantId: paid.tenantId, role: "technician" })).tenantId).toBe(paid.tenantId); });
    it("active pilot members retain their cap and organization deadline", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        const pilot = await ensureUserAndTenant({ email: email(), signupIntent: "pilot" });
        await testPool.query("UPDATE hub_tenants SET pilot_status='active',pilot_expires_at=NOW()+INTERVAL '30 days' WHERE id=$1", [pilot.tenantId]);
        await testPool.query("UPDATE hub_users SET status='trial',trial_expires_at=(SELECT pilot_expires_at FROM hub_tenants WHERE id=$1) WHERE id=$2", [pilot.tenantId, pilot.id]);
        for (let i = 1; i < PILOT_SEAT_MAX_USERS; i++) {
            const member = await ensureInvitedUser({ email: email(), tenantId: pilot.tenantId, role: "technician" });
            expect((await testPool.query("SELECT date_trunc('milliseconds',u.trial_expires_at)=date_trunc('milliseconds',t.pilot_expires_at) AS same FROM hub_users u JOIN hub_tenants t ON t.id=u.tenant_id WHERE u.id=$1", [member.id])).rows[0].same).toBe(true);
        }
        await expect(ensureInvitedUser({ email: email(), tenantId: pilot.tenantId, role: "technician" })).rejects.toThrow("5");
    });
    it("a missing migration is a clear readiness failure and recovers after migration", async () => {
        await adminPool.query("ALTER TABLE hub_magic_tokens RENAME COLUMN purpose TO unavailable_purpose");
        try {
            await expect(assertAuthMigrationReady()).rejects.toThrow("apply-migrations.yml");
        }
        finally {
            await adminPool.query("ALTER TABLE hub_magic_tokens RENAME COLUMN unavailable_purpose TO purpose");
        }
        await expect(assertAuthMigrationReady()).resolves.toBeUndefined();
    });
    it("bootstrap reconciliation supports flag-off health and password sign-in without DDL", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
        vi.stubEnv("INGEST_URL", "http://127.0.0.1:9");
        expect((await health()).status).toBe(200);
        const address = email();
        await ensureUserAndTenant({ email: address, passwordHash: await bcrypt.hash("bootstrap-password", 4) });
        expect(await provider("credentials")({ email: address, password: "bootstrap-password" }, {})).not.toBeNull();
        expect(await findUserByEmail(address)).toMatchObject({ passwordProvenance: "public_unverified" });
    });
    it("verified pending pilot identity and session survive personal signup", async () => {
        const address = email();
        const original = await confirm(await issue(address, "pilot"));
        await vi.waitFor(async () => expect((await testPool.query("SELECT count(*)::int AS n FROM pilot_applications WHERE tenant_id=$1", [original!.tenantId])).rows[0].n).toBe(1));
        const before = await findUserByEmail(address);
        expect(before?.emailVerifiedAt).not.toBeNull();
        expect(await confirm(await issue(address))).toBeNull();
        expect(await findUserByEmail(address)).toMatchObject({ id: original!.id, email: address, tenantId: original!.tenantId, status: "pending", credentialEpoch: before!.credentialEpoch });
        expect(credentialsAreCurrent({ credentialEpoch: original!.credentialEpoch }, await findUserByEmail(address))).toBe(true);
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_onboarding_recoveries WHERE previous_user_id=$1", [original!.id])).rows[0].n).toBe(0);
    });
    it("operator-provisioned passwords survive email and Google sign-in", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
        const owner = await ensureUserAndTenant({ email: email() });
        const address = email();
        const url = new URL(process.env.TEST_DATABASE_URL!);
        url.searchParams.set("options", "-c search_path=" + scope);
        execFileSync(process.execPath, ["../tools/crew/provision_subordinate.mjs", "--tenant", owner.tenantId, "--email", address, "--name", "Synthetic crew", "--role", "technician", "--password", "synthetic-operator-password"], { env: { ...process.env, NEON_DATABASE_URL: url.href }, stdio: "pipe" });
        const prior = await provider("credentials")({ email: address, password: "synthetic-operator-password" }, {});
        expect(prior).not.toBeNull();
        expect(await provider("magic-token")({ token: await createMagicToken(address) }, {})).not.toBeNull();
        expect(await authOptions.callbacks!.signIn!({ user: { id: "google-existing" }, account: { provider: "google", providerAccountId: randomUUID() }, profile: { email: address, email_verified: true } } as never)).toBe(true);
        const after = await provider("credentials")({ email: address, password: "synthetic-operator-password" }, {});
        expect(after?.id).toBe(prior!.id);
        expect(after?.credentialEpoch).toBe(prior!.credentialEpoch);
        expect(await findUserByEmail(address)).toMatchObject({ passwordProvenance: "operator" });
    });
    it("unknown password provenance requires review without deleting the password", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "0");
        const address = email();
        const user = await ensureUserAndTenant({ email: address, passwordHash: await bcrypt.hash("unknown-password", 4) });
        await testPool.query("UPDATE hub_users SET password_provenance='unknown' WHERE id=$1", [user.id]);
        expect(await provider("magic-token")({ token: await createMagicToken(address) }, {})).toBeNull();
        expect(await provider("credentials")({ email: address, password: "unknown-password" }, {})).not.toBeNull();
        expect(await findUserByEmail(address)).toMatchObject({ passwordProvenance: "unknown", emailVerifiedAt: null, credentialEpoch: 0 });
    });
    it("failed commit leaves the same setup token available for retry", async () => {
        const address = "retry-" + randomUUID() + "@example.test", token = await issue(address);
        await adminPool.query("CREATE FUNCTION fail_signup_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.email LIKE 'retry-%@example.test' THEN RAISE EXCEPTION 'synthetic transient commit failure'; END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER fail_signup_commit AFTER INSERT ON hub_users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fail_signup_commit()");
        try {
            expect(await confirm(token)).toBeNull();
            expect(await findUserByEmail(address)).toBeNull();
            expect((await testPool.query("SELECT used_at FROM hub_magic_tokens WHERE token=$1", [token])).rows[0].used_at).toBeNull();
        }
        finally {
            await adminPool.query("DROP TRIGGER fail_signup_commit ON hub_users; DROP FUNCTION fail_signup_commit()");
        }
        expect(await confirm(token)).not.toBeNull();
        expect(await confirm(token)).toBeNull();
    });
    it("concurrent confirmation commits one workspace and one token redemption", async () => {
        const address = email(), token = await issue(address);
        const results = await Promise.all([confirm(token), confirm(token)]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_users WHERE email_lower=LOWER($1)", [address])).rows[0].n).toBe(1);
    });
    it("existing bounded QA cleanup deletes synthetic pending-pilot and free accounts", async () => {
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "false");
        const prior = await ensureUserAndTenant({ email: email(), signupIntent: "pilot" });
        vi.stubEnv("MIRA_FREE_TECHNICIANS", "true");
        const free = await personal();
        await testPool.query("UPDATE hub_users SET status='trial',plan=NULL,created_at='2000-01-01',email=CASE WHEN id=$1 THEN 'cleanup-old@example.test' ELSE email END WHERE id IN ($1,$2)", [prior.id, free.id]);
        for (const table of ["knowledge_entries", "namespace_direct_uploads", "equipment_notebook_turns", "equipment_notebook_sources", "equipment_notebooks", "kg_relationships", "kg_entities", "hub_uploads"])
            await adminPool.query(`CREATE TABLE IF NOT EXISTS ${table} (tenant_id TEXT, is_private BOOLEAN, verified BOOLEAN)`);
        const url = new URL(process.env.TEST_DATABASE_ADMIN_URL!);
        url.searchParams.set("options", "-c search_path=" + scope);
        execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "age_days=1", "-v", "max_tenants=2", "-v", "apply=true", "-v", "exempt_emails=", "-f", "../tools/qa/cleanup_qa_tenants.sql", url.href.replaceAll("+", "%20")], { stdio: "pipe" });
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_users WHERE id IN ($1,$2)", [prior.id, free.id])).rows[0].n).toBe(0);
        expect((await testPool.query("SELECT count(*)::int AS n FROM hub_onboarding_recoveries WHERE previous_user_id=$1", [prior.id])).rows[0].n).toBe(0);
    });
});
