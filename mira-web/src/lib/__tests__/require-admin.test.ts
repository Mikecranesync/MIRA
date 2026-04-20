// mira-web/src/lib/__tests__/require-admin.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { requireAdmin, signToken } from "../auth.js";

beforeAll(() => {
  // PLG_JWT_SECRET is not in Doppler dev. Inject a deterministic test secret
  // so this suite runs under --config dev and in ad-hoc local runs.
  process.env.PLG_JWT_SECRET ??= "test-secret-for-require-admin-tests";
});

function appWith() {
  const app = new Hono();
  app.get("/admin-only", requireAdmin, (c) => c.json({ ok: true }));
  return app;
}

async function token(role: "ADMIN" | "USER"): Promise<string> {
  return await signToken({
    tenantId: "00000000-0000-0000-0000-000000000001",
    email: "t@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: role,
  });
}

describe("requireAdmin", () => {
  test("401 without auth", async () => {
    const app = appWith();
    const res = await app.request("/admin-only");
    expect(res.status).toBe(401);
  });

  test("403 for USER role", async () => {
    const app = appWith();
    const res = await app.request("/admin-only", {
      headers: { Authorization: `Bearer ${await token("USER")}` },
    });
    expect(res.status).toBe(403);
  });

  test("200 for ADMIN role", async () => {
    const app = appWith();
    const res = await app.request("/admin-only", {
      headers: { Authorization: `Bearer ${await token("ADMIN")}` },
    });
    expect(res.status).toBe(200);
  });
});
