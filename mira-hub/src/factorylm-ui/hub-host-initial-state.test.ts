/**
 * #4290: `/v3` on a phone opened with the navigation drawer over the
 * conversation on every load, so the technician had to close a menu before
 * typing. The Hub now opens with navigation closed; desktop is unchanged
 * because its sidebar is static and ignores the flag.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shellReducer } from "../../../packages/factorylm-interaction/src";
import { EMPTY_FIXTURE, initialHubShellState } from "./hub-host-logic";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("initialHubShellState (#4290)", () => {
  it("opens with the navigation drawer closed", () => {
    expect(initialHubShellState().navigationVisible).toBe(false);
  });

  it("still opens the drawer when the technician taps the menu (control)", () => {
    const opened = shellReducer(initialHubShellState(), { type: "set-navigation-visible", visible: true });
    expect(opened.navigationVisible).toBe(true);
  });

  it("starts on the empty thread", () => {
    expect(initialHubShellState().thread.id).toBe(EMPTY_FIXTURE.thread.id);
  });

  it("leaves desktop unchanged: the only rule the flag drives is inside the phone-width media query", () => {
    // Read from source rather than importing the shell component, whose React
    // tree this suite does not install.
    const shell = read("../../../packages/factorylm-ui/src/FactoryLMShell.tsx");
    const query = /NAVIGATION_LAYER_QUERY = "([^"]+)"/.exec(shell)?.[1];
    expect(query).toBe("(max-width: 48rem)");

    const css = read("../../../packages/factorylm-ui/src/shell.css");
    const rules = [...css.matchAll(/\[data-navigation-visible="true"\]/g)].map((m) => m.index ?? -1);
    expect(rules.length).toBeGreaterThan(0);
    for (const at of rules) {
      const open = css.lastIndexOf(`@media ${query}`, at);
      expect(open).toBeGreaterThan(-1);
      // No block closes the media query between its opening and the rule.
      expect(css.slice(open, at).match(/^\}/m)).toBeNull();
    }
  });

  it("is the state the /v3 host actually mounts with", () => {
    const host = read("./hub-host.tsx");
    expect(host).toMatch(/useReducer\(shellReducer, undefined, initialHubShellState\)/);
    expect(host).not.toMatch(/"set-navigation-visible", visible: true \}\),\s*\);/);
  });
});
