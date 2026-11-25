/**
 * The More list (Mike, 2026-11-20): one order and grouping whatever order the tools answered in,
 * and a dot on More only while something is under way. Behaviour in a browser is in
 * tests/e2e/equipment-nav.spec.ts (the "More" block).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupItems, MENU_ORDER, moreBadge, orderItems, type MenuItem, type MenuItemId } from "./notebook-actions-menu-logic";

const item = (id: MenuItemId, status?: string): MenuItem => ({ id, label: id, description: `${id} description`, ...(status ? { status } : {}) });

describe("orderItems", () => {
  it("lists the tools in job order however they registered", () => {
    const shuffled = [item("job-sheet"), item("equipment"), item("saved-fixes"), item("guided"), item("work-packet"), item("part"), item("machine-state")];
    expect(orderItems(shuffled).map((i) => i.id)).toEqual(["equipment", "part", "guided", "machine-state", "saved-fixes", "work-packet", "job-sheet"]);
  });

  it("keeps only what registered", () => {
    expect(orderItems([item("work-packet"), item("part")]).map((i) => i.id)).toEqual(["part", "work-packet"]);
  });

  it("covers every tool exactly once", () => {
    expect(new Set(MENU_ORDER).size).toBe(7);
  });
});

describe("groupItems", () => {
  it("puts the tools under Find, Fix and Job", () => {
    const groups = groupItems([item("job-sheet"), item("guided"), item("part"), item("equipment"), item("saved-fixes")]);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ["Find", ["equipment", "part"]],
      ["Fix", ["guided", "saved-fixes"]],
      ["Job", ["job-sheet"]],
    ]);
  });

  it("leaves out a group with nothing in it (flags off in production: only the part picker)", () => {
    expect(groupItems([item("part")]).map((g) => g.group)).toEqual(["Find"]);
    expect(groupItems([])).toEqual([]);
  });
});

describe("moreBadge", () => {
  it("is on while any tool has something under way", () => {
    expect(moreBadge([item("part"), item("work-packet", "In progress")])).toBe(true);
  });

  it("is off when nothing is under way", () => {
    expect(moreBadge([item("part"), item("guided")])).toBe(false);
    expect(moreBadge([])).toBe(false);
  });
});

describe("the tools register with the menu instead of drawing their own pills", () => {
  const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

  it.each([
    ["EquipmentNav.tsx", /useMenuItem\(available \? EQUIPMENT_ITEM : null/],
    ["BenchComponents.tsx", /useMenuItem\(available \? PART_ITEM : null/],
    ["GuidedProcedure.tsx", /useMenuItem\(\s*proc \? \{ id: "guided"/],
    ["MachineObservations.tsx", /useMenuItem\(enabled \? MACHINE_STATE_ITEM : null/],
    ["SavedFixes.tsx", /useMenuItem\(\s*state && state\.fixes\.length > 0/],
    ["WorkPacketPanel.tsx", /useMenuItem\(\s*avail === null(?: \|\| \([^)]*\))? \? null : \{ id: "work-packet"/],
    ["LivingSheet.tsx", /useMenuItem\(enabled === true \? JOB_SHEET_ITEM : null/],
  ])("%s registers before it can return nothing", (file, call) => {
    const src = read(file);
    const at = src.search(call);
    expect(at).toBeGreaterThan(-1);
    // The early return that hides the tool comes after the registration, so hooks keep one order.
    const early = src.slice(at).search(/\n  if \([^)]*\) return null;/);
    expect(early).toBeGreaterThan(-1);
    expect(src.slice(0, at)).not.toMatch(/\n  if \((!available|!proc|!enabled|avail === null|enabled !== true)\) return null;/);
  });

  it("the host puts the More button first in the actions column, inside the provider", () => {
    const src = read("hub-host.tsx");
    expect(src).toMatch(/<style>\{NOTEBOOK_ACTIONS_CSS\}<\/style>\n\s*<NotebookActionsMenu covered=\{actionsCovered\} \/>/);
    const provider = src.indexOf("<NotebookActionsMenuProvider>");
    expect(provider).toBeGreaterThan(-1);
    expect(src.indexOf("<GuidedProcedure", provider)).toBeGreaterThan(provider);
    expect(src.indexOf("</NotebookActionsMenuProvider>")).toBeGreaterThan(src.indexOf('data-testid="notebook-actions"'));
  });

  it("uses tokens, not hard-coded colours", () => {
    expect(read("notebook-actions-menu.tsx")).not.toMatch(/["'`:]\s*#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
