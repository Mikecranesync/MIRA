import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";
import { isCheckoutEnabled } from "./checkout-gate";
import fs from "node:fs";
import path from "node:path";

describe("isCheckoutEnabled — kill switch while pilots are free (#4369)", () => {
  test("default OFF when unset", () => {
    expect(isCheckoutEnabled({})).toBe(false);
  });
  test("OFF for any value other than exactly '1' or 'true'", () => {
    expect(isCheckoutEnabled({ PLG_CHECKOUT_ENABLED: "0" })).toBe(false);
    expect(isCheckoutEnabled({ PLG_CHECKOUT_ENABLED: "false" })).toBe(false);
    expect(isCheckoutEnabled({ PLG_CHECKOUT_ENABLED: "TRUE" })).toBe(false);
    expect(isCheckoutEnabled({ PLG_CHECKOUT_ENABLED: " 1" })).toBe(false);
    expect(isCheckoutEnabled({ PLG_CHECKOUT_ENABLED: "yes" })).toBe(false);
  });
  test("ON for exactly '1' or 'true'", () => {
    expect(isCheckoutEnabled({ PLG_CHECKOUT_ENABLED: "1" })).toBe(true);
    expect(isCheckoutEnabled({ PLG_CHECKOUT_ENABLED: "true" })).toBe(true);
  });
});

describe("checkout gate wired the same way the real handler reads it", () => {
  // Mirrors the exact guard added to the top of the real
  // app.post("/api/checkout/start", ...) handler in server.ts, so this
  // proves the shape of the integration (410 + zero downstream calls when
  // off; both downstream calls reached when on) without importing server.ts
  // itself — server.ts runs a NeonDB schema migration and starts the drip
  // scheduler at module load (see deploy-identity.ts), which would mock.module
  // its whole dependency graph and pollute the rest of the bun suite.
  function buildApp(createTenant: () => unknown, createCheckoutSession: () => unknown) {
    const app = new Hono();
    app.post("/api/checkout/start", async (c) => {
      if (!isCheckoutEnabled()) {
        return c.json(
          {
            error:
              "Online checkout is not available. FactoryLM pilots are free for 30 days — apply at https://app.factorylm.com/signup",
          },
          410
        );
      }
      createTenant();
      createCheckoutSession();
      return c.json({ url: "https://checkout.stripe.com/fake" });
    });
    return app;
  }

  test("default env → 410 with the exact apply-link body, no createTenant/createCheckoutSession call", async () => {
    delete process.env.PLG_CHECKOUT_ENABLED;
    const createTenant = mock(() => {});
    const createCheckoutSession = mock(() => {});
    const app = buildApp(createTenant, createCheckoutSession);

    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "prospect@example.com" }),
    });

    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json).toEqual({
      error:
        "Online checkout is not available. FactoryLM pilots are free for 30 days — apply at https://app.factorylm.com/signup",
    });
    expect(createTenant).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  test("PLG_CHECKOUT_ENABLED=1 → existing behavior reached (both downstream calls made)", async () => {
    process.env.PLG_CHECKOUT_ENABLED = "1";
    const createTenant = mock(() => {});
    const createCheckoutSession = mock(() => {});
    const app = buildApp(createTenant, createCheckoutSession);

    const res = await app.request("/api/checkout/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "prospect@example.com" }),
    });

    expect(res.status).toBe(200);
    expect(createTenant).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    delete process.env.PLG_CHECKOUT_ENABLED;
  });
});

describe("the real server.ts wiring — guards against the gate being removed from the actual route", () => {
  const serverSrc = fs.readFileSync(
    path.join(import.meta.dir, "..", "server.ts"),
    "utf8"
  );

  test("checkout-gate is imported", () => {
    expect(serverSrc).toContain(
      'import { isCheckoutEnabled } from "./capabilities/checkout-gate.js";'
    );
  });

  test("/api/checkout/start checks isCheckoutEnabled() before anything else in the handler", () => {
    const marker = 'app.post("/api/checkout/start", async (c) => {';
    const idx = serverSrc.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);

    const rateLimiterIdx = serverSrc.indexOf("checkRegisterRateLimit(ip)", idx);
    const gateIdx = serverSrc.indexOf("isCheckoutEnabled()", idx);
    const createTenantIdx = serverSrc.indexOf("await createTenant(", idx);
    const checkoutSessionIdx = serverSrc.indexOf("await createCheckoutSession(", idx);

    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(rateLimiterIdx);
    expect(gateIdx).toBeLessThan(createTenantIdx);
    expect(gateIdx).toBeLessThan(checkoutSessionIdx);
  });

  test("/api/stripe/webhook is not gated by checkout-gate", () => {
    const webhookMarker = 'app.post("/api/stripe/webhook", async (c) => {';
    const webhookIdx = serverSrc.indexOf(webhookMarker);
    expect(webhookIdx).toBeGreaterThan(-1);

    // The next occurrence of isCheckoutEnabled() after the webhook handler
    // opens must belong to a LATER route, not this one — i.e. there is no
    // isCheckoutEnabled() call between the webhook's opening brace and its
    // first real statement (signature header read).
    const sigHeaderIdx = serverSrc.indexOf('c.req.header("stripe-signature")', webhookIdx);
    const nextGateIdx = serverSrc.indexOf("isCheckoutEnabled()", webhookIdx);
    expect(sigHeaderIdx).toBeGreaterThan(webhookIdx);
    expect(nextGateIdx === -1 || nextGateIdx > sigHeaderIdx).toBe(true);
  });
});
