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
