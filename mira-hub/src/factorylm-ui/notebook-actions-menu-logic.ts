/**
 * The notebook's tools behind one "More" button (Mike, 2026-11-20): what the list holds and in what
 * order. Each tool decides for itself whether it is available and registers here; this file only
 * orders and groups what is registered, so the list reads the same whichever tool answered first.
 */

export type MenuItemId = "equipment" | "part" | "guided" | "machine-state" | "saved-fixes" | "work-packet" | "job-sheet";
export type MenuGroup = "Find" | "Fix" | "Job";

export interface MenuItem {
  id: MenuItemId;
  label: string;
  description: string;
  /** Something is under way in this tool (a procedure part done, a packet started): a tag on the item, a dot on More. */
  status?: string;
}

/** The order of a job: find the equipment and the part, work out the fault, then do the job. */
export const MENU_ORDER: readonly MenuItemId[] = ["equipment", "part", "guided", "machine-state", "saved-fixes", "work-packet", "job-sheet"];

export const MENU_GROUP: Record<MenuItemId, MenuGroup> = {
  equipment: "Find", part: "Find",
  guided: "Fix", "machine-state": "Fix", "saved-fixes": "Fix",
  "work-packet": "Job", "job-sheet": "Job",
};

export function orderItems(items: Iterable<MenuItem>): MenuItem[] {
  return [...items].sort((a, b) => MENU_ORDER.indexOf(a.id) - MENU_ORDER.indexOf(b.id));
}

/** The registered tools in order, under their group headings; a group with nothing in it is left out. */
export function groupItems(items: Iterable<MenuItem>): { group: MenuGroup; items: MenuItem[] }[] {
  const out: { group: MenuGroup; items: MenuItem[] }[] = [];
  for (const item of orderItems(items)) {
    const group = MENU_GROUP[item.id];
    const last = out[out.length - 1];
    if (last && last.group === group) last.items.push(item);
    else out.push({ group, items: [item] });
  }
  return out;
}

/** More carries a dot when any tool has something under way. */
export function moreBadge(items: Iterable<MenuItem>): boolean {
  for (const item of items) if (item.status) return true;
  return false;
}
