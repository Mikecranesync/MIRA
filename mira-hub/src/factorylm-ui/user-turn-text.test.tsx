/**
 * #4751: "I typed two lines and a numbered list of 12. My own message comes
 * back as one run-on paragraph with '2. What is…' glued mid-sentence." The
 * sent bubble must keep the technician's own line breaks — Shift+Enter lines
 * and a pasted numbered list — without reinterpreting the text as markdown.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UserTurnText } from "./user-turn-text";

const TWO_LINE = "wht r the analog input specs\nsecond line";
const PASTED_LIST = "1. What is the max input voltage?\n2. What is the sample rate?\n3. What is the resolution?";

describe("UserTurnText — #4751 the sent bubble keeps the technician's own line breaks", () => {
  it("preserves a Shift+Enter line break (the reported repro)", () => {
    const html = renderToStaticMarkup(<UserTurnText text={TWO_LINE} />);
    expect(html).toContain("wht r the analog input specs\nsecond line");
    expect(html).not.toContain("specs second line");
  });

  it("preserves every line of a pasted numbered list, not glued mid-sentence", () => {
    const html = renderToStaticMarkup(<UserTurnText text={PASTED_LIST} />);
    expect(html).toContain(PASTED_LIST);
    expect(html).not.toContain("voltage? 2.");
  });

  it("sets white-space: pre-wrap so the browser keeps the newlines (not markdown)", () => {
    const html = renderToStaticMarkup(<UserTurnText text={TWO_LINE} />);
    expect(html).toContain('style="white-space:pre-wrap"');
    // Plain text, not reinterpreted: no <ol>/<li>/<p> introduced for a pasted list.
    const listHtml = renderToStaticMarkup(<UserTurnText text={PASTED_LIST} />);
    expect(listHtml).not.toMatch(/<ol|<li|<p[ >]/);
  });

  it("renders a single-line message exactly as before (control)", () => {
    const html = renderToStaticMarkup(<UserTurnText text="how do I reset the fault" />);
    expect(html).toBe('<span style="white-space:pre-wrap">how do I reset the fault</span>');
  });

  it("is what /v3 renders for every user turn", () => {
    const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
    const render = host.slice(host.indexOf("const renderText = useCallback"), host.indexOf("const onCopy = useCallback"));
    expect(render).toContain('if (turn.role === "user") return <UserTurnText text={text} />;');
  });

  it("does not touch shared conversation.css (#4677 has a live diff on .fl-part--text)", () => {
    const css = readFileSync(new URL("../../../packages/factorylm-ui/src/conversation.css", import.meta.url), "utf8");
    expect(css).not.toContain("pre-wrap");
  });

  it("leaves assistant-turn rendering (markdown, citations) untouched (control)", () => {
    const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
    const render = host.slice(host.indexOf("const renderText = useCallback"), host.indexOf("const onCopy = useCallback"));
    expect(render).toContain("return <AnswerWithSafety text={text} markdown={markdown} />;");
  });
});
