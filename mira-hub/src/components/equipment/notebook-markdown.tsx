"use client";

// Equipment Notebook answer renderer (RNDR-1 / RNDR-2, ChatGPT-parity PRD).
//
// Commodity-before-custom: markdown is rendered by `react-markdown` (MIT) with
// `remark-gfm` (tables / task lists / strikethrough) and `remark-breaks` (soft
// line breaks → <br>, so multi-step answers keep the line breaks the old
// `whitespace-pre-wrap` renderer preserved). No `rehype-raw`: raw HTML in an
// answer is escaped, never executed.
//
// Citation `[n]` markers become chips INSIDE the markdown tree (tables, lists,
// bold runs) via a tiny remark plugin built on `mdast-util-find-and-replace`
// (MIT) — the same primitive GFM autolink-literal uses. Only markers with a
// matching citation are converted; an unmatched `[7]` stays plain text so we
// never render a dead citation button (existing contract).

import { useCallback, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";
import { Check, Copy } from "lucide-react";
import type { EvidenceCitation } from "@/lib/notebook-chat-types";

/** Href prefix used to smuggle a citation marker through the mdast `link` node
 *  to the `a` component renderer. Never reaches the DOM as an <a>. */
export const CITE_HREF_PREFIX = "#mira-cite-";

/** remark plugin: `[n]` in text nodes → `link` node pointing at `#mira-cite-n`
 *  when `n` is a known citation id. Text inside existing links is skipped
 *  (find-and-replace default), so a real markdown link is never mangled. */
export function remarkCitationChips(options: { citationIds: ReadonlySet<string> }) {
  return (tree: Root) => {
    findAndReplace(tree, [
      /\[(\d+)\]/g,
      (match: string, n: string) =>
        options.citationIds.has(n)
          ? { type: "link", url: `${CITE_HREF_PREFIX}${n}`, children: [{ type: "text", value: match }] }
          : false,
    ]);
  };
}

/** Pull the plain text out of a <code> element's children (react-markdown
 *  gives us a string, or an array of strings/elements for highlighted code). */
export function codeText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(codeText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return codeText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/** `language-xyz` → `xyz`; no class → "". */
export function languageOf(className?: string): string {
  const m = /language-([\w+-]+)/.exec(className ?? "");
  return m ? m[1] : "";
}

/** Commodity clipboard (navigator.clipboard). Returns false when unavailable
 *  (insecure context / old WebView) so the button can fail honestly. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Fenced code block: language label + copy button (RNDR-2). No run, no preview. */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  // react-markdown renders <pre><code className="language-x">…</code></pre>;
  // we receive the <code> element as our only child.
  const codeEl =
    children && typeof children === "object" && "props" in children
      ? (children as { props: { className?: string; children?: ReactNode } })
      : null;
  const lang = languageOf(codeEl?.props.className);
  const text = codeText(codeEl?.props.children ?? children);

  const onCopy = useCallback(async () => {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [text]);

  return (
    <div
      className="my-2 overflow-hidden rounded-lg text-xs"
      style={{ border: "1px solid var(--border)", background: "var(--surface-1)" }}
      data-testid="code-block"
    >
      <div
        className="flex items-center justify-between px-2 py-1"
        style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground-subtle)" }}
      >
        <span className="font-mono" data-testid="code-lang">{lang || "code"}</span>
        <button
          type="button"
          onClick={() => void onCopy()}
          className="inline-flex min-h-[24px] items-center gap-1 rounded px-1.5"
          style={{ color: "var(--foreground-muted)" }}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-2 font-mono leading-relaxed" style={{ color: "var(--foreground)" }}>
        {children}
      </pre>
    </div>
  );
}

/** Rounded numbered chip ≥24px — PRD §26 forbids tiny hit targets. */
export function CitationChip({ c, onCite }: { c: EvidenceCitation; onCite?: (c: EvidenceCitation) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCite?.(c)}
      className="mx-0.5 inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full px-1.5 text-xs font-semibold align-baseline"
      style={{ background: "var(--brand-blue)", color: "white" }}
      aria-label={`Open citation ${c.citationId}: ${c.sourceTitle}${c.page != null ? `, page ${c.page}` : ""}`}
    >
      {c.citationId}
    </button>
  );
}

/** Assistant answer body: GFM markdown with inline citation chips. */
export function AnswerMarkdown({
  content,
  citations,
  onCite,
}: {
  content: string;
  citations: EvidenceCitation[];
  onCite?: (c: EvidenceCitation) => void;
}) {
  const citationIds = new Set(citations.map((c) => c.citationId));
  const components: Components = {
    a: ({ href, children, ...rest }) => {
      if (href?.startsWith(CITE_HREF_PREFIX)) {
        const id = href.slice(CITE_HREF_PREFIX.length);
        const c = citations.find((x) => x.citationId === id);
        if (c) return <CitationChip c={c} onCite={onCite} />;
        return <>{children}</>;
      }
      // Ordinary links: open in a new tab; never a same-window navigation away
      // from the notebook. (Mobile routes through its own deep-link seam.)
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand-blue)" }} {...rest}>
          {children}
        </a>
      );
    },
    // Images never render as <img>: an LLM- or manual-authored
    // `![alt](https://…)` would otherwise be a network beacon on every render
    // (the plain-text renderer this replaces made no requests). Alt text only.
    img: ({ alt }) => <span>{alt ? `[image: ${alt}]` : ""}</span>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    code: ({ className, children, ...rest }) => (
      <code
        className={className ? `${className} font-mono` : "rounded px-1 font-mono text-[0.9em]"}
        style={className ? undefined : { background: "var(--surface-1)" }}
        {...rest}
      >
        {children}
      </code>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs" style={{ border: "1px solid var(--border)" }}>
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="px-2 py-1 text-left font-semibold" style={{ border: "1px solid var(--border)", background: "var(--surface-1)" }}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-2 py-1 align-top" style={{ border: "1px solid var(--border)" }}>
        {children}
      </td>
    ),
    ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
    li: ({ children }) => <li className="my-0.5">{children}</li>,
    p: ({ children }) => <p className="my-1">{children}</p>,
    h1: ({ children }) => <h3 className="mt-2 mb-1 text-base font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold">{children}</h3>,
    h3: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold">{children}</h4>,
    blockquote: ({ children }) => (
      <blockquote className="my-1 pl-2" style={{ borderLeft: "3px solid var(--border)", color: "var(--foreground-muted)" }}>
        {children}
      </blockquote>
    ),
  };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, [remarkCitationChips, { citationIds }]]}
      components={components}
      // Only http(s)/mailto plus our chip hrefs survive; javascript: etc. are
      // stripped by react-markdown's default url transform.
    >
      {content}
    </ReactMarkdown>
  );
}
