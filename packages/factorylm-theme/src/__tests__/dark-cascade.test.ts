import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * The workspace layer used to name dark values in exactly one place:
 * `[data-theme="dark"]`. A host that sets no `data-theme` — a Capacitor WebView
 * does not — therefore rendered the LIGHT workspace block while the canonical
 * `--fl-*` layer beneath it had already switched to dark. The result was not a
 * missing stylesheet, so nothing failed loudly; it was a wrong cascade, and on a
 * Pixel 9a it measured as:
 *
 *   --fl-workspace-warn-ink   #e3e3e6  (identical to ordinary ink)
 *   --fl-workspace-fault-ink  #e3e3e6  (identical to ordinary ink)
 *   --fl-workspace-off-ink    #e3e3e6  (identical to ordinary ink)
 *   --fl-workspace-ok-ink     #15803d  (on #1a1d21 — about 1.6:1)
 *   --fl-workspace-ok-tint    #f0fdf4  (near-white block on a dark surface)
 *   --fl-workspace-warn-tint  #fffbeb  (near-white block on a dark surface)
 *
 * Three of the four state inks had collapsed onto ordinary text, which is the
 * one thing `.claude/rules/ui-style.md` says colour must never do.
 *
 * These tests pin the shape that prevents it: the state family is defined for
 * system-dark as well as attribute-dark, the two never drift apart, and no
 * workspace token may have its ONLY definition inside a conditional block.
 */

const WORKSPACE_CSS = new URL("../workspace.css", import.meta.url);
const SYSTEM_DARK_RULE = ':root:not([data-theme="light"])';
const MEDIA_DARK = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/;
const STATE_ROLE = /^--fl-workspace-(ok|warn|fault|off)(-(tint|line|ink))?$/;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Declarations of the first `{ … }` body that follows `marker`. */
function declarationsAfter(css: string, marker: string): ReadonlyMap<string, string> {
  const at = css.indexOf(marker);
  expect(at, `expected to find ${marker} in workspace.css`).toBeGreaterThan(-1);

  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);

  return new Map(
    css
      .slice(open + 1, close)
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...rest] = d.split(":");
        return [name.trim(), rest.join(":").trim()] as const;
      }),
  );
}

describe("workspace dark cascade", () => {
  const css = stripComments(readFileSync(WORKSPACE_CSS, "utf8"));

  it("defines the dark state palette for system dark, not only for data-theme=dark", () => {
    // The guard this whole file exists for: without a prefers-color-scheme block
    // a host that sets no data-theme silently renders the light workspace values.
    expect(css).toMatch(MEDIA_DARK);

    // Scoped so an explicit light choice still wins over the system preference.
    // ...and the state rule must live INSIDE it, not merely somewhere in the file.
    const media = css.slice(css.search(MEDIA_DARK));
    expect(media.indexOf(SYSTEM_DARK_RULE)).toBeGreaterThan(-1);
    expect(css.indexOf(SYSTEM_DARK_RULE)).toBeGreaterThan(css.search(MEDIA_DARK));
  });

  it("covers every state role in the system-dark block", () => {
    const attributeDark = declarationsAfter(css, '[data-theme="dark"]');
    const systemDark = declarationsAfter(css, SYSTEM_DARK_RULE);

    const stateRoles = [...attributeDark.keys()].filter((n) => STATE_ROLE.test(n)).sort();

    // A guard asserting "some tokens are mirrored" would pass on a single token.
    expect(stateRoles.length).toBe(16);
    expect([...systemDark.keys()].filter((n) => STATE_ROLE.test(n)).sort()).toEqual(stateRoles);
  });

  it("never lets the two dark blocks drift apart", () => {
    const attributeDark = declarationsAfter(css, '[data-theme="dark"]');
    const systemDark = declarationsAfter(css, SYSTEM_DARK_RULE);

    for (const [name, value] of systemDark) {
      expect(
        attributeDark.get(name),
        `${name} differs between the system-dark and data-theme="dark" blocks`,
      ).toBe(value);
    }
  });

  it("gives every conditional token a definition in :root as well", () => {
    // "Never give a colour its only definition inside a media or [data-theme]
    // block" — a token that exists only conditionally is invalid-at-computed-
    // value-time everywhere else, which is the failure this file documents.
    const light = declarationsAfter(css, ":root");
    const systemDark = declarationsAfter(css, SYSTEM_DARK_RULE);
    const attributeDark = declarationsAfter(css, '[data-theme="dark"]');

    for (const name of [...systemDark.keys(), ...attributeDark.keys()]) {
      expect(light.has(name), `${name} is defined only inside a conditional block`).toBe(true);
    }
  });

  it("stays state-only, so it cannot repaint a host that owns its dark surface", () => {
    // mira-mobile bridges --fl-* onto its own Material palette (#1a1d21 surface).
    // Mirroring the full dark block would drag the app to the theme palette
    // (#0d0e11) — a whole-app restyle to fix six state tokens. Keep it narrow.
    const systemDark = declarationsAfter(css, SYSTEM_DARK_RULE);
    const nonState = [...systemDark.keys()].filter((n) => !STATE_ROLE.test(n));

    expect(nonState).toEqual([]);
  });
});
