"use client";

// Equipment Notebook chat — source-grounded, mobile-first, clickable citations.
// The leaf renderer (Bubble) is exported for renderToStaticMarkup unit tests
// (hub has no jsdom/RTL — audit §11).

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Bot, User, Loader2, FileText } from "lucide-react";
import { API_BASE } from "@/lib/config";
import { parseFrame, type EvidenceCitation } from "@/lib/notebook-chat-types";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "answered" | "insufficient_evidence" | "error";
  citations?: EvidenceCitation[];
};

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
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ background: isUser ? "var(--brand-blue)" : "var(--surface-2)" }}
      >
        {isUser ? <User size={15} color="white" aria-hidden /> : <Bot size={15} aria-hidden />}
      </div>
      <div className="min-w-0 max-w-[85%]">
        <div
          className="rounded-2xl px-3 py-2 text-sm"
          style={{
            background: isUser ? "var(--brand-blue)" : "var(--surface-1)",
            color: isUser ? "white" : "var(--foreground)",
            border: isUser ? "none" : "1px solid var(--border)",
          }}
        >
          {parts.map((p, i) => {
            const m = p.match(/^\[(\d+)\]$/);
            if (m) {
              const c = cites.find((x) => x.citationId === m[1]);
              if (c) {
                return (
                  <button
                    key={i}
                    onClick={() => onCite?.(c)}
                    className="mx-0.5 rounded px-1 text-xs font-medium align-baseline"
                    style={{ background: "var(--brand-blue)", color: "white" }}
                    title={`${c.sourceTitle}${c.page != null ? ` · p. ${c.page}` : ""}`}
                  >
                    {p}
                  </button>
                );
              }
            }
            return <span key={i}>{p}</span>;
          })}
        </div>
        {turn.status === "insufficient_evidence" && (
          <p className="mt-1 text-xs" style={{ color: "var(--foreground-subtle)" }}>
            No selected source supported this. Add a source or rephrase.
          </p>
        )}
        {cites.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {cites.map((c) => (
              <button
                key={c.citationId}
                onClick={() => onCite?.(c)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                style={{ border: "1px solid var(--border)", color: "var(--foreground-muted)" }}
              >
                <FileText size={11} aria-hidden />[{c.citationId}] {c.sourceTitle}
                {c.page != null ? ` · p.${c.page}` : ""}
              </button>
            ))}
          </div>
        )}
      </div>
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
      {/* Bottom padding reserves room for the fixed composer so the last
          message is never hidden behind it. */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 pb-24">
        {turns.length === 0 && (
          <div className="py-8 text-center text-sm" style={{ color: "var(--foreground-subtle)" }}>
            Ask this machine anything about its selected sources.
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
      {/* Fixed above the hub's mobile bottom-tab bar — immune to top-chrome
          height (trial banner + nav) that a viewport-height calc mis-measures.
          On desktop the tab bar is hidden but the token stays 56px, leaving a
          small harmless gap; phone-first is the priority (PRD §5). */}
      <div
        className="fixed inset-x-0 z-30 mx-auto flex max-w-3xl items-end gap-2 border-t p-2"
        style={{
          borderColor: "var(--border)",
          background: "var(--surface-0)",
          bottom: "calc(var(--bottom-tab-height, 0px) + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <textarea
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
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "var(--brand-blue)", color: "white", opacity: busy || !input.trim() ? 0.5 : 1 }}
          aria-label="Send"
        >
          <Send size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
