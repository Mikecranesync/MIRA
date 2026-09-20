"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, AlertTriangle, RotateCcw, ClipboardCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/config";
import { SourceChips, type SourceChip } from "@/components/SourceChips";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import WhyMiraThinksThis from "@/components/WhyMiraThinksThis";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isSafetyStop?: boolean;
  /** H4 gap-admission safety alert (#2542) — appended AFTER a real answer, so
   *  it's a distinct flag from `isSafetyStop` (the hard-stop that replaces an
   *  answer entirely). Never conflate the two or their styling. */
  hasSafetyAlert?: boolean;
  /** The technician pressed Stop mid-stream (STRM-2): `content` is whatever had
   *  streamed so far; the turn is not sent back as history on the next ask. */
  stopped?: boolean;
  traceId?: string;
  nextCheck?: string;
  /** Retrieved manual sources for this answer. The route has ALWAYS emitted
   *  these — its own comment at the emit site reads "Emit retrieved sources up
   *  front so the UI can render citation chips" — and this client dropped the
   *  frame, so the surface showed none. E-1: the citation is the product's
   *  claim; withholding it is not a styling gap. */
  sources?: SourceChip[];
}

/**
 * Humane failure copy (gates G-1…G-5).
 *
 * The live product said `Chat unavailable (412). Try again or refresh the page.`
 * — three defects in one sentence. A status code is not a sentence; refreshing
 * cannot satisfy a gate, restore a connection, or re-run a provider call, so it
 * is advice that cannot work; and a 412 is not an outage at all — it is MIRA
 * REFUSING for a stated reason, which reads as breakage only because we
 * rendered it as breakage.
 *
 * The composer already gets the failed text back (`restoreComposer`), so
 * "your message is still here" is a statement of fact, not reassurance.
 */
export function failureMessage(status: number | null): string {
  if (status === 412) {
    return "MIRA needs to know which machine before answering that. Your message is still here.";
  }
  if (status !== null && status >= 500) {
    return "MIRA could not answer that just now. Your message is still here.";
  }
  return "Couldn't reach MIRA. Your message is still here.";
}

/** The HTTP status behind a failure, or null when the failure was transport —
 *  no network, aborted socket, DNS. Kept separate from the copy so the number
 *  can reach a log without ever reaching a technician. */
