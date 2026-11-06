import { describe, test, expect, mock, afterEach } from "bun:test";
import { DRIP_SCHEDULE, sendBetaWelcomeEmail } from "../mailer";
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete process.env.RESEND_API_KEY; });
describe("current free-pilot email journey", () => {
  test("does not schedule historical day-seven payment or unsupported beta promises", () => {
    expect(DRIP_SCHEDULE).toHaveLength(0);
  });
  test("legacy interest welcome directs to application without granting access or billing", async () => {
    process.env.RESEND_API_KEY = "local-fixture-only";
    let sent: { html: string } | undefined;
    globalThis.fetch = mock(async (_url: unknown, options: RequestInit | undefined) => {
      sent = JSON.parse(String(options?.body));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await sendBetaWelcomeEmail("fixture@example.invalid", "Fixture", "Local test")).toBe(true);
    expect(sent?.html).toContain("five free, scoped 30-day");
    expect(sent?.html).toContain('https://app.factorylm.com/signup/');
    expect(sent?.html).toContain("does not grant access or reserve a pilot place");
    expect(sent?.html).not.toMatch(/\$97|CHECKOUT_URL|3-minute video|creates work orders/);
  });
});
