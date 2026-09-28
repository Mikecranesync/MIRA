/**
 * The scope picker's notice line, rendered — role and copy, not just state.
 *
 * `ScopePicker.test.ts` pins `listNotice`, which decides WHICH fact we are in.
 * That is half the guarantee. The other half is how the fact reaches the
 * technician, and it was undefended: at `17dcb9ed3` both of these changed one
 * line each and left all 33 tests green.
 *
 *   role="alert" -> role="status" on the total failure      33/33 passed
 *   the degraded copy pasted into the unreadable branch     33/33 passed
 *
 * So a wholly-broken machine list could be downgraded to a polite aside, or
 * made to read exactly like a partial one, with nothing to catch it. The
 * distinction between "some rows are missing, carry on" and "nothing loaded,
 * stop" is the whole point of the round-4 Q2 fix, and it lived only in JSX no
 * test could reach.
 *
 * Rendered with `react-dom/server` `renderToStaticMarkup` — the pattern already
 * used by `command-center/viewer.test.tsx` and `visual/VisualWorkspace.test.tsx`,
 * which runs in the hub's node vitest environment with no jsdom or RTL. It works
 * here because `ListNoticeLine` is pure: the picker itself fetches in
 * `useEffect`, which never runs under SSR, so a render of the whole sheet is
 * stuck on "loading" forever and can never reach these branches.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListNoticeLine, type ListNotice } from "./ScopePicker";

const html = (notice: ListNotice, malformed = 0, query = "") =>
  renderToStaticMarkup(<ListNoticeLine notice={notice} malformed={malformed} query={query} />);

describe("ListNoticeLine — the three states a technician can be in", () => {
  // 1. Valid assets + malformed rows: keep the machines, say so politely.
  it("DEGRADED is a non-blocking status, and says the rest are usable", () => {
    const out = html("degraded", 2);
    expect(out).toContain('role="status"');
    expect(out).not.toContain('role="alert"');
    expect(out).toContain("2 entries");
    expect(out).toContain("the rest are fine to ask about");
  });

  // 2. No valid assets but malformed rows: an explicit failure. Not a polite
  //    note, and not an empty account.
  it("UNREADABLE is an assertive failure, not a status and not the empty register", () => {
    const out = html("unreadable", 3);
    expect(out).toContain('role="alert"');
    expect(out).not.toContain('role="status"');
    expect(out).toContain("all 3 entries");
    expect(out).toContain("not an empty account");
    // The empty-register copy must be nowhere near this state.
    expect(out).not.toContain("No machines yet");
  });

  // 3. No assets and nothing malformed: the ordinary empty register, unchanged.
  it("EMPTY is the plain empty register, with no role and no failure styling", () => {
    const out = html("empty");
    expect(out).toContain("No machines yet");
    expect(out).not.toContain("role=");
    expect(out).not.toContain("v3-sheet__note--fail");
  });

  /**
   * The two mutations that used to pass. Named so a future reader knows these
   * assertions are load-bearing rather than incidental.
   */
  it("MUTATION GUARD: the failure's role cannot be downgraded to a status", () => {
    // Downgrading role="alert" to role="status" on `unreadable` is a one-line
    // change that made an unusable list announce itself as politely as a
    // partially-degraded one.
    expect(html("unreadable", 1)).toContain('role="alert"');
  });

  it("MUTATION GUARD: partial degradation and total failure cannot share copy", () => {
    // Collapsing the two into one message is the other one-line change that
    // passed. Same malformed count for both, so only the COPY can distinguish
    // them — if a future edit makes them identical, this fails.
    const degraded = html("degraded", 4);
    const unreadable = html("unreadable", 4);
    expect(degraded).not.toBe(unreadable);
    expect(unreadable).not.toContain("the rest are fine to ask about");
    expect(degraded).not.toContain("not an empty account");
  });

  // Singular/plural is user-visible text; a "1 entries" would be its own bug.
  it("reads correctly for a single bad row in both states", () => {
    expect(html("degraded", 1)).toContain("an entry");
    expect(html("unreadable", 1)).toContain("its only entry");
  });

  // The remaining states are rendered by the same component; a regression that
  // dropped one would otherwise show an empty sheet with no explanation.
  it("still renders the pre-existing states it absorbed", () => {
    expect(html("load-failed")).toContain('role="alert"');
    expect(html("loading")).toContain("Loading");
    expect(html("no-match", 0, "CV-9")).toContain("CV-9");
    expect(html(null)).toBe("");
  });
});
