import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/users", () => ({ createMagicToken: vi.fn(async () => "synthetic-single-use-token"), findUserByEmail: vi.fn() }));
import { createMagicToken, findUserByEmail } from "@/lib/users";
import { POST } from "@/app/(hub)/api/auth/magic-link/route";
import { POST as onboarding } from "@/app/api/public/onboarding/route";
import { ONBOARDING_VERSION } from "@/capabilities/onboarding-policy";
let sequence = 0;
function request(ip = "ip-" + ++sequence, body: unknown = { email: `synthetic-${++sequence}@example.test` }) { return new Request("https://app.factorylm.com/api/auth/magic-link/", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("MIRA_FREE_TECHNICIANS", "true"); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", "1"); vi.stubEnv("RESEND_API_KEY", "synthetic-local-key"); vi.mocked(findUserByEmail).mockResolvedValue({ id: "known", email: "known@example.test", tenantId: "tenant", status: "approved", plan: "technician_free" } as never); vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 }))); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("separate sign-in and onboarding delivery", () => {
    it("unknown returning sign-in cannot issue onboarding or reserve an identity", async () => { vi.mocked(findUserByEmail).mockResolvedValue(null); expect((await POST(request())).status).toBe(200); expect(createMagicToken).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); });
    it("missing email configuration never claims delivery or creates a bearer link", async () => { vi.stubEnv("RESEND_API_KEY", ""); expect((await POST(request())).status).toBe(503); expect(createMagicToken).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); });
    it("returning login issues only an ordinary token", async () => { const result = await POST(request()); expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true }); expect(vi.mocked(createMagicToken).mock.calls[0][1]).toEqual({}); });
    it("canonical onboarding binds verified-mail purpose to the current agreement", async () => { vi.mocked(findUserByEmail).mockResolvedValue(null); const result = await onboarding(request(undefined, { email: `join-${++sequence}@example.test`, intent: "technician", accepted: true, agreementVersion: ONBOARDING_VERSION })); expect(result.status).toBe(200); expect(vi.mocked(createMagicToken).mock.calls[0][1]).toMatchObject({ onboarding: { intent: "technician", agreementVersion: ONBOARDING_VERSION } }); expect(JSON.stringify(await result.json())).not.toContain("synthetic-single-use-token"); });
    it.each([false, undefined])("does not issue onboarding without explicit agreement %s", async (accepted) => { expect((await onboarding(request(undefined, { email: "consent@example.test", intent: "technician", accepted, agreementVersion: ONBOARDING_VERSION }))).status).toBe(400); expect(createMagicToken).not.toHaveBeenCalled(); });
    it.each([["false", "0"], ["false", "1"], ["true", "0"], ["true", "1"]])("pilot request cannot become a trial with free=%s review=%s", async (free, pilot) => { vi.stubEnv("MIRA_FREE_TECHNICIANS", free); vi.stubEnv("MIRA_PILOT_APPROVAL_REQUIRED", pilot); vi.mocked(findUserByEmail).mockResolvedValue(null); expect((await onboarding(request(undefined, { email: `pilot-${++sequence}@example.test`, intent: "pilot", accepted: true, agreementVersion: ONBOARDING_VERSION }))).status).toBe(pilot === "1" ? 200 : 403); });
    it("six distinct plant recipients behind one proxy are allowed", async () => {
        const ip = "plant-" + ++sequence;
        for (let i = 0; i < 6; i++)
            expect((await POST(request(ip, { email: `burst-${sequence}-${i}@example.test` }))).status).toBe(200);
    });
    it("one inbox still has a tight limit with remaining cooldown", async () => {
        const ip = "retry-" + ++sequence, email = `retry-${sequence}@example.test`;
        for (let i = 0; i < 5; i++)
            expect((await POST(request(ip, { email }))).status).toBe(200);
        const response = await POST(request(ip, { email }));
        expect(response.status).toBe(429);
        expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(createMagicToken).toHaveBeenCalledTimes(5);
    });
    it("malformed traffic does not consume a plant recipient's requests", async () => {
        const ip = "invalid-" + ++sequence;
        for (let i = 0; i < 10; i++)
            expect((await POST(request(ip, null))).status).toBe(400);
        expect((await POST(request(ip))).status).toBe(200);
    });
    it("provider rejection does not claim sent or expose bearer data", async () => { vi.mocked(fetch).mockResolvedValue(new Response("synthetic-single-use-token", { status: 500 })); const result = await POST(request()); expect(result.status).toBe(200); expect(JSON.stringify(await result.json())).not.toContain("synthetic-single-use-token"); });
    it.each([false, true])("same private response for known and unknown login, known=%s", async (known) => {
        vi.mocked(findUserByEmail).mockResolvedValue(known ? { id: "existing", status: "approved", plan: "technician_free" } as never : null);
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(fetch).toHaveBeenCalledTimes(known ? 1 : 0);
    });
    it.each([false, true])("same private pilot response and recipient cooldown, known=%s", async (known) => {
        vi.mocked(findUserByEmail).mockResolvedValue(known ? { id: "existing", status: "approved", plan: "technician_free" } as never : null);
        const address = `private-pilot-${++sequence}@example.test`, ip = "private-network-" + sequence;
        for (let n = 0; n < 5; n++) {
            const response = await onboarding(request(ip, { email: address, intent: "pilot", accepted: true, agreementVersion: ONBOARDING_VERSION }));
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ ok: true });
        }
        const limited = await onboarding(request(ip, { email: address, intent: "pilot", accepted: true, agreementVersion: ONBOARDING_VERSION }));
        expect(limited.status).toBe(429);
        expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(fetch).toHaveBeenCalledTimes(known ? 0 : 5);
    });
    it.each([false, true])("new email links carry credentials only in a fragment, onboarding=%s", async (setup) => {
        if (setup)
            vi.mocked(findUserByEmail).mockResolvedValue(null);
        const response = await (setup ? onboarding(request(undefined, { email: `fragment-${++sequence}@example.test`, intent: "technician", accepted: true, agreementVersion: ONBOARDING_VERSION })) : POST(request()));
        expect(response.status).toBe(200);
        const payload = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
        const link = new URL(payload.html.match(/href="([^"]+)"/)[1]);
        expect(link.hash).toBe("#token=synthetic-single-use-token");
        expect(link.pathname + link.search).not.toContain("synthetic-single-use-token");
        expect(await response.json()).toEqual({ ok: true });
    });
});
