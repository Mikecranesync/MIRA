import { describe, expect, it } from "vitest";
import { isAutomatedSignup } from "../automated-signup";

describe("reserved automated signup identities", () => {
  it.each(["betagate-1793524261387@factorylm.com", "strangerwalk-charlie-dry3-1500@factorylm.com", " BETAGATE-123@FactoryLM.com "])("recognizes %s", email => {
    expect(isAutomatedSignup(email)).toBe(true);
  });
  it.each(["tech@acme.com", "mike@factorylm.com", "test@factorylm.com", "betagate-jane@factorylm.com", "betagate-123@customer.com", "strangerwalk-123@customer.com", "betagate-123@factorylm.com.attacker.com", "xbetagate-123@factorylm.com", "strangerwalk@factorylm.com"])("preserves %s as an applicant", email => {
    expect(isAutomatedSignup(email)).toBe(false);
  });
});
