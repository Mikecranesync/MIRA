import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnswerMarkdown } from "./equipment/notebook-markdown";

/**
 * B-3 — the asset chat printed markdown instead of rendering it.
 *
 * The proof needs no browser and no fixture: the surface's own WELCOME string
 * contains `**${name}**`, and the bubble rendered `{msg.content}` inside a
 * `whitespace-pre-wrap` div. So the first thing a technician saw on that screen
 * was `**PowerFlex 525**`, asterisks and all — the recon's "raw markdown leaks"
 * finding, sitting in the product's own greeting.
 *
 * Two assertions, deliberately different in kind:
 *   1. the renderer turns GFM into elements (behaviour);
 *   2. the surface actually calls it, and no longer leans on
 *      `whitespace-pre-wrap` to display a raw string (wiring).
 *
 * The second is the one that was missing. A working renderer that nothing calls
 * is the shape this codebase kept producing today.
 */

const RAW = readFileSync(join(__dirname, "AssetChat.tsx"), "utf8");
/** Comments in AssetChat.tsx deliberately NAME `whitespace-pre-wrap` to explain
 *  why it was removed, so a whole-file scan matches its own documentation —
 *  the third appearance of this self-reference trap in one day. Strip comments
 *  and assert on what can actually render. */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("B-3 — markdown is rendered, not printed", () => {
  it("the renderer turns bold into an element, not asterisks", () => {
    const html = renderToStaticMarkup(
      <AnswerMarkdown content="Ask me about **PowerFlex 525** (CV-101)." citations={[]} />,
    );
    expect(html).toContain("<strong>PowerFlex 525</strong>");
    expect(html).not.toContain("**PowerFlex 525**");
  });

  it("renders a bullet list as a list", () => {
    const html = renderToStaticMarkup(
      <AnswerMarkdown content={"Checks:\n\n- supply voltage\n- acceleration time"} citations={[]} />,
    );
    expect(html).toMatch(/<li[ >]/);
  });

  it("the comment-stripper actually strips (positive control)", () => {
    // Without this, every source assertion below would be scanning prose that
    // deliberately names the thing it forbids.
    expect(RAW).toContain("whitespace-pre-wrap");
    expect(SRC).not.toContain("whitespace-pre-wrap");
  });

  it("the asset chat actually calls the renderer", () => {
    // Wiring, not behaviour. The renderer already worked on the notebook chat;
    // what failed here was that this surface never used it.
    expect(SRC.length, "AssetChat.tsx read as empty").toBeGreaterThan(1000);
    expect(SRC).toMatch(/<AnswerMarkdown\s/);
  });

  it("no longer displays the answer as a preformatted raw string", () => {
    // `whitespace-pre-wrap` on the bubble was the mechanism: it made the raw
    // markdown look deliberate. Its absence on that element is the fix.
    // Anchor on the RENDER site, not the import — `indexOf("AnswerMarkdown")`
    // finds the import statement first, which sits above the bubble and slices
    // backwards to "". The non-empty assertion below caught exactly that.
    const start = SRC.indexOf("rounded-2xl rounded-tl-sm");
    const end = SRC.indexOf("<AnswerMarkdown", start);
    const bubble = start >= 0 && end > start ? SRC.slice(start, end) : "";
    expect(bubble, "bubble/renderer anchors moved — re-anchor this test").not.toBe("");
    expect(bubble).not.toContain("whitespace-pre-wrap");
  });

  it("the greeting that exposed this is still markdown, so the fix stays load-bearing", () => {
    // If WELCOME ever stops containing markdown, this test's premise is gone
    // and someone should know rather than have it quietly pass forever.
    expect(SRC).toMatch(/WELCOME[\s\S]{0,200}\*\*\$\{name\}\*\*/);
  });
});
