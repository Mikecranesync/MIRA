"use client";

// Equipment Notebook chat — source-grounded, mobile-first, clickable citations.
// The leaf renderer (Bubble) is exported for renderToStaticMarkup unit tests
// (hub has no jsdom/RTL — audit §11).

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, FileText, ChevronDown } from "lucide-react";
import { API_BASE } from "@/lib/config";
import { parseFrame, type EvidenceCitation } from "@/lib/notebook-chat-types";

/** Collapse citations to distinct (doc, page) passages — repeated cites from the
 *  same page count once, so "6 filename pills" becomes "3 supporting passages". */
export function distinctPassages(cites: EvidenceCitation[]): EvidenceCitation[] {
  const seen = new Set<string>();
  const out: EvidenceCitation[] = [];
  for (const c of cites) {
    const k = `${c.docId}|${c.page ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "answered" | "insufficient_evidence" | "error";
  citations?: EvidenceCitation[];
};

/** PRD §7.3 first-use suggested questions — a minor surface, not a feature. */
export const SUGGESTED_QUESTIONS = [
  "What does this fault mean?",
  "What should I check first?",
  "Where is the power input?",
  "What are the motor specs?",
] as const;

/** Pure hydration rule (unit-tested): persisted turns fill the chat exactly
 *  once — only while the conversation is still empty. A live conversation is
 *  never clobbered by a late (or repeated) load of the same history. */
export function hydrateTurns(prev: ChatTurn[], initial: ChatTurn[]): ChatTurn[] {
  return prev.length === 0 && initial.length > 0 ? initial : prev;
}

/** Pure leaf — unit-tested via renderToStaticMarkup. Renders answer text with
 *  clickable [n] markers wired to the matching citation. */
export function Bubble({
  turn,
  onCite,
}: {
  turn: ChatTurn;
  onCite?: (c: EvidenceCitation) => void;
}) {
  const isUser = turn.role === "user";
  const cites = turn.citations ?? [];
  const parts = turn.content.split(/(\[\d+\])/g);
  const passages = distinctPassages(cites);
  const [showSources, setShowSources] = useState(false);

  // Answer body: inline [n] citation chips, whitespace preserved so multi-step
  // answers keep their line breaks (no unbroken blob). User turns render as a
  // compact right-aligned bubble; assistant answers use the full column width.
  const body = (
    <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: isUser ? "white" : "var(--foreground)" }}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) {
          const c = cites.find((x) => x.citationId === m[1]);
          if (c) {
            // Rounded numbered chip ≥24px — PRD §26 forbids tiny hit targets.
            return (
              <button
                key={i}
                onClick={() => onCite?.(c)}
                className="mx-0.5 inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded-full px-1.5 text-xs font-semibold align-baseline"
                style={{ background: "var(--brand-blue)", color: "white" }}
                aria-label={`Open citation ${m[1]}: ${c.sourceTitle}${c.page != null ? `, page ${c.page}` : ""}`}
              >
                {m[1]}
              </button>
            );
          }
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl px-3 py-2"
          style={{ background: "var(--brand-blue)" }}
        >
          {body}
        </div>
      </div>
    );
  }

  // Assistant: full-width, no avatar, no bubble chrome — NotebookLM-style.
  return (
    <div className="w-full">
      {body}
      {turn.status === "insufficient_evidence" && (
        <p className="mt-1 text-xs" style={{ color: "var(--foreground-subtle)" }}>
          Not found in the selected sources. Add a source or rephrase.
        </p>
      )}
      {passages.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowSources((s) => !s)}
            aria-expanded={showSources}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ border: "1px solid var(--border)", color: "var(--foreground-muted)" }}
          >
            <FileText size={12} aria-hidden />
            {passages.length} supporting {passages.length === 1 ? "passage" : "passages"}
            <ChevronDown size={12} aria-hidden style={{ transform: showSources ? "rotate(180deg)" : "none" }} />
          </button>
          {showSources && (
            <div className="mt-1.5 flex flex-col gap-1">
              {passages.map((c) => (
                <button
                  key={c.citationId}
                  onClick={() => onCite?.(c)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs"
                  style={{ border: "1px solid var(--border)", color: "var(--foreground-muted)" }}
                >
                  <FileText size={12} aria-hidden />
                  <span className="min-w-0 truncate">
                    [{c.citationId}] {c.sourceTitle}
                    {c.page != null ? ` · p.${c.page}` : ""}
                  </span>
                  {c.quote ? <span className="truncate opacity-70">— {c.quote.slice(0, 60)}</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NotebookChat({
  notebookId,
  enabledDocIds,
  onOpenCitation,
  initialTurns = [],
}: {
  notebookId: string;
  enabledDocIds: string[];
  onOpenCitation: (c: EvidenceCitation) => void;
  initialTurns?: ChatTurn[];
}) {
  const [turns, setTurns] = useState<ChatTurn[]>(initialTurns);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persisted history loads async in the parent — hydrate once it arrives.
  // Without this, the server-side turns never render (Gate I client gap). The
  // functional update is idempotent (see hydrateTurns) so it never clobbers a
  // live conversation. Same async-prop-sync pattern as equipment/[id]/page.tsx.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to async-loaded prop; idempotent via hydrateTurns
    setTurns((prev) => hydrateTurns(prev, initialTurns));
  }, [initialTurns]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || busy) return;
    if (enabledDocIds.length === 0) {
      setTurns((t) => [
        ...t,
        { id: `u${Date.now()}`, role: "user", content: message },
        {
          id: `a${Date.now()}`,
          role: "assistant",
          content: "Select at least one source for a grounded answer.",
          status: "insufficient_evidence",
        },
      ]);
      setInput("");
      return;
    }
    setInput("");
    setBusy(true);
    const userTurn: ChatTurn = { id: `u${Date.now()}`, role: "user", content: message };
    const aId = `a${Date.now()}`;
    setTurns((t) => [...t, userTurn, { id: aId, role: "assistant", content: "" }]);

    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${notebookId}/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sourceDocIds: enabledDocIds }),
      });
      if (!res.body) throw new Error("no_stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let citations: EvidenceCitation[] = [];
      let status: ChatTurn["status"] = "answered";
      let content = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const data = t.slice(5).trim();
          if (data === "[DONE]") continue;
          const frame = parseFrame(data);
          if (!frame) continue;
          if (frame.kind === "sources") citations = frame.citations;
          else if (frame.kind === "content") {
            content += frame.content;
            setTurns((prev) =>
              prev.map((x) => (x.id === aId ? { ...x, content, citations } : x)),
            );
          } else if (frame.kind === "status") status = frame.status;
        }
      }
      setTurns((prev) =>
        prev.map((x) =>
          x.id === aId
            ? {
                ...x,
                content:
                  content ||
                  (status === "insufficient_evidence"
                    ? "I couldn't find that in the selected sources."
                    : "No answer provider was available."),
                citations,
                status,
              }
            : x,
        ),
      );
    } catch {
      setTurns((prev) =>
        prev.map((x) =>
          x.id === aId ? { ...x, content: "Something went wrong. Try again.", status: "error" } : x,
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [input, busy, enabledDocIds, notebookId]);

  return (
    <div className="flex h-full flex-col">
      {/* The chat log owns the scroll; the composer below is a normal flex item
          pinned to the column bottom (the page sets the column height). No
          fixed/sticky positioning → the composer can't slide under the desktop
          sidebar and never hides under the mobile tab bar. */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-busy={busy} data-testid="notebook-chat-log">
        {turns.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm" style={{ color: "var(--foreground-subtle)" }}>
              Ask this machine anything about its selected sources.
            </p>
            <div className="mx-auto mt-4 flex max-w-sm flex-wrap justify-center gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="rounded-full px-3 py-1.5 text-xs"
                  style={{
                    border: "1px solid var(--border)",
                    color: "var(--foreground-muted)",
                    background: "var(--surface-1)",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) => (
          <Bubble key={t.id} turn={t} onCite={onOpenCitation} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--foreground-subtle)" }}>
            <Loader2 size={14} className="animate-spin" aria-hidden /> Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>
      {/* Composer: a plain flex item at the column bottom. The parent column's
          height (set by the page: 100dvh minus the mobile tab bar) keeps it
          visible above the tab bar, and above the mobile keyboard because dvh
          shrinks when the keyboard opens. Safe-area padding for the home bar. */}
      <div
        className="flex shrink-0 items-end gap-2 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        style={{
          borderColor: "var(--border)",
          background: "var(--surface-0)",
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask this machine anything…"
          rows={1}
          className="max-h-32 flex-1 resize-none rounded-lg px-3 py-2 text-sm outline-none"
          style={{ border: "1px solid var(--border)", background: "var(--surface-0)", color: "var(--foreground)" }}
          aria-label="Ask this machine anything"
        />
        <button
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--brand-blue)", color: "white", opacity: busy || !input.trim() ? 0.5 : 1 }}
          aria-label="Send"
        >
          <Send size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
