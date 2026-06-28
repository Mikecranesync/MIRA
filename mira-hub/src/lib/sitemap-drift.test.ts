import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverRoutes, snapshotOf, SNAPSHOT } from "../../scripts/sitemap.mjs";

/**
 * Route-drift guard (golden-file pattern).
 *
 * The committed `docs/sitemap.snapshot.json` is the recorded route surface of
 * the app. This test regenerates that surface from the live `src/app`
 * filesystem and fails if they disagree — so a page or API route cannot be
 * added or removed without updating the snapshot (and producing the diff that
 * documents the change).
 *
 * To fix a failure: run `bun run sitemap` and commit docs/SITEMAP.md +
 * docs/sitemap.snapshot.json.
 */
describe("route sitemap drift", () => {
  it("docs/sitemap.snapshot.json matches the src/app filesystem", () => {
    expect(
      fs.existsSync(SNAPSHOT),
      "missing docs/sitemap.snapshot.json — run `bun run sitemap`",
    ).toBe(true);

    const committed = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8")) as {
      pages: string[];
      apiRoutes: string[];
    };
    const live = snapshotOf(discoverRoutes()) as { pages: string[]; apiRoutes: string[] };

    const drift = (committedArr: string[], liveArr: string[]) => {
      const c = new Set(committedArr);
      const l = new Set(liveArr);
      return {
        added: liveArr.filter((x) => !c.has(x)),
        removed: committedArr.filter((x) => !l.has(x)),
      };
    };

    const pageDrift = drift(committed.pages, live.pages);
    const apiDrift = drift(committed.apiRoutes, live.apiRoutes);

    const msg =
      `Routes drifted from docs/sitemap.snapshot.json — run \`bun run sitemap\` and commit.\n` +
      `pages   +${JSON.stringify(pageDrift.added)} -${JSON.stringify(pageDrift.removed)}\n` +
      `api     +${JSON.stringify(apiDrift.added)} -${JSON.stringify(apiDrift.removed)}`;

    expect(live.pages, msg).toEqual(committed.pages);
    expect(live.apiRoutes, msg).toEqual(committed.apiRoutes);
  });
});
