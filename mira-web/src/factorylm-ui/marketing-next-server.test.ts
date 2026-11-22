/**
 * Codex F33 (#5747): marketing aliases through the FULL web server middleware
 * stack. Generic trailing-slash normalization used to run first and answer a
 * staging slash alias with a cacheable 301 to the production host. The bounded
 * adapter now answers its own aliases first: same origin, 302, no-store.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { app } from "../server.js";

const prior = { next: process.env.FACTORYLM_MARKETING_NEXT, free: process.env.MIRA_FREE_TECHNICIANS };
afterEach(() => {
  if (prior.next === undefined) delete process.env.FACTORYLM_MARKETING_NEXT;
  else process.env.FACTORYLM_MARKETING_NEXT = prior.next;
  if (prior.free === undefined) delete process.env.MIRA_FREE_TECHNICIANS;
  else process.env.MIRA_FREE_TECHNICIANS = prior.free;
});

const STAGING = "https://staging-web.factorylm.test";

function expectSameOriginAlias(res: Response, location: string) {
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(location);
  expect(res.headers.get("cache-control")).toBe("no-store");
}

describe("marketing aliases through the full server", () => {
  test("rollout off: the staging policy slash alias stays on staging, keeps its query, 302 no-store", async () => {
    delete process.env.FACTORYLM_MARKETING_NEXT;
    process.env.MIRA_FREE_TECHNICIANS = "false";
    const res = await app.request(`${STAGING}/free-technicians/?check=1`, { headers: { host: "staging-web.factorylm.test" } });
    expectSameOriginAlias(res, "/free-technicians?check=1");
  });

  test("rollout on: a rollout-only slash alias is also same-origin 302 no-store", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.MIRA_FREE_TECHNICIANS = "true";
    const res = await app.request(`${STAGING}/mira/?x=1`, { headers: { host: "staging-web.factorylm.test" } });
    expectSameOriginAlias(res, "/mira?x=1");
  });

  test.each([["/pricing/?check=1"], ["/pilot/?check=1"], ["/pricing//?check=1"]])(
    "rollout on: slash variant %s of a manifest alias stays on staging, 302 no-store", async (path) => {
      process.env.FACTORYLM_MARKETING_NEXT = "true";
      process.env.MIRA_FREE_TECHNICIANS = "true";
      const res = await app.request(`${STAGING}${path}`, { headers: { host: "staging-web.factorylm.test" } });
      expectSameOriginAlias(res, "/demo?check=1");
    });

  test("rollout off: /pricing/ is not claimed, so legacy normalization is unchanged", async () => {
    delete process.env.FACTORYLM_MARKETING_NEXT;
    process.env.MIRA_FREE_TECHNICIANS = "false";
    const res = await app.request("https://factorylm.com/pricing/?check=1", { headers: { host: "factorylm.com" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://factorylm.com/pricing?check=1");
  });

  test.each([["/free-technicians.html/?check=1"], ["/free-technicians//?check=1"]])(
    "rollout off: always-on policy slash variant %s stays on staging, 302 no-store", async (path) => {
      delete process.env.FACTORYLM_MARKETING_NEXT;
      process.env.MIRA_FREE_TECHNICIANS = "false";
      const res = await app.request(`${STAGING}${path}`, {
        headers: { host: "internal:3000", "x-forwarded-host": "staging-web.factorylm.test", "x-forwarded-proto": "https" },
      });
      expectSameOriginAlias(res, "/free-technicians?check=1");
    });

  test("rollout on: the app host's /pricing is NOT claimed, so it never redirects into the Hub", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.MIRA_FREE_TECHNICIANS = "true";
    const res = await app.request("https://app.factorylm.com/pricing", { headers: { host: "app.factorylm.com" } });
    expect(res.status).not.toBe(302);
    expect(res.headers.get("location")).toBeNull();
  });

  test("rollout on: a forged X-Forwarded-Host cannot make the app host's /pricing redirect into the Hub (#5775)", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.MIRA_FREE_TECHNICIANS = "true";
    const res = await app.request("https://app.factorylm.com/pricing", {
      headers: { host: "app.factorylm.com", "x-forwarded-host": "factorylm.com", "x-forwarded-proto": "https" },
    });
    expect(res.status).not.toBe(302);
    expect(res.headers.get("location")).toBeNull();
  });

  test("the app ingress sets Host on every route it proxies to this service (#5775)", async () => {
    // onHubHost trusts Host only because the ingress controls it. Every location
    // in the app server block that reaches mira-web (:3200) must set it.
    const conf = await Bun.file(new URL("../../../deployment/nginx-app-factorylm.conf", import.meta.url)).text();
    const blocks = conf.split(/\n\s*location\s/).slice(1).filter((b) => /proxy_pass http:\/\/127\.0\.0\.1:3200/.test(b.split(/\n\s*}/)[0]));
    expect(blocks.length).toBeGreaterThan(5);
    const missing = blocks.map((b) => b.split(/\n\s*}/)[0]).filter((b) => !/proxy_set_header Host \$host;/.test(b));
    expect(missing.map((b) => b.split("\n")[0])).toEqual([]);
  });

  test("rollout on: the marketing host's /pricing still goes to /demo", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.MIRA_FREE_TECHNICIANS = "true";
    const res = await app.request("https://factorylm.com/pricing?check=1", { headers: { host: "factorylm.com" } });
    expectSameOriginAlias(res, "/demo?check=1");
  });

  test("rollout off: a rollout-only alias is not claimed, so legacy normalization is unchanged", async () => {
    delete process.env.FACTORYLM_MARKETING_NEXT;
    process.env.MIRA_FREE_TECHNICIANS = "false";
    const res = await app.request("https://factorylm.com/mira/", { headers: { host: "factorylm.com" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://factorylm.com/mira");
  });
});
