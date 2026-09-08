import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/providers/access-control";
import { moreDestinations, sidebarDestinations, SIDEBAR_KEYS } from "./MoreSheet";

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

  it("never repeats a sidebar row — More carries what the sidebar does not", () => {
    const keys = moreDestinations(owner, false).map((d) => d.key);
    for (const shown of SIDEBAR_KEYS) {
      expect(keys).not.toContain(shown);
    }
  });

  it("carries the legacy primary items the V3 sidebar does NOT show", () => {
    // The gap this closes (F2): the exclusion used to key on NAV_ITEMS'
    // `group === "primary"` — the LEGACY Hub's five, which are not V3's four.
    // So these were excluded from More while the sidebar rows were inert
    // buttons, leaving them reachable from neither place. If the exclusion
    // ever reverts to the group, this test goes red.
    const keys = moreDestinations(owner, false).map((d) => d.key);
    for (const orphaned of ["feed", "namespace", "command-center", "channels"]) {
      expect(keys).toContain(orphaned);
    }
  });

  it("partitions every visible destination into exactly one of the two lists", () => {
    const inMore = moreDestinations(owner, false).map((d) => d.key);
    const inSidebar = sidebarDestinations(owner, false).map((d) => d.key);
    // Disjoint — nothing offered twice.
    expect(inMore.filter((k) => inSidebar.includes(k))).toEqual([]);
    // And complete — every gate-passing destination is reachable from one of
    // them, so no future NAV_ITEMS addition can silently become unreachable.
    const reachable = new Set([...inMore, ...inSidebar]);
    for (const item of NAV_ITEMS) {
      if (item.group === "labs") continue;
      if (!item.roles.includes("owner" as never)) continue;
      const cap = (item as { capability?: string }).capability;
      if (cap && !owner.capabilities.includes(cap)) continue;
      expect(reachable.has(item.key)).toBe(true);
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
    expect(labels).not.toContain("Contextualization");
    expect(labels).toContain("Equipment map");
    // "Work orders" moved to the sidebar with the `workorders` key, so the
    // plain-vocabulary rule is asserted where the row now lives. The canonical
    // label is "CMMS"; neither list may show it.
    const sidebarLabels = sidebarDestinations(owner, false).map((d) => d.label);
    expect(sidebarLabels).toContain("Work orders");
    expect([...labels, ...sidebarLabels]).not.toContain("CMMS");
  });

  it("gates sidebar rows by role and capability, like More", () => {
    // A row the caller cannot reach must not be rendered and then refused
    // (#1932). Unknown role fails closed to nothing.
    expect(sidebarDestinations({ role: "nonsense", capabilities: [] }, false)).toEqual([]);
    // Positive control: a real role does get rows, so the assertion above
    // cannot be passing because the function always returns [].
    expect(sidebarDestinations(tech, false).length).toBeGreaterThan(0);
  });

  it("resolves every sidebar key to a real destination with an href", () => {
    // A key with no matching NAV_ITEMS entry would silently vanish from the
    // sidebar — the inert-button failure in a new disguise.
    const rows = sidebarDestinations(owner, false);
    expect(rows.length).toBe(SIDEBAR_KEYS.length);
    for (const r of rows) expect(r.href.startsWith("/")).toBe(true);
  });

  it("returns nothing for an unknown role rather than everything", () => {
    // Fail-closed: an unrecognised role must not fall through to a full menu.
    expect(moreDestinations({ role: "nonsense", capabilities: [] }, false)).toEqual([]);
  });
});
