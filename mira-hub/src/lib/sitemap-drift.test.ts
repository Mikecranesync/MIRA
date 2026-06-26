import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Route-drift guard (golden-file pattern).
 *
 * The committed `docs/sitemap.snapshot.json` is the recorded route surface of
 * the app. The sitemap CLI regenerates that surface from the live `src/app`
 * filesystem and fails if they disagree.
 *
 * To fix a failure: run `bun run sitemap` and commit docs/SITEMAP.md +
 * docs/sitemap.snapshot.json.
 */
describe("route sitemap drift", () => {
  it("docs/sitemap.snapshot.json matches the src/app filesystem", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/sitemap.mjs", "--check"], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
