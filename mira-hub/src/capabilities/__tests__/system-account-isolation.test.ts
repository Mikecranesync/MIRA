import { describe, expect, it } from "vitest";
import { isSystemAccount } from "@/lib/users";

describe("admin system-account visibility for harness signups", () => {
  it.each([
    "betagate-1793524261387@factorylm.com",
    "strangerwalk-charlie-dry3-1500@factorylm.com",
  ])("identifies %s for the existing includeSystem filter", email => {
    expect(isSystemAccount({ email, name: null })).toBe(true);
  });

  it.each([
    "betagate-123@customer.com",
    "strangerwalk-123@customer.com",
  ])("keeps %s visible as a genuine applicant", email => {
    expect(isSystemAccount({ email, name: "Beta Gate Stranger" })).toBe(false);
  });
});