export function statusFromError(err: unknown): number | null {
  const m = /\bstatus (\d{3})\b/.exec((err as Error)?.message ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * What the Copy control puts on the clipboard for an asset-scoped answer (B-8).
 *
 * Deliberately thinner than the notebook chat's payload, and the difference is
 * a product gap rather than a styling choice: `ChatMessage` carries **no
 * citations**, so this surface renders none and there are no sources to attach.
 * The notebook chat sends its sources and its basis label along with the text;
 * here the answer travels alone because that is all the surface has.
 *
 * A partial answer says so. If the technician pressed Stop mid-stream, the text
 * on screen is whatever had arrived — pasting that into a work order without
 * the caption would present a truncated answer as a complete one.
 */
export function assetAnswerCopyPayload(msg: {
  content: string;
  stopped?: boolean;
  hasSafetyAlert?: boolean;
  sources?: readonly SourceChip[];
}): string {
  const lines = [msg.content.trim()];
  if (msg.sources && msg.sources.length > 0) {
    lines.push("");
    for (const s of msg.sources) {
      lines.push(`[${s.index}] ${s.title}${s.page != null ? ` · p.${s.page}` : ""}`);
    }
  }
  if (msg.stopped) lines.push("", "(Stopped — this answer was cut short.)");
  if (msg.hasSafetyAlert) lines.push("", "⚠ A safety alert was shown with this answer.");
  return lines.join("\n");
}

/** The copy affordance. Its own component so the "Copied" acknowledgement is
 *  scoped to one answer rather than appearing under every one. */
function CopyAssetAnswer({ msg }: { msg: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      data-testid="copy-asset-answer"
      aria-label="Copy this answer"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(assetAnswerCopyPayload(msg))
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
      className="mt-1.5 rounded-lg border px-3 text-xs"
      style={{
        background: "var(--surface-0)",
        borderColor: "var(--border)",
        color: "var(--foreground)",
        minHeight: 44,
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

interface AssetChatProps {
  assetId: string;
  assetName: string;
  assetTag: string;
}

const WELCOME = (name: string, tag: string) =>
  `Hi — I'm MIRA. Ask me anything about **${name}** (${tag}).\n\nGood starting points:\n• "What are the most common faults for this equipment?"\n• "Walk me through a PM checklist"\n• "Explain fault code F005"`;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Enter sends; Shift+Enter is a newline; an in-progress IME composition
 *  (Japanese/Chinese/Korean keyboards, keyCode 229) never sends. Local copy —
 *  intentionally not imported from notebook-chat-utils.ts (Notebook-specific;
 *  see FLEET-011). Exported for AssetChat.test.tsx. */
export function isEnterToSend(e: {
  key: string;
  shiftKey: boolean;
  nativeEvent?: { isComposing?: boolean };
  keyCode?: number;
}): boolean {
  if (e.key !== "Enter" || e.shiftKey) return false;
  if (e.nativeEvent?.isComposing || e.keyCode === 229) return false;
  return true;
}

/** After a failed send the technician's question goes back into the composer
 *  — unless they already started typing something else. Local copy of
 *  Notebook chat's CMPS-2 fix (notebook-chat-utils.ts); not imported to avoid
 *  a cross-surface coupling for a 2-line pure function. */
export function restoreComposer(current: string, failedMessage: string): string {
  return current.trim() ? current : failedMessage;
}

// Exported for the static render test (AssetChat.test.tsx).
export function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const isSafety = msg.isSafetyStop;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm"
          style={{ background: "var(--brand-blue)", color: "#fff" }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: isSafety ? "var(--status-red-bg)" : "var(--surface-1)",
          border: isSafety ? "1px solid #FECACA" : "1px solid var(--border)",
        }}
      >
        {isSafety ? (
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: "var(--status-red)" }} />
        ) : (
          <Bot className="w-3.5 h-3.5" style={{ color: "var(--brand-blue)" }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm"
          style={{
            background: isSafety ? "var(--status-red-bg)" : "var(--surface-1)",
            color: isSafety ? "#991B1B" : "var(--foreground)",
            border: isSafety ? "1px solid #FECACA" : "1px solid var(--border)",
          }}
        >
          {msg.content ? (
            /* B-3 — render GFM, do not print it. This surface used
               `whitespace-pre-wrap` on the raw string, so every bold, bullet
               and heading MIRA produced arrived as literal syntax. The proof
               needs no browser: WELCOME itself contains `**${name}**`, so the
               first thing a technician saw on this screen was the asterisks.
               Reuses the notebook's renderer rather than adding a second one —
               one markdown behaviour across surfaces, not two. Citations are
               passed empty here: the [n] tap-through belongs to the notebook's
               EvidenceCitation shape, while this surface carries SourceChip and
               renders its evidence as chips below. */
            <AnswerMarkdown content={msg.content} citations={[]} />
          ) : (
            <span style={{ color: "var(--foreground-subtle)" }}>…</span>
          )}
        </div>
        {msg.hasSafetyAlert && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-amber-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            Safety alert included above
          </div>
        )}
        {msg.stopped && (
          <p
            className="mt-1.5 text-xs"
            style={{ color: "var(--foreground-subtle)" }}
            data-testid="stopped-caption"
          >
            Stopped
          </p>
        )}
        {msg.nextCheck && !isSafety && (
          <div
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs"
            style={{ color: "var(--foreground-subtle)" }}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Next check: {msg.nextCheck}
          </div>
        )}
        {!isSafety && <SourceChips sources={msg.sources} />}
        {msg.traceId && !isSafety && <WhyMiraThinksThis traceId={msg.traceId} />}
        {/* B-8 — a persistent action row under every answer, copy
            non-negotiable. Suppressed on a safety stop: that is an instruction
            to stop work, not an answer to relay.

            NOTE the limit, because a copy button here is weaker than it looks:
            `ChatMessage` carries no citations, so this surface renders none and
            the copy has no sources to attach. On the notebook chat the sources
            and the basis label travel with the text; here there is nothing to
            travel. Fixing that is E-1/E-2 work on this surface, not a copy
            control — see `assetAnswerCopyPayload`. */}
        {msg.role === "assistant" && !isSafety && msg.content.trim() !== "" && (
          <CopyAssetAnswer msg={msg} />
        )}
      </div>
    </div>
  );
}

// The submit-button slot: an enabled Stop control while streaming (STRM-2),
// same pattern as NotebookChat's busy ? <Stop> : <Send> branch — the existing
// Send button otherwise. Exported for the static render test.
export function ComposerButton({
  streaming,
  canSend,
  onStop,
}: {
  streaming: boolean;
  canSend: boolean;
  onStop: () => void;
}) {
  if (streaming) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={onStop}
        className="h-9 w-9 p-0 flex-shrink-0 rounded-xl"
        style={{ background: "var(--surface-1)", color: "var(--foreground)" }}
        aria-label="Stop generating"
        data-testid="stop-button"
      >
        <Square className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <Button
      type="submit"
      size="sm"
      disabled={!canSend}
      aria-label="Send"
      className="h-9 w-9 p-0 flex-shrink-0 rounded-xl"
      style={{
        background: canSend ? "var(--brand-blue)" : "var(--surface-1)",
        color: canSend ? "#fff" : "var(--foreground-subtle)",
      }}
    >
      <Send className="w-4 h-4" />
    </Button>
  );
}

export function AssetChat({ assetId, assetName, assetTag }: AssetChatProps) {
  const storageKey = `mira_chat_${assetId}`;

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? (JSON.parse(saved) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The message that failed, so Retry has something to re-send. The composer
   *  also keeps it (restoreComposer), which is why the copy can truthfully say
   *  "your message is still here". */
  const [failedText, setFailedText] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Persist messages to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      // storage quota exceeded — ignore
    }
  }, [messages, storageKey]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const clearHistory = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [storageKey]);

  // Stop generation (STRM-2) — same pattern as NotebookChat's `stop`. Aborts
  // the in-flight request WITHOUT wiping the message array (unlike clearHistory).
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    setError(null);
    setFailedText(null);
    if (!text.trim() || streaming) return;

    setError(null);
    const userMsg: ChatMessage = { id: uid(), role: "user", content: text.trim() };
    const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // A stopped turn is not an answer (STRM-2) — it must not enter what the
    // model sees on the next turn, mirroring notebook-chat-utils' historyFromTurns.
    const apiMessages = [...messages, userMsg].filter((m) => !m.stopped).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let isSafety = false;

    try {
      const res = await fetch(`${API_BASE}/api/assets/${assetId}/chat/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Machine-readable for `statusFromError`; never rendered.
        throw new Error(`request failed with status ${res.status}`);
      }

      isSafety = res.headers.get("X-Safety-Stop") !== null;

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as {
              content?: string;
              traceId?: string;
              next_check?: string;
              safetyAlert?: boolean;
              /** Retrieved manual sources. The route emits this frame whenever
               *  `manualSources.length > 0`; this type omitted it, which is how
               *  the frame came to be dropped silently — the compiler could not
               *  object to reading a field the shape never declared. */
              sources?: SourceChip[];
            };
            if (parsed.content) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + parsed.content };
                }
                return next;
              });
            }
            if (parsed.safetyAlert) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, hasSafetyAlert: true };
                }
                return next;
              });
            }
            if (parsed.traceId) {
              const tid = parsed.traceId;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, traceId: tid };
                }
                return next;
              });
            }
            if (Array.isArray(parsed.sources)) {
              const src = parsed.sources as SourceChip[];
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, sources: src };
                }
                return next;
              });
            }
            if (parsed.next_check) {
              const nc = parsed.next_check;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, nextCheck: nc };
                }
                return next;
              });
            }
          } catch {
            // malformed chunk
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // Stopped by the technician: keep whatever partial content had already
        // streamed in and mark the turn as not an answer (STRM-2). No wipe —
        // only clearHistory wipes the thread.
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, stopped: true };
          }
          return next;
        });
        return;
      }
      console.error("[AssetChat] chat request failed:", err);
      setError(failureMessage(statusFromError(err)));
      setFailedText(text);
      setMessages((prev) => {
        const next = [...prev];
        next.pop(); // remove empty assistant bubble
        return next;
      });
      // Restore the failed question to the composer (CMPS-2) unless the
      // technician already started typing something new.
      setInput((current) => restoreComposer(current, text));
    } finally {
      if (isSafety) {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, isSafetyStop: true };
          }
          return next;
        });
      }
      setStreaming(false);
      abortRef.current = null;
    }
  }, [assetId, messages, streaming]);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const text = input;
    setInput("");
    void sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isEnterToSend(e)) {
      e.preventDefault();
      const text = input;
      setInput("");
      void sendMessage(text);
    }
  }

  const welcome = WELCOME(assetName, assetTag);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 400 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            Ask MIRA
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: "var(--surface-1)", color: "var(--foreground-subtle)" }}
          >
            Asset-scoped
          </span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearHistory}
            className="flex items-center gap-1 text-[11px] hover:opacity-70 transition-opacity"
            style={{ color: "var(--foreground-subtle)" }}
            title="Clear conversation"
          >
            <RotateCcw className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ minHeight: 0 }}>
        {/* Welcome message */}
        <div className="flex gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border)" }}
          >
            <Bot className="w-3.5 h-3.5" style={{ color: "var(--brand-blue)" }} />
          </div>
          <div
            className="flex-1 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm"
            style={{
              background: "var(--surface-1)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            }}
          >
            <p className="whitespace-pre-line">{welcome}</p>
          </div>
        </div>

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {error && (
          /* G-3/G-4 — degrade to the nearest working state, and give the
             technician a BUTTON rather than a sentence telling them to try
             again. Amber, not red: this is a state to act from, not damage.
             Dismissible, so it cannot become the permanent banner the recon
             found. */
          <div
            role="status"
            data-testid="chat-error"
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
            style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A" }}
          >
            <span className="flex-1">{error}</span>
            {failedText && (
              <button
                type="button"
                data-testid="chat-retry"
                onClick={() => { const t = failedText; setError(null); setFailedText(null); void sendMessage(t); }}
                className="rounded-lg border px-3"
                style={{ borderColor: "#FDE68A", color: "#92400E", minHeight: 44 }}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              data-testid="chat-error-dismiss"
              onClick={() => { setError(null); setFailedText(null); }}
              className="rounded-lg px-2"
              style={{ color: "#92400E", minHeight: 44 }}
            >
              ×
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts (only when no history) */}
      {messages.length === 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2 flex-shrink-0">
          {[
            "Common faults?",
            "PM checklist",
            "Fault code F005",
            "Parts to stock",
          ].map((prompt) => (
            <button
              key={prompt}
              onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
              className="text-[11px] px-3 py-1.5 rounded-full border transition-colors hover:opacity-80"
              style={{
                borderColor: "var(--border)",
                color: "var(--foreground-muted)",
                background: "var(--surface-1)",
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-4 py-3 border-t flex-shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          placeholder={streaming ? "MIRA is thinking…" : "Ask about this asset…"}
          aria-label="Ask about this asset"
          rows={1}
          className="flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 transition-all"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-0)",
            color: "var(--foreground)",
            maxHeight: 120,
            lineHeight: 1.4,
            fieldSizing: "content" as React.CSSProperties["fieldSizing"],
          }}
        />
        <ComposerButton streaming={streaming} canSend={!!input.trim()} onStop={stopGeneration} />
      </form>
    </div>
  );
}
