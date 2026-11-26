import { describe, expect, test } from "bun:test";
import { renderInlines, renderMarkdown, visibleText } from "../markdown.js";

describe("renderInlines", () => {
  test("escapes HTML", () => {
    expect(renderInlines(`use <script> and "quotes" & amps`)).toBe(
      "use &lt;script&gt; and &quot;quotes&quot; &amp; amps",
    );
  });

  test("renders links, bold, and italics", () => {
    expect(renderInlines("See [F30011](https://example.com#page=525) and **Name** plus *italic*.")).toBe(
      'See <a href="https://example.com#page=525">F30011</a> and <strong>Name</strong> plus <em>italic</em>.',
    );
  });

  test("rejects unsafe hrefs", () => {
    expect(renderInlines("[x](javascript:alert(1))")).toBe("[x](javascript:alert(1))".replace(/[<>"]/g, (c) => c));
    expect(renderInlines("[x](javascript:alert(1))")).toContain("javascript:alert(1)");
    expect(renderInlines("[x](javascript:alert(1))")).not.toContain("<a ");
  });
});

describe("renderMarkdown", () => {
  test("renders headings, quotes, lists, task items, and tables", () => {
    const html = renderMarkdown(`# Title

> **Before you go further:** stay safe.

| At a glance | |
|---|---|
| **Observed symptom** | F30011 |

- A line phase has failed.

- [ ] Record the exact code.
`);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<strong>Before you go further:</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>Observed symptom</strong>");
    expect(html).toContain("<li>A line phase has failed.</li>");
    expect(html).toContain('class="task-list"');
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(visibleText(html)).toContain("Record the exact code.");
  });
});
