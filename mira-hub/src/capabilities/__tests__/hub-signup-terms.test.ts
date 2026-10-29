/**
 * #4902 — Hub signup records consent version + timestamp.
 *
 * Lives under src/capabilities/__tests__/ (not src/lib/__tests__ or next to
 * the route) because those paths are Lifecycle-Guard protected.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientQuery = vi.fn();
const clientRelease = vi.fn();
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(async () => ({ query: clientQuery, release: clientRelease })),
  },
}));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));

import pool from "@/lib/db";
import { ensureUserAndTenant } from "@/lib/users";
import {
  HUB_SIGNUP_TERMS_CURRENT,
  HUB_SIGNUP_TERMS_V1,
  currentSignupTermsConsent,
} from "../hub-signup-terms";

const HUB_ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(HUB_ROOT, rel), "utf8");

/** Rendered text of the Terms/Privacy <p> on the signup page. */
function renderedSignupTermsSentence(): string {
  const src = read("src/app/signup/page.tsx");
  const anchor = src.indexOf("Terms / Privacy");
  expect(anchor, "Terms / Privacy block not found in signup page").toBeGreaterThan(-1);
  const start = src.indexOf("<p", anchor);
  const end = src.indexOf("</p>", start);
  expect(start).toBeGreaterThan(anchor);
  expect(end).toBeGreaterThan(start);
  const inner = src.slice(src.indexOf(">", start) + 1, end);
  return inner
    .replace(/\{"\s*"\}/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

describe("hub signup terms registry", () => {
  it("rendered signup sentence matches the current registry text (drift pin)", () => {
    const rendered = renderedSignupTermsSentence();
    expect(rendered.length).toBeGreaterThan(20);
    expect(rendered).toBe(HUB_SIGNUP_TERMS_CURRENT.text);
  });

  it("v1 sha256 is the sha of its exact text, and v1 is pinned", () => {
    const sha = createHash("sha256").update(HUB_SIGNUP_TERMS_V1.text, "utf8").digest("hex");
    expect(HUB_SIGNUP_TERMS_V1.sha256).toBe(sha);
    expect(HUB_SIGNUP_TERMS_V1.sha256).toBe(
      "d96565a2ceabab067df6e83493df836974c38fcd2c0f458656fc6127a3881dc8",
    );
    expect(HUB_SIGNUP_TERMS_V1.version).toBe("hub-signup-terms-v1");
    expect(HUB_SIGNUP_TERMS_V1.firstShownCommit).toBe("64e156c97");
    expect(currentSignupTermsConsent()).toEqual({
      version: HUB_SIGNUP_TERMS_CURRENT.version,
      sha256: HUB_SIGNUP_TERMS_CURRENT.sha256,
    });
  });
});

describe("migration 109 is additive and never back-fills", () => {
  const sql = read("db/migrations/109_hub_users_terms_consent.sql");
  const body = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("adds exactly the three nullable columns idempotently in one transaction", () => {
    expect(body).toMatch(/^\s*BEGIN;/m);
    expect(body).toMatch(/^\s*COMMIT;/m);
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS terms_version TEXT;/);
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS terms_sha256 TEXT;/);
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;/);
    expect(body.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(3);
  });

  it("has no DEFAULT, NOT NULL, UPDATE or INSERT (existing rows stay NULL)", () => {
    expect(body).not.toMatch(/\bDEFAULT\b/i);
    expect(body).not.toMatch(/\bNOT\s+NULL\b/i);
    expect(body).not.toMatch(/\bUPDATE\b/i);
    expect(body).not.toMatch(/\bINSERT\b/i);
  });
});

