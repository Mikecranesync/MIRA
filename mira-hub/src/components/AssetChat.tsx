"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, AlertTriangle, RotateCcw, ClipboardCheck, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/config";
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
          className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm whitespace-pre-wrap"
          style={{
            background: isSafety ? "var(--status-red-bg)" : "var(--surface-1)",
            color: isSafety ? "#991B1B" : "var(--foreground)",
            border: isSafety ? "1px solid #FECACA" : "1px solid var(--border)",
          }}
        >
          {msg.content || <span style={{ color: "var(--foreground-subtle)" }}>…</span>}
        </div>
        {msg.hasSafetyAlert && (
          <div
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium"
            style={{ color: "var(--status-orange)" }}
          >
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
        {msg.traceId && !isSafety && <WhyMiraThinksThis traceId={msg.traceId} />}
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
        throw new Error(`Server error ${res.status}`);
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
      const statusCode = /(\d{3})/.exec((err as Error).message ?? "")?.[1];
      setError(
        statusCode
          ? `Chat unavailable (${statusCode}). Try again or refresh the page.`
          : "Connection lost. Check your network and try again.",
      );
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
          <div
            className="text-xs px-3 py-2 rounded-lg"
            style={{ background: "var(--status-red-bg)", color: "#991B1B", border: "1px solid #FECACA" }}
          >
            {error}
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
