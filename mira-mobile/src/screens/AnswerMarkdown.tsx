// Answer body renderer (RNDR-1 / RNDR-2). Commodity-before-custom: markdown
// is `react-markdown` + `remark-gfm` (both MIT) — tables, lists, bold, code,
// headings. NO `rehype-raw`, no HTML passthrough: the model's text is data,
// never markup. What stays MIRA-owned is the meaning layered on top:
//   - `[n]` citation marks become the existing chip button via a remark
//     plugin over TEXT nodes (lib/remark-citation-marks.ts), so a chip works
//     inside a table cell or list item without pre-splitting the string;
//   - links never `window.open` (client.ts trust boundary): they render as
//     their visible text plus the URL in parentheses, so a technician can
//     still read where it pointed;
//   - images never render as `<img>` (ADR-0034: no remote content in the
//     shell). `![alt](url)` in model text would otherwise make the WebView
//     fetch an arbitrary host — a tracking pixel or an unbounded download.
//     They render as the fallback "[image: alt]" with the URL SUPPRESSED
//     (same shape as the web notebook), so nothing is fetched and nothing
//     invites a tap;
//   - soft newlines render as line breaks (`remark-breaks`, MIT) — the same
//     convergence choice the web notebook made, so a model answer that wraps
//     lines paints identically on both clients;
//   - code blocks get a language label and a copy button (platform clipboard).
// Refusal / safety / error copy is plain text and renders unchanged — a
// status sentence contains no markdown.
import { Children, isValidElement, useMemo, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { remarkCitationMarks } from "../lib/remark-citation-marks";
import type { ChatCitation } from "../lib/sse";

async function copyText(text: string): Promise<boolean> {
  // @capacitor/clipboard is not a dependency of this shell; the WebView's
  // `navigator.clipboard` is the platform primitive and works in-app.
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <div className="code-block-bar">
        <span className="code-block-lang">{language || "code"}</span>
        <button
          type="button"
          className="btn-link code-block-copy"
          aria-label="Copy code"
          onClick={() => {
            void copyText(code).then((ok) => {
              setCopied(ok);
              if (ok) setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function AnswerMarkdown({
  text,
  citations,
  onCitation,
}: {
  text: string;
  citations: ChatCitation[];
  onCitation?: (c: ChatCitation) => void;
}) {
  const byId = useMemo(() => new Map(citations.map((c) => [c.citationId, c])), [citations]);
  const plugins = useMemo(
    () => [
      remarkGfm,
      remarkBreaks,
      [remarkCitationMarks, { knownIds: new Set(byId.keys()) }] as const,
    ],
    [byId],
  );

  const components: Components = {
    cite: (props) => {
      // hProperties keys pass through verbatim (`data-cite-id`), both on the
      // hast node and as the DOM prop.
      const id = String((props as Record<string, unknown>)["data-cite-id"] ?? "");
      const c = byId.get(id);
      if (!c) return <>[{id}]</>;
      return (
        <button
          type="button"
          className="cite-mark"
          aria-label={`Citation ${id}`}
          onClick={() => onCitation?.(c)}
        >
          [{id}]
        </button>
      );
    },
    a: ({ children, href }) => {
      const label = textOf(children);
      const url = typeof href === "string" ? href : "";
      return (
        <span className="answer-link">
          {label}
          {url && url !== label ? ` (${url})` : ""}
        </span>
      );
    },
    img: ({ alt }) => {
      // The URL is deliberately dropped: an image URL in answer text is not
      // evidence a technician can act on, and echoing it invites a paste
      // into a browser that would fetch it. Web renders the same fallback.
      const label = (alt ?? "").trim() || "image";
      return <span className="answer-image">[image: {label}]</span>;
    },
    pre: ({ children }) => {
      const child = Children.toArray(children)[0];
      let language = "";
      let code = "";
      if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
        const m = /language-([\w+-]+)/.exec(child.props.className ?? "");
        language = m?.[1] ?? "";
        code = textOf(child.props.children).replace(/\n$/, "");
      } else {
        code = textOf(children);
      }
      return <CodeBlock language={language} code={code} />;
    },
    table: ({ children }) => (
      <div className="answer-table-wrap">
        <table>{children}</table>
      </div>
    ),
  };

  return (
    <div className="msg-answer answer-md">
      <Markdown remarkPlugins={plugins as never} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
