/**
 * #4690: "The safety warning runs straight into 'Yes—' with no break. Nobody's
 * gonna read it." The server writes its ⚠️ lines above the answer, joined by a
 * blank line, but /v3 rendered them as the answer's first, 3.5px-spaced
 * paragraph. The host now splits the leading ⚠️ paragraphs out and renders them
 * in the shell's warning block. These pin the split; the text itself never changes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerWithSafety } from "./answer-with-safety";
import { splitLeadingSafetyNotes } from "./hub-host-logic";

// The staging answer from the report (notebook d33363a1, 2026-10-24).
const ISOLATION =
  "⚠️ **Isolation.** Lock and tag every energy source (electrical, pneumatic, hydraulic, gravity) and verify zero energy before hands-on work.";
const ANSWER = "Yes—switch off and isolate the 24 V supply before replacing the wiring [1].\n\nThen reconnect the connector.";

describe("splitLeadingSafetyNotes — #4690 the warning above an answer is its own block", () => {
  it("splits the reported isolation line from the answer that followed it", () => {
    expect(splitLeadingSafetyNotes(`${ISOLATION}\n\n${ANSWER}`)).toEqual({ notes: ISOLATION, body: ANSWER });
  });

  it("keeps stacked banners together (a hazard banner over a step flag)", () => {
    const flag = "⚠️ **Safety flag on a step below:** “jumper the interlock”.";
    expect(splitLeadingSafetyNotes(`${ISOLATION}\n\n${flag}\n\n${ANSWER}`)).toEqual({ notes: `${ISOLATION}\n\n${flag}`, body: ANSWER });
  });

  it("changes nothing when the answer has no leading warning (control)", () => {
    expect(splitLeadingSafetyNotes(ANSWER)).toEqual({ notes: "", body: ANSWER });
  });

  it("leaves a ⚠️ later in the answer where the writer put it", () => {
    const text = `${ANSWER}\n\n⚠️ Recheck the guard before restarting.`;
    expect(splitLeadingSafetyNotes(text)).toEqual({ notes: "", body: text });
  });

  it("shows a banner on its own while the rest of the answer is still streaming", () => {
    expect(splitLeadingSafetyNotes(`${ISOLATION}\n\n`)).toEqual({ notes: ISOLATION, body: "" });
    expect(splitLeadingSafetyNotes(ISOLATION)).toEqual({ notes: ISOLATION, body: "" });
  });

  it("never rewrites the answer: the body is the original text after the warning", () => {
    const text = `${ISOLATION}\n\n${ANSWER}`;
    const { notes, body } = splitLeadingSafetyNotes(text);
    expect(text.startsWith(notes)).toBe(true);
    expect(text.endsWith(body)).toBe(true);
  });

  it("is what /v3 renders for every answer turn", () => {
    const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
    const render = host.slice(host.indexOf("const renderText = useCallback"), host.indexOf("const onCopy = useCallback"));
    expect(render).toContain("return <AnswerWithSafety text={text} markdown={markdown} />;");
  });

  it("styles the block from theme tokens and sets it apart from the answer", () => {
    const css = readFileSync(new URL("../../../packages/factorylm-ui/src/conversation.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.fl-safety--text \{ display: block; margin-block-end: var\(--fl-workspace-space-3\); \}/);
  });

  it("renders the warning in its own block, before and apart from the answer", () => {
    const html = renderToStaticMarkup(<AnswerWithSafety text={`${ISOLATION}\n\n${ANSWER}`} markdown={(c) => <p>{c}</p>} />);
    expect(html.startsWith('<div class="fl-safety fl-safety--text" role="note" aria-label="Safety warning"><p>⚠️ **Isolation.**')).toBe(true);
    expect(html).toContain("</div><p>Yes—switch off");
  });

  it("renders an answer without a leading warning exactly as before (control)", () => {
    expect(renderToStaticMarkup(<AnswerWithSafety text={ANSWER} markdown={(c) => <p>{c}</p>} />)).toBe(`<p>${ANSWER}</p>`);
  });
});
