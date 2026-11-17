/**
 * Micro820 page 16 rewritten as an output-type inventory that lists only the two relay variants
 * (#5510 F16). The QWB column is removed and the middle column relabelled QWB / Relay, so the
 * geometry and the pinned rules are the real page's; the other captured pages still describe the
 * non-relay QBB. A page carrying `rules` gets its own pin from the test double.
 */
type Item = { str: string; x: number; y: number; w: number; size: number };
type FixturePage = { page: number; text: string; items: Item[] };
export type RuledPage = FixturePage & { rules?: Array<{ x: number; y0: number; y1: number }> };

export const PAGE16_RULES = [{ x: 212.46, y0: 205.5, y1: 614.52 }, { x: 300.24, y0: 269.76, y1: 476.28 }, { x: 300.24, y0: 574.74, y1: 614.52 },
  { x: 383.04, y0: 269.76, y1: 476.28 }, { x: 383.04, y0: 574.74, y1: 614.52 }];

export function relayOnlyInventory<P extends FixturePage>(pages: readonly P[]): Array<P & { rules?: typeof PAGE16_RULES }> {
  return pages.map((p) => p.page !== 16 ? p : {
    ...p,
    items: p.items.filter((i) => !(i.x >= 383 && i.y >= 270 && i.y <= 610) && i.str !== "(standard and high-speed)")
      .map((i) => i.str === "2080-LC20-20QBB(R)" ? { ...i, str: "2080-LC20-20QWB(R)" } : i.str === "24V DC source" ? { ...i, str: "Relay" } : i),
    rules: PAGE16_RULES,
  });
}

/**
 * The captured relay contact table placed BEFORE the output-type inventory (#5510 F17): page 1 a
 * model-list cover, page 2 the real page 19, page 3 the real page 16 inventory (complete, the
 * AWB/QWB-only subset, or absent). `captionSize` replaces only the "Relay Contact Ratings"
 * caption's font size; 10 is the page as printed, 8 is its body size (the reproduction Codex ran),
 * below the 9 pt Make/Break heads, so typography cannot make it the table's caption.
 */
export const RELAY_CAPTION_PRINTED = 10;
export const RELAY_CAPTION_BODY = 8;
export const RELAY_HEAD_SIZE = 9;
export function contactTableBeforeInventory<P extends FixturePage>(pages: readonly P[], inventory: "complete" | "subset" | "absent", captionSize: number): RuledPage[] {
  const coverLines = ["Micro820 20-Point Programmable Controllers", "Catalog Numbers 2080-LC20-20AWB(R), 2080-LC20-20QBB(R), 2080-LC20-20QWB(R)"];
  const cover: RuledPage = { page: 1, text: coverLines.join("\n"),
    items: coverLines.map((str, i) => ({ str, x: 72, y: 700 - i * 20, w: str.length * 4.5, size: i === 0 ? 14 : 10 })) };
  const p19 = pages.find((p) => p.page === 19)!;
  const contact: RuledPage = { page: 2, text: p19.text,
    items: p19.items.map((i) => i.str === "Relay Contact Ratings" || (i.str === "" && Math.abs(i.y - 623.3) < 0.5) ? { ...i, size: captionSize } : { ...i }) };
  const p16 = (inventory === "subset" ? relayOnlyInventory(pages) : pages).find((p) => p.page === 16)!;
  return inventory === "absent" ? [cover, contact] : [cover, contact, { ...p16, page: 3 }];
}
