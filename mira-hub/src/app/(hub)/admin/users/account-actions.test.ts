// #1945: the platform-accounts admin surface must (a) report a search-aware
// count so a filtered view doesn't read as the full total, (b) confirm before
// destructive mutations, and (c) give each row action a user-specific
// accessible name. These pure helpers back all three; cover their branches.

import { it, expect, describe } from "vitest";
import { formatCountLabel, confirmMessage, actionAriaLabel } from "./account-actions";

describe("formatCountLabel", () => {
  it("shows bare total when no query is active", () => {
    expect(formatCountLabel({ total: 34, visible: 34, hasQuery: false, pending: 0 }))
      .toBe("34 total");
  });

  it("appends pending review when there are pending accounts and no query", () => {
    expect(formatCountLabel({ total: 49, visible: 49, hasQuery: false, pending: 5 }))
      .toBe("49 total · 5 pending review");
  });

  it("leads with a singular result count when a query matches one user", () => {
    expect(formatCountLabel({ total: 49, visible: 1, hasQuery: true, pending: 5 }))
      .toBe("1 result · 49 total");
  });

  it("leads with a plural result count when a query matches several users", () => {
    expect(formatCountLabel({ total: 49, visible: 3, hasQuery: true, pending: 5 }))
      .toBe("3 results · 49 total");
  });

  it("reports zero results (still plural) when a query matches nothing", () => {
    expect(formatCountLabel({ total: 49, visible: 0, hasQuery: true, pending: 0 }))
      .toBe("0 results · 49 total");
  });

  it("never leaks the pending suffix into the filtered count", () => {
    expect(formatCountLabel({ total: 49, visible: 2, hasQuery: true, pending: 5 }))
      .not.toContain("pending");
  });
});

describe("confirmMessage", () => {
  it("requires confirmation for Revoke (→ pending), naming the user", () => {
    expect(confirmMessage("pending", "Ada Probe")).toBe("Revoke access for Ada Probe?");
  });

  it("requires confirmation for Expire (→ expired), naming the user", () => {
    expect(confirmMessage("expired", "probe@factorylm.com"))
      .toBe("Expire trial for probe@factorylm.com?");
  });

  it("does not confirm for Approve (one-click)", () => {
    expect(confirmMessage("approved", "Ada Probe")).toBeNull();
  });
});

describe("actionAriaLabel", () => {
  it("gives each action a user-specific accessible name", () => {
    expect(actionAriaLabel("approved", "Ada Probe")).toBe("Approve Ada Probe");
    expect(actionAriaLabel("pending", "Ada Probe")).toBe("Revoke access for Ada Probe");
    expect(actionAriaLabel("expired", "Ada Probe")).toBe("Expire trial for Ada Probe");
  });

  it("disambiguates two rows by their distinct labels", () => {
    expect(actionAriaLabel("approved", "alice@x.com"))
      .not.toBe(actionAriaLabel("approved", "bob@x.com"));
  });
});
