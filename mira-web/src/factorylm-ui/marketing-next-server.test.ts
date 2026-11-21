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

  test("rollout off: a rollout-only alias is not claimed, so legacy normalization is unchanged", async () => {
    delete process.env.FACTORYLM_MARKETING_NEXT;
    process.env.MIRA_FREE_TECHNICIANS = "false";
    const res = await app.request("https://factorylm.com/mira/", { headers: { host: "factorylm.com" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://factorylm.com/mira");
  });
});
