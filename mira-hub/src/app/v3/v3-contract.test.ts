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
    // A TS string literal cannot span a newline — that is the discriminator, and
  // the previous pattern lacked it.
  //
  // `/"[^"]{12,}"/g` pairs quotes BY POSITION. Line 1 of this page is
  // `"use client";` and `use client` is 10 characters — under the 12 minimum —
  // so that literal's OPENING quote is skipped and matching resumes from its
  // CLOSING quote. Everything after pairs off by one, and the regex matches the
  // code BETWEEN literals instead of the literals. Measured on the shipped
  // file: 113 "matches", 95 of them spanning a newline, the first being
  // `";\n\nimport { useCallback, useEffect, useRef, useState } from`.
  //
  // So `strings` never held a single piece of user copy, and the status-code
  // filter below was scanning code and always finding nothing. The guard RAN,
  // was REACHED by the gate, and reported green — while structurally unable to
  // see its own subject. A correct scan finds 37 real literals.
  const strings = (page.match(/"(?:[^"\\\n]|\\.)*"/g) ?? []).filter((s) => s.length >= 14);
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

  it("reads every scope-derived string from the shared module", () => {
    // NOT a text pin. The previous version of this asserted the literal
    // `hint: "General question" }` in this file, and a peer reinstated the
    // exact defect as `const hint = "General question";` with all 22 tests
    // green — hoisting to a variable walks straight past a literal.
    //
    // The behavioural assertions now live in ScopePicker.test.ts, where the
    // functions are. What this file still owns is that page.tsx does not grow
    // a FIFTH decider: it must read all four strings from the shared module,
    // never compute one itself.
    for (const fn of ["scopeLabel(scope)", "scopeHint(scope)", "suggestionsFor(scope)"]) {
      expect(page).toContain(fn);
    }
    expect(page).not.toContain("General question");
    expect(page).not.toContain("SUGGESTIONS");
  });

  it("unwinds every turn-scoped notice on New chat, not just the error", () => {
    // Found by applying #3681's lesson to this file: `signedOut` was set on a
    // 401 and cleared only at the start of the NEXT send, so the "Sign in to
    // ask" notice sat under an empty thread after New chat. The direction that
    // sets a notice gets written and verified; the direction that clears it
    // has no author.
    const newChat = page.slice(page.indexOf('className="v3-new"'));
    const handler = newChat.slice(0, 400);
    for (const clear of ["setTurns([])", "setError(null)", "setSignedOut(false)"]) {
      expect(handler).toContain(clear);
    }
    // The scope is a user CHOICE, not turn state — it must survive New chat.
    expect(handler).not.toContain("setScope(null)");
  });

  it("keeps the refusal on the turn, so it cannot outlive it", () => {
    // The structural reason V3 is immune to the #3681 leak: the refusal is a
    // field on the assistant turn, not separate component state, so clearing
    // the thread clears it by construction. Asserted so a later refactor to
    // `useState` would have to argue with this.
    expect(page).not.toContain("useState<Refusal");
    expect(page).toContain("refusal?: Refusal;");
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

  // H-1, decided 2026-09-08: a control may LOOK 44px, but its interactive hit
  // area must be at least 48px/48dp — gloves, one-handed reach, a technician
  // not looking straight at the screen. That separates the two questions the
  // 44-vs-48 spec conflict had fused together.
  //
  // The previous version of this test counted occurrences of the literal
  // `min-height:44px` and asserted `>= 4`. That is not a floor: it passes if
  // four controls are 44 and a fifth is 20, and it would have gone RED on this
  // very change, which raises the floor. Replaced with the actual invariant.
  describe("touch targets (H-1)", () => {
    const heights = [...css.matchAll(/(?:min-)?height:\s*(\d+)px/g)].map((m) => Number(m[1]));

    it("declares no interactive height between the icon size and 48px", () => {
      // Everything is either >= 48 (a real target), or exactly 44 (the two
      // square controls, which carry an expander asserted below), or small
      // decoration (marks, avatars, the hamburger's bars) that is never a
      // target in its own right.
      // 36 (scope badge), 38 (Copy/Retry, notice buttons) and 44 (square icons)
      // are the visual heights of controls that carry an expander, asserted
      // below. Anything else in this band is an unguarded small target.
      const expanded = [36, 38, 44];
      const suspicious = heights.filter((h) => h > 28 && h < 48 && !expanded.includes(h));
      expect(suspicious).toEqual([]);
    });

    it("every 44px control expands its hit area to 48", () => {
      // The visual box stays 44; `inset:-2px` adds 2px on each side. Without
      // this the 44s above would be a silent exemption rather than a
      // documented one.
      // Every under-48 control must be `position:relative` (or the overlay
      // escapes to the nearest positioned ancestor and covers the wrong thing)
      // AND must have an ::after. Both halves, or the expander is decorative.
      for (const sel of [".v3-icon", ".v3-ham", ".v3-scope"]) {
        expect(css).toMatch(new RegExp(`\\${sel}\\{[^}]*position:relative`));
        expect(css).toContain(`${sel}::after`);
      }
      for (const sel of [".v3-actions button", ".v3-noticerow button"]) {
        expect(css).toContain(`${sel}::after`);
        expect(css).toMatch(new RegExp(`\\${sel.replace(" ", " ")}\\{[^}]*position:relative`));
      }
      // The insets must actually reach 48 from each visual height.
      for (const inset of ["-2px", "-5px", "-6px"]) {
        expect(css).toContain(`inset: ${inset}`);
      }
    });

    it("the height matcher actually finds heights (positive control)", () => {
      // Without this, a regex that silently matched nothing would make the
      // filter above vacuously empty and the suite green on any CSS at all.
      expect(heights.length).toBeGreaterThan(5);
      expect(heights).toContain(48);
      expect(heights).toContain(44);
    });
  });

  it("scopes its styles so it cannot leak into other Hub routes", () => {
    const rules = css.split("\n").filter((l) => /^\.[a-z]/.test(l.trim()));
    const unscoped = rules.filter((l) => !/^\.v3/.test(l.trim()));
    expect(unscoped).toEqual([]);
  });
});
