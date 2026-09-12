import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { failureMessage, statusFromError } from "./AssetChat";

/**
 * G-1…G-5 — humane failures.
 *
 * The live product said, verbatim:
 *
 *     Chat unavailable (412). Try again or refresh the page.
 *
 * Three defects in one sentence, and the recon named all three:
 *   - a status code is not a sentence (G-1);
 *   - refreshing cannot satisfy a gate, restore a connection, or re-run a
 *     provider call — advice that cannot work is worse than none (G-2);
 *   - it was a red banner telling the technician to "try again" with nothing to
 *     press (G-3/G-4).
 *
 * And the deepest one: **a 412 is not an outage.** It is MIRA refusing for a
 * stated reason, which read as breakage only because we rendered it as
 * breakage.
 */

const RAW = readFileSync(join(__dirname, "AssetChat.tsx"), "utf8");
/** The comments below deliberately quote the forbidden copy to explain why it
 *  was removed, so a whole-file scan matches its own documentation. Strip
 *  comments and assert on what can actually render. */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("failureMessage — no status codes, no impossible advice", () => {
  it("never renders a status code", () => {
    for (const status of [400, 401, 412, 429, 500, 502, null]) {
      const msg = failureMessage(status);
      expect(msg, `"${msg}" leaks a status code`).not.toMatch(/\d{3}/);
    }
  });

  it("never tells the technician to refresh or reload", () => {
    for (const status of [412, 500, null]) {
      const msg = failureMessage(status).toLowerCase();
      expect(msg).not.toContain("refresh");
      expect(msg).not.toContain("reload");
    }
  });

  it("says the message is still here, because it is", () => {
    // `restoreComposer` puts the failed text back in the box, so this is a
    // statement of fact rather than reassurance. If that ever stops being true
    // this copy becomes a lie, which is why it is asserted.
    expect(failureMessage(null)).toContain("still here");
    expect(SRC).toContain("restoreComposer");
  });

  it("treats a 412 as a refusal, not an outage", () => {
    // The distinction the original copy erased. A 412 means MIRA needs machine
    // context; calling that "unavailable" told the technician the product was
    // broken when it was asking them a question.
    const refusal = failureMessage(412).toLowerCase();
    expect(refusal).toContain("machine");
    expect(refusal).not.toContain("unavailable");
    expect(refusal).not.toEqual(failureMessage(null).toLowerCase());
  });
});

describe("statusFromError — the number reaches the log, never the technician", () => {
  it("recovers the status from the thrown error", () => {
    expect(statusFromError(new Error("request failed with status 412"))).toBe(412);
    expect(statusFromError(new Error("request failed with status 503"))).toBe(503);
  });

  it("returns null for a transport failure", () => {
    expect(statusFromError(new TypeError("Failed to fetch"))).toBeNull();
    expect(statusFromError(undefined)).toBeNull();
  });

  it("does not mistake an arbitrary 3-digit number for a status", () => {
    // The old code ran /(\d{3})/ over the whole message, so any three digits
    // anywhere became "the status code" and got shown to a human.
    expect(statusFromError(new Error("timed out after 300 ms"))).toBeNull();
  });
});

describe("the banner is a state to act from, not a wall", () => {
  it("the comment-stripper actually strips (positive control)", () => {
    expect(RAW).toContain("refresh the page");
    expect(SRC).not.toContain("refresh the page");
  });

  it("offers a retry control, not just the word", () => {
    expect(SRC).toContain('data-testid="chat-retry"');
    expect(SRC).toMatch(/void sendMessage\(t\)/);
  });

  it("can be dismissed, so it cannot become permanent", () => {
    expect(SRC).toContain('data-testid="chat-error-dismiss"');
  });

  it("no user-facing string in this file carries a parenthesised status code", () => {
    // A single-line literal scan: a TS string cannot span a newline, and the
    // positional `"[^"]{12,}"` form pairs quotes wrongly the moment a literal
    // shorter than the minimum appears — which is how the V3 guard for this
    // exact defect ended up scanning the code between literals.
    const literals = (SRC.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []).filter((l) => l.length >= 14);
    expect(literals.length, "literal scan found nothing — re-check the pattern").toBeGreaterThan(5);
    expect(literals.filter((l) => /\((?:[1-5]\d\d)\)/.test(l))).toEqual([]);
  });
});
