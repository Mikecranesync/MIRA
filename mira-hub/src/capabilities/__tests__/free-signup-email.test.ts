import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/users", () => ({ createMagicToken: vi.fn(async () => "synthetic-single-use-token") }));
import { createMagicToken } from "@/lib/users";
import { POST } from "@/app/(hub)/api/auth/magic-link/route";

let count = 0;
function request(ip = "email-test-" + ++count, body: unknown = { email: "synthetic@example.test" }) {
  return new Request("https://app.factorylm.com/api/auth/magic-link/", { method: "POST", headers: {"Content-Type":"application/json", "x-real-ip":ip}, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("RESEND_API_KEY", "synthetic-local-test-key"); vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {status:200}))); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("verified-email signup delivery", () => {
  it("reports unavailable delivery without creating or logging a token", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const log = vi.spyOn(console,"log");
    expect((await POST(request())).status).toBe(503);
    expect(createMagicToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
  it("acknowledges only actual provider acceptance, without returning the bearer link", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok:true});
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain("synthetic-single-use-token");
  });
  it("does not claim sent or log a provider response that can contain credentials", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("synthetic-single-use-token",{status:500}));
    const log = vi.spyOn(console,"error").mockImplementation(()=>{});
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic-single-use-token");
    expect(log.mock.calls.flat().map(String).join(" ")).not.toContain("synthetic-single-use-token");
  });
  it("limits repeated email requests without issuing another credential", async () => {
    const ip = "rate-test-" + ++count;
    for (let i=0;i<5;i++) expect((await POST(request(ip))).status).toBe(200);
    expect((await POST(request(ip))).status).toBe(429);
    expect(createMagicToken).toHaveBeenCalledTimes(5);
  });
  it("rejects malformed input before issuing a credential", async () => {
    expect((await POST(request(undefined,null))).status).toBe(400);
    expect(createMagicToken).not.toHaveBeenCalled();
  });
});
