/**
 * pilot-request tests (#4877).
 *
 * DB tests follow the repo's established mock pattern (see
 * lib/__tests__/hub-user-activation.test.ts): mock.module("@neondatabase/serverless")
 * to capture the SQL a helper issues, so no live NeonDB is required.
 *
 * Orchestration tests (submitPilotRequest) use dependency injection instead of
 * mocking the DB/mailer/posthog modules — insert/notifyOwner/capture are
 * injected fakes, so "email failure doesn't drop the row" and "event payload
 * has no PII" are asserted directly against what the orchestrator passes to
 * its collaborators, without touching the network or @neondatabase/serverless.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  validatePilotRequest,
  companyDomainFromEmail,
  submitPilotRequest,
  CONSENT_TEXT_VERSION,
  type ValidPilotRequest,
  type StoredPilotRequest,
} from "./pilot-request";

// ---------------------------------------------------------------------------
// validatePilotRequest — pure, no I/O
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  name: "Jane Tech",
  work_email: "jane@acme-mfg.com",
  company: "Acme Manufacturing",
  equipment: "Allen-Bradley PLCs, Siemens VFDs",
  consent: true,
};

describe("validatePilotRequest", () => {
  test("accepts a complete valid submission", () => {
    const result = validatePilotRequest(VALID_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Jane Tech");
      expect(result.value.workEmail).toBe("jane@acme-mfg.com");
      expect(result.value.company).toBe("Acme Manufacturing");
      expect(result.value.consent).toBe(true);
      expect(result.value.utmSource).toBeNull();
      expect(result.value.referrer).toBeNull();
    }
  });

  test("trims whitespace and defaults missing utm/referrer to null", () => {
    const result = validatePilotRequest({ ...VALID_INPUT, name: "  Jane Tech  " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Jane Tech");
      expect(result.value.utmMedium).toBeNull();
      expect(result.value.utmCampaign).toBeNull();
    }
  });

  test("accepts and trims utm_* and referrer when present", () => {
    const result = validatePilotRequest({
      ...VALID_INPUT,
      utm_source: " google ",
      utm_medium: "cpc",
      utm_campaign: "pilot-launch",
      utm_content: "hero-cta",
      utm_term: "mira ai",
      referrer: "https://google.com/search?q=mira",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.utmSource).toBe("google");
      expect(result.value.utmMedium).toBe("cpc");
      expect(result.value.utmCampaign).toBe("pilot-launch");
      expect(result.value.utmContent).toBe("hero-cta");
      expect(result.value.utmTerm).toBe("mira ai");
      expect(result.value.referrer).toBe("https://google.com/search?q=mira");
    }
  });

  test("rejects when name is missing", () => {
    const { ok, errors } = requireInvalid({ ...VALID_INPUT, name: "" });
    expect(ok).toBe(false);
    expect(errors.join(" ")).toMatch(/name is required/i);
  });

  test("rejects when company is missing", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, company: "   " });
    expect(errors.join(" ")).toMatch(/company is required/i);
  });

  test("rejects an invalid email format", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, work_email: "not-an-email" });
    expect(errors.join(" ")).toMatch(/valid email/i);
  });

  test("rejects when work_email is missing", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, work_email: "" });
    expect(errors.join(" ")).toMatch(/work email is required/i);
  });

  test("consent is required — false is rejected", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, consent: false });
    expect(errors.join(" ")).toMatch(/consent is required/i);
  });

  test("consent is required — missing is rejected", () => {
    const input: Record<string, unknown> = { ...VALID_INPUT };
    delete input.consent;
    const { errors } = requireInvalid(input);
    expect(errors.join(" ")).toMatch(/consent is required/i);
  });

  test("consent truthy-but-not-boolean-true is rejected (no coercion)", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, consent: "true" });
    expect(errors.join(" ")).toMatch(/consent is required/i);
  });

  test("rejects unexpected/extra fields", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, admin: true, is_private: false });
    expect(errors.join(" ")).toMatch(/unexpected field/i);
    expect(errors.join(" ")).toMatch(/admin/);
  });

  test("rejects a name over the length cap", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, name: "x".repeat(201) });
    expect(errors.join(" ")).toMatch(/200 characters or fewer/i);
  });

  test("rejects equipment over the length cap", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, equipment: "x".repeat(4001) });
    expect(errors.join(" ")).toMatch(/4000 characters or fewer/i);
  });

  test("rejects a utm field over its length cap", () => {
    const { errors } = requireInvalid({ ...VALID_INPUT, utm_campaign: "x".repeat(201) });
    expect(errors.join(" ")).toMatch(/utm_campaign must be 200 characters or fewer/i);
  });

  test("rejects a non-object body", () => {
    const { ok, errors } = requireInvalid("not-an-object");
    expect(ok).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("equipment is optional — empty string is valid", () => {
    const input: Record<string, unknown> = { ...VALID_INPUT };
    delete input.equipment;
    const result = validatePilotRequest(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.equipment).toBe("");
  });
});

function requireInvalid(input: unknown): { ok: boolean; errors: string[] } {
  const result = validatePilotRequest(input);
  if (result.ok) return { ok: true, errors: [] };
  return { ok: false, errors: result.errors };
}

// ---------------------------------------------------------------------------
// companyDomainFromEmail
// ---------------------------------------------------------------------------

describe("companyDomainFromEmail", () => {
  test("extracts the lowercased domain", () => {
    expect(companyDomainFromEmail("Jane@ACME-Mfg.com")).toBe("acme-mfg.com");
  });
  test("returns null for a malformed address", () => {
    expect(companyDomainFromEmail("no-at-sign")).toBeNull();
    expect(companyDomainFromEmail("trailing@")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// insertPilotRequest — mocked @neondatabase/serverless (same pattern as
// lib/__tests__/hub-user-activation.test.ts)
// ---------------------------------------------------------------------------

let capturedQueries: Array<{ strings: TemplateStringsArray; values: unknown[] }>;
let scriptedReturns: Array<unknown[]>;

mock.module("@neondatabase/serverless", () => ({
  neon: () => {
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      capturedQueries.push({ strings, values });
      const next = scriptedReturns.shift() ?? [];
      return Promise.resolve(next);
    };
  },
}));

beforeEach(() => {
  capturedQueries = [];
  scriptedReturns = [];
  process.env.NEON_DATABASE_URL = "postgresql://fake:fake@fake/fake";
});

afterEach(() => {
  delete process.env.NEON_DATABASE_URL;
});

const VALID: ValidPilotRequest = {
  name: "Jane Tech",
  workEmail: "jane@acme-mfg.com",
  company: "Acme Manufacturing",
  equipment: "Allen-Bradley PLCs",
  consent: true,
  utmSource: "google",
  utmMedium: "cpc",
  utmCampaign: "pilot-launch",
  utmContent: null,
  utmTerm: null,
  referrer: "https://google.com",
};

describe("insertPilotRequest", () => {
  test("issues an INSERT into plg_pilot_requests with the exact column list", async () => {
    scriptedReturns = [[{ id: "11111111-1111-1111-1111-111111111111", created_at: "2026-10-28T00:00:00Z" }]];
    const { insertPilotRequest } = await import("./pilot-request");
    const row = await insertPilotRequest(VALID);

    expect(capturedQueries.length).toBe(1);
    const sql = capturedQueries[0]!.strings.join("?");
    expect(sql).toContain("INSERT INTO plg_pilot_requests");
    for (const col of [
      "id", "name", "work_email", "company", "equipment", "consent",
      "consent_text_version", "consent_at", "utm_source", "utm_medium",
      "utm_campaign", "utm_content", "utm_term", "referrer", "status",
    ]) {
      expect(sql).toContain(col);
    }

    const values = capturedQueries[0]!.values;
    // id (uuid, app-generated), name, workEmail, company, equipment, consent,
    // CONSENT_TEXT_VERSION, utmSource, utmMedium, utmCampaign, utmContent, utmTerm, referrer
    expect(values[1]).toBe(VALID.name);
    expect(values[2]).toBe(VALID.workEmail);
    expect(values[3]).toBe(VALID.company);
    expect(values[4]).toBe(VALID.equipment);
    expect(values[5]).toBe(true);
    expect(values[6]).toBe(CONSENT_TEXT_VERSION);
    expect(values).toContain(VALID.utmSource);
    expect(values).toContain(VALID.utmCampaign);
    expect(values).toContain(VALID.referrer);

    expect(row.id).toBe("11111111-1111-1111-1111-111111111111");
  });

  test("throws when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const { insertPilotRequest } = await import("./pilot-request");
    await expect(insertPilotRequest(VALID)).rejects.toThrow(/NEON_DATABASE_URL/);
  });
});

describe("ensurePilotRequestSchema", () => {
  test("issues an idempotent CREATE TABLE IF NOT EXISTS for plg_pilot_requests", async () => {
    const { ensurePilotRequestSchema } = await import("./pilot-request");
    await ensurePilotRequestSchema();
    const sql = capturedQueries.map((q) => q.strings.join("?")).join("\n");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS plg_pilot_requests");
    expect(sql).not.toContain("DROP TABLE");
  });
});

// ---------------------------------------------------------------------------
// submitPilotRequest — orchestration via dependency injection (no DB/network)
// ---------------------------------------------------------------------------

describe("submitPilotRequest", () => {
  function fakeRow(): StoredPilotRequest {
    return { id: "22222222-2222-2222-2222-222222222222", createdAt: "2026-10-28T00:00:00Z" };
  }

  test("returns validation errors without calling insert", async () => {
    let insertCalled = false;
    const result = await submitPilotRequest(
      { ...VALID_INPUT, consent: false },
      { insert: async () => { insertCalled = true; return fakeRow(); } },
    );
    expect(result.ok).toBe(false);
    expect(insertCalled).toBe(false);
  });

  test("on success, calls insert, notifyOwner, and capture, and returns the id", async () => {
    const row = fakeRow();
    let notifyCalled = false;
    let captureCalled = false;
    const result = await submitPilotRequest(VALID_INPUT, {
      insert: async () => row,
      notifyOwner: async () => { notifyCalled = true; return true; },
      capture: () => { captureCalled = true; },
    });
    expect(result).toEqual({ ok: true, id: row.id });
    expect(notifyCalled).toBe(true);
    expect(captureCalled).toBe(true);
  });

  test("email failure (rejection) does not lose the stored row", async () => {
    const row = fakeRow();
    const result = await submitPilotRequest(VALID_INPUT, {
      insert: async () => row,
      notifyOwner: async () => { throw new Error("Resend is down"); },
      capture: () => {},
    });
    expect(result).toEqual({ ok: true, id: row.id });
  });

  test("email failure (resolves false) does not lose the stored row", async () => {
    const row = fakeRow();
    const result = await submitPilotRequest(VALID_INPUT, {
      insert: async () => row,
      notifyOwner: async () => false,
      capture: () => {},
    });
    expect(result).toEqual({ ok: true, id: row.id });
  });

  test("capture throwing does not lose the stored row", async () => {
    const row = fakeRow();
    const result = await submitPilotRequest(VALID_INPUT, {
      insert: async () => row,
      notifyOwner: async () => true,
      capture: () => { throw new Error("posthog blew up"); },
    });
    expect(result).toEqual({ ok: true, id: row.id });
  });

  test("capture is called with distinctId = row.id, not the email", async () => {
    const row = fakeRow();
    let seenDistinctId: string | undefined;
    await submitPilotRequest(VALID_INPUT, {
      insert: async () => row,
      notifyOwner: async () => true,
      capture: (capturedRow) => {
        seenDistinctId = capturedRow.id;
      },
    });
    expect(seenDistinctId).toBe(row.id);
  });
});

// ---------------------------------------------------------------------------
// Default capture (real implementation, no deps.capture override) — assert
// the PostHog payload has no PII by mocking posthog-server's HTTP call.
// ---------------------------------------------------------------------------

describe("submitPilotRequest with real capture (default deps.capture)", () => {
  test("captureServerEvent is called with event=pilot_request and only utm_*/company_domain properties", async () => {
    // captureServerEvent itself no-ops without PLG_POSTHOG_KEY (read at module
    // load — see lib/posthog-server.ts), and that env var is unset in every
    // test env today. Mock the module directly so this test exercises the
    // REAL defaultCapture() in pilot-request.ts (not deps.capture) and
    // inspects exactly what it would have sent, with no network involved.
    const calls: Array<{ event: string; distinctId: string; properties?: Record<string, unknown> }> = [];
    mock.module("../lib/posthog-server", () => ({
      captureServerEvent: (input: { event: string; distinctId: string; properties?: Record<string, unknown> }) => {
        calls.push(input);
      },
    }));

    const { submitPilotRequest: submit } = await import("./pilot-request");
    const row = { id: "33333333-3333-3333-3333-333333333333", createdAt: "2026-10-28T00:00:00Z" };
    await submit(
      {
        ...VALID_INPUT,
        work_email: "jane@acme-mfg.com",
        utm_source: "google",
        utm_campaign: "pilot-launch",
      },
      {
        insert: async () => row,
        notifyOwner: async () => true,
        // capture intentionally NOT overridden — exercise the real defaultCapture
      },
    );

    expect(calls.length).toBe(1);
    expect(calls[0]!.event).toBe("pilot_request");
    expect(calls[0]!.distinctId).toBe(row.id);
    const props = (calls[0]!.properties ?? {}) as Record<string, unknown>;
    const allowedKeys = new Set([
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "company_domain",
    ]);
    for (const key of Object.keys(props)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    expect(props.utm_source).toBe("google");
    expect(props.utm_campaign).toBe("pilot-launch");
    expect(props.company_domain).toBe("acme-mfg.com");
    // Never the free-text/email fields:
    expect(props.name).toBeUndefined();
    expect(props.work_email).toBeUndefined();
    expect(props.email).toBeUndefined();
    expect(props.company).toBeUndefined();
    expect(props.equipment).toBeUndefined();
  });
});
