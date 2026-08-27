/**
 * The scan → notebook hand-off, as state rather than as navigation.
 *
 * The bug this locks: the hand-off set the notebook route and the tab but left
 * the assets route on `{name:"tag"}`. TagLanding resolves its tag in a MOUNT
 * effect, so that route is not inert — tapping Assets remounted the landing,
 * which re-resolved the tag, re-POSTed a notebook, and bounced the technician
 * back to chat. The asset list became unreachable without restarting the app.
 *
 * So the assertion is about what the transition LEAVES BEHIND, not where it
 * goes. A test that only checked `tab === "chat"` passed the whole time the
 * trap was live.
 */
import { describe, expect, it } from "vitest";
import { openNotebookTransition } from "../scan-landing";

describe("openNotebookTransition", () => {
  it("opens the scanned machine's notebook", () => {
    const t = openNotebookTransition("nb-1");
    expect(t.tab).toBe("chat");
    expect(t.notebookRoute).toEqual({ name: "notebook", id: "nb-1" });
  });

  it("consumes the scan route — an armed tag route re-fires on remount", () => {
    expect(openNotebookTransition("nb-1").assetsRoute).toEqual({ name: "list" });
  });

  it("leaves no route that resolves a tag, for any notebook id", () => {
    for (const id of ["nb-1", "00000000-0000-4000-8000-000000000000", "x"]) {
      // `name` is the discriminator TagLanding mounts on. Asserting it is not
      // "tag" — rather than asserting it equals "list" alone — keeps this test
      // honest if a third assets route is ever added.
      expect(openNotebookTransition(id).assetsRoute.name).not.toBe("tag");
    }
  });
});
