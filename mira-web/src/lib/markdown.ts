/**
 * Restricted CommonMark renderer for long-form fault-code articles.
 * Supports headings, paragraphs, emphasis, links, lists (including
 * task items), blockquotes, and tables. Inline HTML is escaped.
 */

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESC[ch] ?? ch);
}

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:|\/|#)/i.test(href);
}

export function renderInlines(input: string): string {
  const out: string[] = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    if (s.startsWith("**", i)) {
      const end = s.indexOf("**", i + 2);
      if (end !== -1) {
        out.push(`<strong>${renderInlines(s.slice(i + 2, end))}</strong>`);
        i = end + 2;
        continue;
      }
    }
    if (s[i] === "*" && s[i + 1] !== "*") {
      const end = s.indexOf("*", i + 1);
      if (end !== -1 && !s.slice(i + 1, end).includes("\n")) {
        out.push(`<em>${renderInlines(s.slice(i + 1, end))}</em>`);
        i = end + 1;
        continue;
      }
    }
    if (s[i] === "[") {
      const close = s.indexOf("](", i);
      if (close !== -1) {
        const urlEnd = s.indexOf(")", close + 2);
        if (urlEnd !== -1) {
          const text = s.slice(i + 1, close);
          const href = s.slice(close + 2, urlEnd);
          if (isSafeHref(href)) {
            out.push(`<a href="${escHtml(href)}">${renderInlines(text)}</a>`);
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }
    let j = i + 1;
    while (j < s.length && s[j] !== "*" && s[j] !== "[") j++;
    out.push(escHtml(s.slice(i, j)));
    i = j;
  }
  return out.join("");
}

const HEADING = /^(#{1,6}) (.+)$/;
const UL_ITEM = /^(?:-|\*) (?:\[([ xX])\] )?(.+)$/;
const TABLE_SEP = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isTableStart(lines: string[], i: number): boolean {
  const line = lines[i];
  const next = lines[i + 1];
  return Boolean(line && next && line.includes("|") && TABLE_SEP.test(next));
}

function isListStart(line: string): boolean {
  return UL_ITEM.test(line);
}

function renderTable(lines: string[], start: number): { html: string; next: number } {
  const header = splitRow(lines[start]!);
  let i = start + 2;
  const rows: string[][] = [];
  while (i < lines.length && lines[i]!.includes("|") && !TABLE_SEP.test(lines[i]!) && lines[i]!.trim() !== "") {
    rows.push(splitRow(lines[i]!));
    i++;
  }
  const th = header.map((c) => `<th>${renderInlines(c)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInlines(c)}</td>`).join("")}</tr>`)
    .join("\n");
  const html = `<div class="table-wrap">\n<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>\n</div>`;
  return { html, next: i };
}

function renderList(lines: string[], start: number): { html: string; next: number } {
  const items: string[] = [];
  let i = start;
  let taskList = false;
  while (i < lines.length) {
    const m = lines[i]!.match(UL_ITEM);
    if (!m) break;
    const checked = m[1];
    const text = m[2] ?? "";
    if (checked !== undefined) {
      taskList = true;
      const isChecked = checked.toLowerCase() === "x";
      items.push(
        `<li><input type="checkbox" disabled${isChecked ? " checked" : ""}> ${renderInlines(text)}</li>`,
      );
    } else {
      items.push(`<li>${renderInlines(text)}</li>`);
    }
    i++;
  }
  const cls = taskList ? ' class="task-list"' : "";
  return { html: `<ul${cls}>\n${items.join("\n")}\n</ul>`, next: i };
}

function renderQuote(lines: string[], start: number): { html: string; next: number } {
  const quoted: string[] = [];
  let i = start;
  while (i < lines.length && (lines[i]!.startsWith(">") || lines[i]!.startsWith("> "))) {
    const raw = lines[i]!;
    quoted.push(raw.startsWith("> ") ? raw.slice(2) : raw.slice(1));
    i++;
  }
  // This corpus uses single-paragraph blockquotes.
  const text = quoted.join(" ").trim();
  return { html: `<blockquote>\n<p>${renderInlines(text)}</p>\n</blockquote>`, next: i };
}

/** Convert a markdown document to an HTML fragment (no wrapping <html>). */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1]!.length;
      blocks.push(`<h${level}>${renderInlines(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const q = renderQuote(lines, i);
      blocks.push(q.html);
      i = q.next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const t = renderTable(lines, i);
      blocks.push(t.html);
      i = t.next;
      continue;
    }
    if (isListStart(line)) {
      const l = renderList(lines, i);
      blocks.push(l.html);
      i = l.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i]!;
      if (current.trim() === "") break;
      if (current.match(HEADING) || current.startsWith(">") || isListStart(current) || isTableStart(lines, i)) break;
      para.push(current);
      i++;
    }
    if (para.length > 0) {
      blocks.push(`<p>${renderInlines(para.join(" "))}</p>`);
    }
  }
  return blocks.join("\n");
}

/** Visible text of an HTML fragment, whitespace-normalized, for copy checks. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
