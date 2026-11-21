import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createFactorylmMarketingRouter } from "./marketing-next";

const priorFlag = process.env.FACTORYLM_MARKETING_NEXT;
const priorHub = process.env.PLG_HUB_URL;
const priorFree = process.env.MIRA_FREE_TECHNICIANS;
beforeEach(() => { process.env.MIRA_FREE_TECHNICIANS = "true"; });
afterEach(() => {
  if (priorFlag === undefined) delete process.env.FACTORYLM_MARKETING_NEXT;
  else process.env.FACTORYLM_MARKETING_NEXT = priorFlag;
  if (priorHub === undefined) delete process.env.PLG_HUB_URL;
  else process.env.PLG_HUB_URL = priorHub;
  if (priorFree === undefined) delete process.env.MIRA_FREE_TECHNICIANS;
  else process.env.MIRA_FREE_TECHNICIANS = priorFree;
});

function app() {
  return new Hono().route("/", createFactorylmMarketingRouter()).all("*", (c) =>
    c.json({ upstream: true, path: c.req.path, method: c.req.method }));
}

describe("next FactoryLM public adapter", () => {
  test("does not publish the free offer while the free-access rollout is disabled", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.MIRA_FREE_TECHNICIANS = "false";
    expect(await (await app().request("/")).json()).toMatchObject({ upstream: true });
  });
  test("default off preserves the current website", async () => {
    delete process.env.FACTORYLM_MARKETING_NEXT;
    const response = await app().request("/");
    expect(await response.json()).toMatchObject({ upstream: true });
    expect(response.headers.get("x-factorylm-site")).toBeNull();
  });

  test("serves the checked marketing page with real account handoff and no preview signup", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    delete process.env.PLG_HUB_URL;
    const response = await app().request("/");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-factorylm-site")).toMatch(/^next-[a-f0-9]{16}$/);
    expect(html).toContain('href="https://app.factorylm.com/signup/"');
    expect(html).toContain("Free for technicians");
    expect(html).not.toContain("data-preview-form");
    expect(html).not.toContain("data-preview-bar");
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(html)));
  });

  test("staging signup/login go only to the configured staging app and cannot be indexed", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    process.env.PLG_HUB_URL = "https://app-staging.factorylm.com";
    const response = await app().request("/start");
    const html = await response.text();
    expect(html).toContain("https://app-staging.factorylm.com/signup/");
    expect(html).toContain("https://app-staging.factorylm.com/login/");
    expect(html).not.toContain("https://app.factorylm.com/signup/");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(html)));
  });

  test("HEAD returns the same page length and no body", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const server = app();
    const get = await server.request("/mira");
    const head = await server.request("/mira", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(get.headers.get("content-length"));
    expect(await head.text()).toBe("");
  });

  test("legacy redirects preserve campaign query strings", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request("/pricing?utm_source=maintenance");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/demo?utm_source=maintenance");
  });

  test.each(["/api/health", "/api/stripe/webhook", "/privacy", "/terms", "/security", "/trust", "/status", "/cmms", "/signup", "/sitemap.xml", "/blog/fault-codes"])("leaves %s with its existing handler", async (path) => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request(path);
    expect(await response.json()).toMatchObject({ upstream: true, path });
  });

  test("POST remains POST and reaches the existing API handler", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request("/api/stripe/webhook", { method: "POST", body: "test-event" });
    expect(await response.json()).toMatchObject({ upstream: true, method: "POST" });
  });

  test("exposes only allowlisted assets and serves a real 404 for missing ones", async () => {
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    const response = await app().request("/factorylm-next-assets/site.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    const missing = await app().request("/factorylm-next-assets/private-notes.json");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("This page isn’t on the floor");
  });

  test("disabling the flag immediately restores upstream rendering", async () => {
    const server = app();
    process.env.FACTORYLM_MARKETING_NEXT = "true";
    expect((await server.request("/")).headers.has("x-factorylm-site")).toBe(true);
    process.env.FACTORYLM_MARKETING_NEXT = "false";
    expect(await (await server.request("/")).json()).toMatchObject({ upstream: true });
  });
});
