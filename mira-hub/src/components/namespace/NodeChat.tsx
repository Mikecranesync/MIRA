"use client";

// Hub folder=brain — Ask MIRA at a namespace node.
//
// Cloned from components/AssetChat.tsx, with two node-specific additions:
//   - posts to /hub/api/namespace/node/[id]/chat (subtree-grounded retrieval);
//   - renders citation chips from the SSE `sources` event the node route emits
//     up front (AssetChat ignores that event).
// The subtree grounding means asking here answers from docs attached to this
// node AND every node beneath it. Node selection IS the UNS gate (UNS-020).

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Send, AlertTriangle, RotateCcw, Loader2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/config";

interface Source {
  index: number;
  title: string;
  url: string | null;
  page: number | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isSafetyStop?: boolean;
  sources?: Source[];
}

interface NodeChatProps {
  nodeId: string;
  nodeName: string;
  unsPath: string | null;
}

const WELCOME = (name: string) =>
  `Hi — I'm MIRA. Ask me about **${name}** and everything beneath it in the namespace.\n\nI answer only from the documents attached to this part of your namespace, and I cite the source. If nothing's attached here yet, attach a manual and ask again.`;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function SourceChips({ sources }: { sources: Source[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((s) => (
        <span
          key={`${s.index}-${s.title}`}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            color: "var(--foreground-muted)",
          }}
          title={s.url ?? s.title}
        >
          <FileText className="h-2.5 w-2.5" style={{ color: "var(--brand-blue)" }} />
          [{s.index}] {s.title}
          {s.page != null ? ` p.${s.page}` : ""}
        </span>
      ))}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
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
          background: isSafety ? "#FEF2F2" : "var(--surface-1)",
          border: isSafety ? "1px solid #FECACA" : "1px solid var(--border)",
        }}
      >
        {isSafety ? (
          <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
        ) : (
          <Bot className="w-3.5 h-3.5" style={{ color: "var(--brand-blue)" }} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm whitespace-pre-wrap"
          style={{
            background: isSafety ? "#FEF2F2" : "var(--surface-1)",
            color: isSafety ? "#991B1B" : "var(--foreground)",
            border: isSafety ? "1px solid #FECACA" : "1px solid var(--border)",
          }}
        >
          {msg.content || <span style={{ color: "var(--foreground-subtle)" }}>…</span>}
        </div>
        {msg.sources && <SourceChips sources={msg.sources} />}
      </div>
    </div>
  );
}

export function NodeChat({ nodeId, nodeName, unsPath }: NodeChatProps) {
  const storageKey = `mira_node_chat_${nodeId}`;

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      // storage quota exceeded — ignore
    }
  }, [messages, storageKey]);

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

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    setError(null);
    const userMsg: ChatMessage = { id: uid(), role: "user", content: text.trim() };
    const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "" };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const apiMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let isSafety = false;

    try {
      const res = await fetch(`${API_BASE}/api/namespace/node/${nodeId}/chat`, {
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
            const parsed = JSON.parse(data) as { content?: string; sources?: Source[] };
            if (parsed.sources) {
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last && last.role === "assistant") {
                  next[next.length - 1] = { ...last, sources: parsed.sources };
                }
                return next;
              });
            }
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
          } catch {
            // malformed chunk
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError("Connection lost. Check your network and try again.");
      setMessages((prev) => {
        const next = [...prev];
        next.pop(); // remove empty assistant bubble
        return next;
      });
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
  }, [nodeId, messages, streaming]);

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const text = input;
    setInput("");
    void sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input;
      setInput("");
      void sendMessage(text);
    }
  }

  const welcome = WELCOME(nodeName);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 360 }}>
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
            title={unsPath ?? undefined}
          >
            Grounded in this folder + below
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
            style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA" }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

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
          placeholder={streaming ? "MIRA is thinking…" : "Ask about this folder…"}
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
        <Button
          type="submit"
          size="sm"
          disabled={!input.trim() || streaming}
          className="h-9 w-9 p-0 flex-shrink-0 rounded-xl"
          style={{
            background: input.trim() && !streaming ? "var(--brand-blue)" : "var(--surface-1)",
            color: input.trim() && !streaming ? "#fff" : "var(--foreground-subtle)",
          }}
        >
          {streaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
