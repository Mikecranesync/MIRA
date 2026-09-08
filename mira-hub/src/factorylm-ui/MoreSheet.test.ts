import { describe, expect, it } from "vitest";
import { moreDestinations } from "./MoreSheet";

/**
 * `More ›` was a dead row — the 13→5 nav reduction shipped before its
 * destination did. These assert the filter, which is where the risk is: an
 * over-permissive rule offers a technician a page the API will refuse (#1932),
 * and an over-strict one hides work they need.
 */
const tech = { role: "technician", capabilities: [] as string[] };
const owner = { role: "owner", capabilities: ["dev_tools.access", "review_queue.read", "platform.users.read"] };

describe("More › destinations", () => {
  it("is not empty for an ordinary technician — the row must lead somewhere", () => {
    expect(moreDestinations(tech, false).length).toBeGreaterThan(0);
  });

  it("never repeats a primary item — More carries what the sidebar does not", () => {
    const keys = moreDestinations(owner, false).map((d) => d.key);
    for (const primary of ["feed", "namespace", "command-center", "channels", "knowledge", "notebooks"]) {
      expect(keys).not.toContain(primary);
    }
  });

  it("hides labs surfaces when labs are off — they are mock data", () => {
    // Offering a fixture-backed page as a real destination is worse than
    // hiding it: the technician acts on numbers that mean nothing.
    const keys = moreDestinations(owner, false).map((d) => d.key);
    for (const lab of ["conversations", "alerts", "requests", "parts", "reports", "team"]) {
      expect(keys).not.toContain(lab);
    }
    expect(moreDestinations(owner, true).map((d) => d.key)).toContain("parts");
  });

  it("withholds a capability-gated destination from someone who HAS the role", () => {
    // The subject must hold the role, or the role gate alone excludes the item
    // and this asserts nothing. An earlier version used a technician — for whom
    // `plc-import` is already role-excluded — so removing the capability check
    // entirely left the suite green. Mutation caught it; the fixture was the bug.
    const adminNoCaps = { role: "owner", capabilities: [] as string[] };
    const keys = moreDestinations(adminNoCaps, false).map((d) => d.key);
    expect(keys).not.toContain("plc-import");
    expect(keys).not.toContain("admin-review");
    expect(keys).not.toContain("platform-users");
    // Positive control: the SAME role with the capability does get them, so
    // this test can only be passing because of the capability gate.
    expect(moreDestinations(owner, false).map((d) => d.key)).toContain("plc-import");
  });

  it("grants them to an owner who does hold the capability", () => {
    const keys = moreDestinations(owner, false).map((d) => d.key);
    expect(keys).toContain("plc-import");
    expect(keys).toContain("admin-review");
  });

  it("holding the capability is not enough without the role", () => {
    // Both gates, not either. A technician carrying a stray capability must
    // still not be offered an admin surface.
    const keys = moreDestinations({ role: "technician", capabilities: ["platform.users.read"] }, false)
      .map((d) => d.key);
    expect(keys).not.toContain("platform-users");
  });

  it("uses words a technician says, not invented vocabulary", () => {
    const labels = moreDestinations(owner, false).map((d) => d.label);
    expect(labels).not.toContain("CMMS");
    expect(labels).toContain("Work orders");
    expect(labels).not.toContain("Contextualization");
  });

  it("returns nothing for an unknown role rather than everything", () => {
    // Fail-closed: an unrecognised role must not fall through to a full menu.
    expect(moreDestinations({ role: "nonsense", capabilities: [] }, false)).toEqual([]);
  });
});