describe("ensureUserAndTenant records consent only for new accounts", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poolQuery = (pool as any).query as ReturnType<typeof vi.fn>;
  const prevFlag = process.env.MIRA_PILOT_APPROVAL_REQUIRED;

  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [] }); // schema + findUserByEmail → no user
    clientQuery.mockImplementation(async (sql: string) => {
      if (/INSERT INTO hub_tenants/.test(sql)) return { rows: [{ id: "tenant-1" }] };
      if (/INSERT INTO hub_users/.test(sql)) return { rows: [{ id: "user-1", email: "a@b.co" }] };
      return { rows: [] };
    });
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.MIRA_PILOT_APPROVAL_REQUIRED;
    else process.env.MIRA_PILOT_APPROVAL_REQUIRED = prevFlag;
  });

  function userInsert(): { sql: string; params: unknown[] } {
    const call = clientQuery.mock.calls.find((a) => /INSERT INTO hub_users/.test(String(a[0])));
    if (!call) throw new Error("no hub_users INSERT");
    return { sql: String(call[0]), params: (call[1] as unknown[]) ?? [] };
  }
  const consent = { version: "hub-signup-terms-v1", sha256: HUB_SIGNUP_TERMS_V1.sha256 };

  it("ensureSchema adds the three consent columns without a DEFAULT", async () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "0";
    await ensureUserAndTenant({ email: "a@b.co", passwordHash: "h", termsConsent: consent });
    const alters = poolQuery.mock.calls.map((a) => String(a[0])).filter((s) => /terms_/.test(s));
    expect(alters).toEqual([
      "ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS terms_version TEXT",
      "ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS terms_sha256 TEXT",
      "ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ",
    ]);
  });

  for (const flag of ["0", "1"] as const) {
    const mode = flag === "1" ? "pilot" : "trial";

    it(`${mode} branch: writes version + sha and NOW() when consent supplied`, async () => {
      process.env.MIRA_PILOT_APPROVAL_REQUIRED = flag;
      await ensureUserAndTenant({ email: "a@b.co", passwordHash: "h", termsConsent: consent });
      const { sql, params } = userInsert();
      expect(sql).toMatch(/terms_version, terms_sha256, terms_accepted_at\)/);
      const vIdx = flag === "1" ? 6 : 7;
      expect(sql).toContain(`$${vIdx}::text, $${vIdx + 1}::text, CASE WHEN $${vIdx}::text IS NULL THEN NULL ELSE NOW() END`);
      expect(params[vIdx - 1]).toBe("hub-signup-terms-v1");
      expect(params[vIdx]).toBe(HUB_SIGNUP_TERMS_V1.sha256);
      expect(params).toHaveLength(vIdx + 1);
    });

    it(`${mode} branch control: no consent → version and sha params are NULL`, async () => {
      process.env.MIRA_PILOT_APPROVAL_REQUIRED = flag;
      await ensureUserAndTenant({ email: "a@b.co", passwordHash: "h" });
      const { params } = userInsert();
      const vIdx = flag === "1" ? 6 : 7;
      expect(params[vIdx - 1]).toBeNull();
      expect(params[vIdx]).toBeNull();
    });
  }

  it("existing account: no INSERT and no consent write", async () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "0";
    poolQuery.mockImplementation(async (sql: string) =>
      /FROM hub_users WHERE email_lower/.test(sql)
        ? { rows: [{ id: "u0", email: "a@b.co", tenant_id: "t0", role: "owner", status: "trial", preferences: {} }] }
        : { rows: [] },
    );
    const r = await ensureUserAndTenant({ email: "a@b.co", passwordHash: "h", termsConsent: consent });
    expect(r.id).toBe("u0");
    expect(clientQuery).not.toHaveBeenCalled();
    const writes = poolQuery.mock.calls.map((a) => String(a[0])).filter((s) => /UPDATE hub_users/.test(s));
    expect(writes.some((s) => /terms_/.test(s))).toBe(false);
  });
});

describe("register route passes the current registry consent", () => {
  it("calls ensureUserAndTenant with currentSignupTermsConsent()", async () => {
    vi.resetModules();
    const ensure = vi.fn<(input: Record<string, unknown>) => Promise<{ id: string; tenantId: string; email: string }>>(
      async () => ({ id: "u1", tenantId: "t1", email: "new@example.com" }),
    );
    vi.doMock("@/lib/users", () => ({ ensureUserAndTenant: ensure, findUserByEmail: vi.fn(async () => null) }));
    vi.doMock("@/capabilities/pilot-funnel", () => ({
      attributionFromRequest: vi.fn(() => ({})),
      handlePilotApplicationSubmitted: vi.fn(async () => undefined),
    }));
    vi.doMock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed") } }));
    const prevDb = process.env.NEON_DATABASE_URL;
    const prevHs = process.env.HUBSPOT_API_KEY;
    process.env.NEON_DATABASE_URL = "postgres://test";
    delete process.env.HUBSPOT_API_KEY;
    try {
      const { POST } = await import("@/app/api/auth/register/route");
      const res = await POST(
        new Request("http://x/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
          body: JSON.stringify({ email: "new@example.com", password: "longenough123", name: "N" }),
        }),
      );
      expect(res.status).toBe(201);
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(ensure.mock.calls[0][0]).toMatchObject({
        email: "new@example.com",
        termsConsent: { version: "hub-signup-terms-v1", sha256: HUB_SIGNUP_TERMS_V1.sha256 },
      });
    } finally {
      if (prevDb === undefined) delete process.env.NEON_DATABASE_URL;
      else process.env.NEON_DATABASE_URL = prevDb;
      if (prevHs !== undefined) process.env.HUBSPOT_API_KEY = prevHs;
      vi.doUnmock("@/lib/users");
      vi.doUnmock("@/capabilities/pilot-funnel");
      vi.doUnmock("bcryptjs");
    }
  });
});
