import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * V3 surface contract.
 *
 * These assert the source-level shape of the approved design, because the
 * failures they guard against are ones a rendering test would not catch: a
 * status code leaking into user copy, the default route changing, or the
 * groundedness claim being inferred from absence rather than stated.
 *
 * Design source: docs/prototypes/factorylm-unified-ui-v3/index.html.
 */
const here = dirname(fileURLToPath(import.meta.url));
const pageRaw = readFileSync(resolve(here, "page.tsx"), "utf8");
/** Comments in this file deliberately NAME the copy we forbid, so a whole-file
 *  scan matches its own documentation — the same self-reference the detector
 *  suite hit twice. Strip comments and assert on what can actually render. */
const page = pageRaw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const css = readFileSync(resolve(here, "v3.css"), "utf8");

describe("V3 — errors are humane (recon G-1…G-5)", () => {
  it("never renders an HTTP status code in user-facing copy", () => {
    // The live product showed "Chat unavailable (412)". The recon's finding was
    // not that the number was wrong — it was that a number is not a sentence.
    const strings = page.match(/"[^"]{12,}"/g) ?? [];
    const withStatus = strings.filter((s) => /\((?:[1-5]\d\d)\)/.test(s));
    expect(withStatus).toEqual([]);
  });

  it("never tells the technician to reload as a remedy", () => {
    // Advice that cannot work: reloading does not satisfy a gate, restore a
    // connection, or re-run a failed provider call.
    expect(page.toLowerCase()).not.toContain("refresh the " + "page");
    expect(page.toLowerCase()).not.toContain("reload the " + "page");
  });

  it("the comment-stripper actually strips (positive control)", () => {
    // If the stripper silently did nothing, every assertion above would be
    // scanning documentation as though it were code.
    expect(pageRaw).toContain("Design source");
    expect(page).not.toContain("Design source");
  });

  it("preserves the question when a send fails", () => {
    // A failed message must exist in exactly one place, and the composer is
    // the place the technician can act from.
    expect(page).toContain("setInput(q)");
  });

  it("offers a button on every failure, not just an explanation", () => {
    expect(page).toContain("Try again");
    expect(page).toContain("Dismiss");
  });
});

describe("V3 — the claim is stated, never inferred (recon E-1/E-2)", () => {
  it("labels a grounded answer positively", () => {
    expect(page).toContain("Grounded in");
  });

  it("labels an ungrounded answer explicitly rather than leaving it blank", () => {
    // Absence of a citation is indistinguishable from a citation that failed to
    // render — which is the state the mobile walk was actually in.
    // Wording changed with the scope picker: "no manual on file" was a claim
    // about the CORPUS, and it is wrong for a bound machine whose manuals
    // exist but returned no chunk for this question. "No source cited" is a
    // claim about THIS ANSWER, which is the thing actually known.
    expect(page).toContain("General guidance — no source cited");
  });

  it("renders a citation by document name and page, never by id", () => {
    expect(page).toContain("v3-doc");
    expect(page).toContain("p.{c.page}");
    // The observed defect was a UUID filename standing in for the document.
    expect(page).not.toMatch(/citationId.*uuid/i);
  });

  it("reuses the notebook renderer so an unmatched [n] cannot become a dead chip", () => {
    expect(page).toContain("AnswerMarkdown");
    expect(page).not.toContain('from "react-markdown"');
  });
});

describe("V3 — the composer is the home screen (recon A-1/B-1)", () => {
  it("greets with the task, not the system", () => {
    expect(page).toContain("What are you working on?");
    expect(page).not.toContain("Command Board");
    expect(page).not.toContain("Proposal flywheel");
  });

  it("focuses the input on mount", () => {
    expect(page).toContain("taRef.current?.focus()");
  });

  it("names the waiting step rather than showing a bare spinner", () => {
    expect(page).toContain("WAIT_STEPS");
    expect(page).toContain("Searching your manuals…");
  });

  it("says what it is scoped to, so it never implies plant context", () => {
    // The literal string now lives in `scopeLabel` (ScopePicker.tsx), which is
    // asserted in ScopePicker.test.ts. What matters HERE is that the header and
    // the composer both read from that one function — two hand-written strings
    // would let the badge say "CV-101" while the composer still said "general".
    expect(page).toContain("scopeLabel(scope)");
    expect(page).toContain("scopeHint(scope)");
  });

  it("routes by scope rather than always calling the general endpoint", () => {
    // The silent failure this guards: a machine-scoped question sent to
    // /api/hub/ask returns a fluent generic answer that reads as specific.
    expect(page).toContain("askEndpointFor(");
    expect(page).not.toMatch(/fetch\(`\$\{API_BASE\}\/api\/hub\/ask`/);
  });

  it("renders a 412 as a refusal with its missing pieces, never as an error", () => {
    // A 412 is the approved-context gate holding — the product working. It
    // must not offer Retry, which cannot change the outcome.
    expect(page).toContain("res.status === 412");
    expect(page).toContain("missingContext");
    expect(page).toContain("Ask generally instead");
  });
});

describe("V3 — mounted without disturbing the existing product", () => {
  it("lives at a non-default route", () => {
    // FLM-UI-4000 Phase 2: a private, non-default route. /feed is untouched,
    // so no existing user's landing screen changes.
    expect(here.replace(/\\/g, "/")).toMatch(/\/app\/v3$/);
  });

  it("keeps every touch target at or above 44px", () => {
    const targets = css.match(/min-height:44px|height:44px/g) ?? [];
    expect(targets.length).toBeGreaterThanOrEqual(4);
  });

  it("scopes its styles so it cannot leak into other Hub routes", () => {
    const rules = css.split("\n").filter((l) => /^\.[a-z]/.test(l.trim()));
    const unscoped = rules.filter((l) => !/^\.v3/.test(l.trim()));
    expect(unscoped).toEqual([]);
  });
});
