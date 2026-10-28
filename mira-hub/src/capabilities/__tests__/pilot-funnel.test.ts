/**
 * #4877 — pilot-application attribution, funnel events, owner notification.
 * Run: npx vitest run src/capabilities/__tests__/pilot-funnel.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));

import pool from "@/lib/db";
import {
  attributionFromRequest,
  captureFunnelEvent,
  handlePilotApplicationSubmitted,
  isPilotApprovalRequired,
  notifyOwnerOfApplication,
  recordPilotApplication,
} from "../pilot-funnel";

const mockPoolQuery = vi.mocked(pool.query) as unknown as Mock;

let mockFetch: Mock;
const ENV_KEYS = ["PLG_POSTHOG_KEY", "PLG_POSTHOG_HOST", "RESEND_API_KEY", "PILOT_OWNER_EMAIL", "MIRA_PILOT_APPROVAL_REQUIRED"];

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  vi.clearAllMocks();
  clearEnv();
  mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  clearEnv();
});

// ---------------------------------------------------------------------------
// attributionFromRequest
// ---------------------------------------------------------------------------

describe("attributionFromRequest", () => {
  it("parses utm_* and gclid/fbclid presence from the Referer URL query string", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/", {
      headers: {
        referer:
          "https://app.factorylm.com/signup?utm_source=google&utm_medium=cpc&utm_campaign=pilot-launch&gclid=abc123",
      },
    });
    const a = attributionFromRequest(req);
    expect(a.utmSource).toBe("google");
    expect(a.utmMedium).toBe("cpc");
    expect(a.utmCampaign).toBe("pilot-launch");
    expect(a.hasGclid).toBe(true);
    expect(a.hasFbclid).toBe(false);
  });

  it("never stores the gclid/fbclid value itself — presence only", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/", {
      headers: { referer: "https://app.factorylm.com/signup?gclid=super-secret-click-id&fbclid=another-secret" },
    });
    const a = attributionFromRequest(req);
    expect(a.hasGclid).toBe(true);
    expect(a.hasFbclid).toBe(true);
    expect(JSON.stringify(a)).not.toContain("super-secret-click-id");
    expect(JSON.stringify(a)).not.toContain("another-secret");
  });

  it("accepts the same fields from the JSON body when present", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/");
    const a = attributionFromRequest(req, { utm_source: "bing", utm_campaign: "fall-ads", gclid: "x" });
    expect(a.utmSource).toBe("bing");
    expect(a.utmCampaign).toBe("fall-ads");
    expect(a.hasGclid).toBe(true);
  });

  it("prefers body fields over Referer when both are present", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/", {
      headers: { referer: "https://app.factorylm.com/signup?utm_source=referer-value" },
    });
    const a = attributionFromRequest(req, { utm_source: "body-value" });
    expect(a.utmSource).toBe("body-value");
  });

  it("falls back to Referer for fields the body omits", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/", {
      headers: { referer: "https://app.factorylm.com/signup?utm_source=referer-value&utm_medium=organic" },
    });
    const a = attributionFromRequest(req, { utm_source: "body-value" });
    expect(a.utmSource).toBe("body-value");
    expect(a.utmMedium).toBe("organic");
  });

  it("strips unsafe characters and caps length (charset-sanitize + length-cap)", () => {
    const junk = "<script>".repeat(50) + "a";
    const req = new Request("https://app.factorylm.com/api/auth/register/");
    const a = attributionFromRequest(req, { utm_source: junk });
    expect(a.utmSource).not.toBeNull();
    expect(a.utmSource).not.toContain("<");
    expect(a.utmSource).not.toContain(">");
    expect(a.utmSource!.length).toBeLessThanOrEqual(128);
  });

  it("returns all-null/false for a request with no Referer and no body fields", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/");
    const a = attributionFromRequest(req);
    expect(a).toEqual({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      hasGclid: false,
      hasFbclid: false,
    });
  });

  it("does not throw on a malformed Referer header", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/", {
      headers: { referer: "not a url" },
    });
    expect(() => attributionFromRequest(req)).not.toThrow();
  });

  it("ignores a non-object body without throwing", () => {
    const req = new Request("https://app.factorylm.com/api/auth/register/");
    expect(() => attributionFromRequest(req, "not an object")).not.toThrow();
    expect(() => attributionFromRequest(req, null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// captureFunnelEvent
// ---------------------------------------------------------------------------

describe("captureFunnelEvent", () => {
  it("is a no-op when PLG_POSTHOG_KEY is unset", () => {
    captureFunnelEvent("pilot_application_submitted", "tenant-1");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts to POSTHOG_HOST/capture/ with the api key, event, and distinct_id when key is set", () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    captureFunnelEvent("pilot_application_submitted", "tenant-1", { utm_source: "google" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.api_key).toBe("phk_test");
    expect(body.event).toBe("pilot_application_submitted");
    expect(body.distinct_id).toBe("tenant-1");
    expect(body.properties.utm_source).toBe("google");
  });

  it("respects PLG_POSTHOG_HOST override", () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    process.env.PLG_POSTHOG_HOST = "https://eu.i.posthog.com";
    captureFunnelEvent("pilot_application_submitted", "tenant-1");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://eu.i.posthog.com/capture/");
  });

  it("never includes email, name, or free text in the serialized payload (PII allowlist)", () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    captureFunnelEvent("pilot_application_submitted", "tenant-1", {
      utm_source: "google",
      has_gclid: true,
    });
    const [, init] = mockFetch.mock.calls[0];
    const raw = (init as RequestInit).body as string;
    expect(raw).not.toContain("@");
    expect(raw.toLowerCase()).not.toContain("email");
    expect(raw.toLowerCase()).not.toContain("acme"); // a stand-in company/tenant free-text name
  });

  it("never throws when fetch rejects (network failure)", () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    mockFetch.mockRejectedValue(new Error("network down"));
    expect(() => captureFunnelEvent("pilot_application_submitted", "tenant-1")).not.toThrow();
  });

  it("never throws when fetch itself throws synchronously", () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    mockFetch.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => captureFunnelEvent("pilot_application_submitted", "tenant-1")).not.toThrow();
  });

  it("is a no-op with an empty distinctId even if the key is set", () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    captureFunnelEvent("pilot_application_submitted", "");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// notifyOwnerOfApplication
// ---------------------------------------------------------------------------

describe("notifyOwnerOfApplication", () => {
  const notice = {
    email: "tech@acme-plant.com",
    name: "Jordan Tech",
    tenantId: "tenant-123",
    tenantName: "Acme Plant",
    attribution: {
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      hasGclid: true,
      hasFbclid: false,
    },
  };

  it("is a no-op when RESEND_API_KEY is unset", async () => {
    await notifyOwnerOfApplication(notice);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts to Resend with the default owner address when PILOT_OWNER_EMAIL is unset", async () => {
    process.env.RESEND_API_KEY = "re_test";
    await notifyOwnerOfApplication(notice);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toEqual(["mike@factorylm.com"]);
    expect(body.from).toBe("FactoryLM <noreply@factorylm.com>");
  });

  it("uses PILOT_OWNER_EMAIL when set", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.PILOT_OWNER_EMAIL = "owner@example.com";
    await notifyOwnerOfApplication(notice);
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.to).toEqual(["owner@example.com"]);
  });

  it("includes the approval route as plain text, not a link (clicking would GET, not POST)", async () => {
    process.env.RESEND_API_KEY = "re_test";
    await notifyOwnerOfApplication(notice);
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.html).toContain("POST /api/admin/pilots/tenant-123/approve");
    expect(body.html).not.toMatch(/<a[^>]*href="[^"]*approve/);
  });

  it("HTML-escapes applicant-controlled free text", async () => {
    process.env.RESEND_API_KEY = "re_test";
    await notifyOwnerOfApplication({
      ...notice,
      name: '<img src=x onerror=alert(1)>',
      tenantName: "Acme & <Sons>",
    });
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.html).not.toContain("<img src=x");
    expect(body.html).toContain("&lt;img");
    expect(body.html).toContain("Acme &amp; &lt;Sons&gt;");
  });

  it("never throws on a Resend network failure", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockFetch.mockRejectedValue(new Error("resend is down"));
    await expect(notifyOwnerOfApplication(notice)).resolves.toBeUndefined();
  });

  it("never throws on a Resend non-2xx response", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "server error" });
    await expect(notifyOwnerOfApplication(notice)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isPilotApprovalRequired
// ---------------------------------------------------------------------------

describe("isPilotApprovalRequired", () => {
  it("is false by default", () => {
    expect(isPilotApprovalRequired()).toBe(false);
  });

  it("is true only for the exact string '1'", () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    expect(isPilotApprovalRequired()).toBe(true);
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "true";
    expect(isPilotApprovalRequired()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordPilotApplication
// ---------------------------------------------------------------------------

describe("recordPilotApplication", () => {
  const attribution = {
    utmSource: "google",
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    hasGclid: false,
    hasFbclid: false,
  };

  it("inserts and returns the new row id", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: "row-1" }] });
    const id = await recordPilotApplication({ tenantId: "t1", userId: "u1", attribution });
    expect(id).toBe("row-1");
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (tenant_id) DO NOTHING"),
      ["t1", "u1", "google", null, null, null, null, false, false],
    );
  });

  it("returns null (no throw) when the insert is a no-op duplicate", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });
    const id = await recordPilotApplication({ tenantId: "t1", userId: "u1", attribution });
    expect(id).toBeNull();
  });

  it("propagates a genuine DB error to the caller", async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error("connection reset"));
    await expect(recordPilotApplication({ tenantId: "t1", userId: "u1", attribution })).rejects.toThrow(
      "connection reset",
    );
  });
});

// ---------------------------------------------------------------------------
// handlePilotApplicationSubmitted — orchestration
// ---------------------------------------------------------------------------

describe("handlePilotApplicationSubmitted", () => {
  const baseInput = {
    tenantId: "tenant-1",
    userId: "user-1",
    email: "tech@acme.com",
    name: "Jordan",
    tenantName: "Acme Plant",
    attribution: {
      utmSource: "google",
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      hasGclid: false,
      hasFbclid: false,
    },
  };

  it("inserts, captures the event, and emails the owner when approval is required", async () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: "row-1" }] });

    await handlePilotApplicationSubmitted(baseInput);

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    // one posthog capture + one resend call
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const urls = mockFetch.mock.calls.map((c) => c[0]);
    expect(urls).toContain("https://us.i.posthog.com/capture/");
    expect(urls).toContain("https://api.resend.com/emails");
  });

  it("skips the owner email when approval is not required, but still captures the event", async () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    process.env.RESEND_API_KEY = "re_test";
    // MIRA_PILOT_APPROVAL_REQUIRED unset => off
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: "row-1" }] });

    await handlePilotApplicationSubmitted(baseInput);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://us.i.posthog.com/capture/");
  });

  it("skips the event and the owner email on a genuine duplicate (no-op insert)", async () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING, no row

    await handlePilotApplicationSubmitted(baseInput);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("still captures the event and emails the owner when the insert throws", async () => {
    process.env.PLG_POSTHOG_KEY = "phk_test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    mockPoolQuery.mockRejectedValueOnce(new Error("db is down"));

    await expect(handlePilotApplicationSubmitted(baseInput)).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("never throws even when everything fails", async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error("db is down"));
    mockFetch.mockRejectedValue(new Error("network down"));
    await expect(handlePilotApplicationSubmitted(baseInput)).resolves.toBeUndefined();
  });
});
