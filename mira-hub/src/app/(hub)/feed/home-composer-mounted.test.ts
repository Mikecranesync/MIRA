import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The composer must be MOUNTED on the home screen — not merely to exist.
 *
 * Why this test exists
 * --------------------
 * `HomeComposer.test.tsx` renders the component directly
 * (`renderToStaticMarkup(<HomeComposer />)`). That proves the component works
 * and is structurally incapable of proving any page contains it. When #3682
 * was first reviewed, `HomeComposer` was referenced in exactly two places in
 * the whole repo — its own definition and that test — and neither #3682 nor
 * #3683 mounted it anywhere. Its own generated `SITEMAP.md` diff showed API
 * routes 179 -> 181 and Pages unchanged at 69: a PR titled "the composer is
 * the home screen" that changed no page. Gates A-1/B-1 would have been booked
 * as delivered while a technician still saw no composer.
 *
 * So this asserts the wiring the component test cannot: the file that serves
 * the home route imports and renders `<HomeComposer />`.
 *
 * What this proves, and what it does not
 * --------------------------------------
 * This is a SOURCE-level check. It proves the mount is written; it does not
 * prove the page renders successfully at runtime, and it is not a substitute
 * for the Z-1 walk. It is here because it catches the one failure the
 * component test cannot see, cheaply, on every PR.
 *
 * It is written so it cannot pass blindly. Both files are read with an
 * explicit non-empty assertion, and the home route's redirect target is
 * asserted too — so if `/` stops pointing at `/feed/`, this fails loudly
 * rather than continuing to guard a page that is no longer the home screen.
 * A guard that silently starts watching the wrong file is the failure mode
 * this whole exercise keeps surfacing.
 */

const HUB_SRC = join(__dirname, "..", "..", "..");

function read(...parts: string[]): string {
  const source = readFileSync(join(HUB_SRC, ...parts), "utf8");
  // Positive control: an empty or unreadable file must fail here rather than
  // sail through every `toContain` below by containing nothing to contradict.
  expect(source.length, `${parts.join("/")} is empty — the guard read nothing`).toBeGreaterThan(200);
  return source;
}

describe("the composer is mounted on the home screen (A-1, B-1)", () => {
  it("'/' still redirects to /feed/, so /feed/ is the page worth guarding", () => {
    const rootRoute = read("app", "route.ts");
    // Control: prove we read the redirect handler, not some other file.
    expect(rootRoute).toContain("NextResponse.redirect");
    expect(rootRoute).toContain("/feed/");
  });

  it("the home page imports HomeComposer", () => {
    const feed = read("app", "(hub)", "feed", "page.tsx");
    expect(feed).toMatch(/import\s+HomeComposer\s+from\s+["']@\/factorylm-ui\/HomeComposer["']/);
  });

  it("the home page RENDERS HomeComposer, not just imports it", () => {
    const feed = read("app", "(hub)", "feed", "page.tsx");
    expect(feed).toMatch(/<HomeComposer\s*\/>/);
  });

  it("the composer comes before the KPI/readiness chrome", () => {
    // The recon's structural finding: the product opens on an operations
    // console that contains an AI feature, when it should open on an AI
    // surface that contains operations. Order on the page is that claim,
    // made checkable.
    const feed = read("app", "(hub)", "feed", "page.tsx");
    const composerAt = feed.indexOf("<HomeComposer />");
    const widgetAt = feed.indexOf("<HealthScoreWidget />");
    expect(composerAt, "HomeComposer is not rendered at all").toBeGreaterThan(-1);
    expect(widgetAt, "HealthScoreWidget moved — re-check what the home screen leads with").toBeGreaterThan(-1);
    expect(composerAt).toBeLessThan(widgetAt);
  });
});
