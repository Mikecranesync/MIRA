/**
 * #4763 contract pin (CI runs this; the lab's Playwright layout proof
 * apps/factorylm-ui-lab/e2e/pending-list-landscape.spec.ts does not run in CI yet).
 * The composer's pending-attachments list is height-capped and scrolls, so on a
 * landscape phone six files cannot push the input row off screen.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dir, "..", "conversation.css"), "utf8");
const rule = (selector: string) => {
  const m = css.match(new RegExp(`${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
};

describe("pending attachments list cap", () => {
  it("is bounded by the viewport height and scrolls inside itself", () => {
    const body = rule(".fl-composer__pending");
    expect(body).toMatch(/max-block-size:\s*[^;]*dvh/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });
});
