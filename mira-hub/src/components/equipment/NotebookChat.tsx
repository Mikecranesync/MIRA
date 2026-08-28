"use client";

// Equipment Notebook chat — source-grounded, mobile-first, clickable citations.
// The leaf renderer (Bubble) is exported for renderToStaticMarkup unit tests
// (hub has no jsdom/RTL — audit §11).

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Send, Loader2, FileText, ChevronDown, Square, RotateCcw, Activity } from "lucide-react";
import { API_BASE } from "@/lib/config";
import type { EvidenceCitation, MachineEvidenceEntry } from "@/lib/notebook-chat-types";
import { AnswerMarkdown } from "./notebook-markdown";
import {
  basisLabel,
  buildChatBody,
  growTextarea,
  isAbortError,
  isEnterToSend,
  machineReplayCaption,
  postNotebookChat,
  restoreComposer,
  stoppedTurn,
  type ChatBody,
} from "./notebook-chat-utils";

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
  /** Evidence-ladder basis (spec §1.3). Streamed live via the `evidence`
   *  frame AND persisted on the turn row (084/#3387) — never inferred from
   *  citation count. */
  basis?: string | null;
  /** Sensor REPLAY (D5): machine windows this answer was grounded on — from
   *  the `evidence` frame live, from evidence[] on reload. Never citations. */
  machineEvidence?: MachineEvidenceEntry[];
  /** Deterministic follow-up questions from the server (answered turns only). */
  followups?: string[];
  /** The technician pressed Stop mid-stream (STRM-2): `content` is what had
   *  streamed; status is `error`, never `answered`. */
  stopped?: boolean;
};

/** PRD §7.3 first-use suggested questions — a minor surface, not a feature. */
export const SUGGESTED_QUESTIONS = [
  "What does this fault mean?",
  "What should I check first?",
  "Where is the power input?",
  "What are the motor specs?",
] as const;

/** Composer auto-grow cap: ~6 rows at text-sm/leading-relaxed (≈24px) + padding. */
const COMPOSER_MAX_PX = 160;

/** Pure hydration rule (unit-tested): persisted turns fill the chat exactly
 *  once — only while the conversation is still empty. A live conversation is
 *  never clobbered by a late (or repeated) load of the same history. */
export function hydrateTurns(prev: ChatTurn[], initial: ChatTurn[]): ChatTurn[] {
  return prev.length === 0 && initial.length > 0 ? initial : prev;
}

/** Pure leaf — unit-tested via renderToStaticMarkup. Renders answer text as
 *  GFM markdown with clickable [n] markers wired to the matching citation. */
export function Bubble({
  turn,
  onCite,
  onFollowup,
}: {
  turn: ChatTurn;
  onCite?: (c: EvidenceCitation) => void;
  /** When provided (the LAST assistant turn only), follow-up chips render and
   *  tapping one sends it as the next user message. Older turns get no chips —
   *  stale suggestions are noise. */
  onFollowup?: (question: string) => void;
}) {
  const isUser = turn.role === "user";
  const cites = turn.citations ?? [];
  const passages = distinctPassages(cites);
  const [showSources, setShowSources] = useState(false);

  if (isUser) {
    // User turns are the technician's own text — plain, whitespace preserved,
    // never interpreted as markdown. Compact right-aligned bubble.
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed"
          style={{ background: "var(--brand-blue)", color: "white" }}
        >
          {turn.content}
        </div>
      </div>
    );
  }

  // Assistant: full-width, no avatar, no bubble chrome — NotebookLM-style.
  // Answer body renders as markdown (RNDR-1); [n] chips work inside tables and
  // lists because the split happens in the markdown tree, not on the string.
  return (
    <div className="w-full">
      <div className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }} data-testid="answer-body">
        <AnswerMarkdown content={turn.content} citations={cites} onCite={onCite} />
      </div>
      {turn.stopped && (
        <p className="mt-1 text-xs" style={{ color: "var(--foreground-subtle)" }} data-testid="stopped-caption">
          Stopped
        </p>
      )}
      {turn.status === "insufficient_evidence" && (
        <p className="mt-1 text-xs" style={{ color: "var(--foreground-subtle)" }}>
          Not found in the selected sources. Add a source or rephrase.
        </p>
      )}
      {(turn.machineEvidence?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-col gap-1" data-testid="machine-replay-cards">
          {turn.machineEvidence!.map((e) => (
            <div
              key={`${e.assetId}|${e.anchorAt}`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"
              style={{
                border: "1px solid var(--border)",
                color: "var(--foreground-muted)",
                background: "var(--surface-1)",
              }}
              data-testid="machine-replay-card"
              data-freshness={e.freshness}
            >
              <Activity size={12} aria-hidden />
              <span className="min-w-0 truncate">{machineReplayCaption(e)}</span>
            </div>
          ))}
        </div>
      )}
      {basisLabel(turn.basis) && (
        <p
          className="mt-1 text-xs font-medium"
          style={{
            color: "var(--foreground-muted)",
            // Amber is reserved for the one basis that is NOT machine evidence
            // (spec §1.3); every other basis is a muted statement of fact.
            borderLeft: `3px solid ${turn.basis === "general_reasoning" ? "var(--status-yellow)" : "var(--border)"}`,
            paddingLeft: 8,
          }}
          data-testid="basis-caption"
          data-basis={turn.basis ?? undefined}
        >
          {basisLabel(turn.basis)}
        </p>
      )}
      {onFollowup && turn.status === "answered" && (turn.followups?.length ?? 0) > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Ask follow-up:" data-testid="followup-chips">
          <span className="sr-only">Ask follow-up:</span>
          {turn.followups!.map((q) => (
            <button
              key={q}
              onClick={() => onFollowup(q)}
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
  // CMPS-2: the exact body of the last failed send. Retry re-posts it as-is.
  const [failed, setFailed] = useState<ChatBody | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Stop generation (STRM-2) — same pattern as AssetChat / NodeChat.
  const abortRef = useRef<AbortController | null>(null);
  // Always-current view of the thread for send() — `turns` is not in send()'s
  // dep array, so a closure capture would be stale. This ref lets us send the
  // recent history (multi-turn memory) without re-creating the callback per turn.
  const turnsRef = useRef(turns);

  // Persisted history loads async in the parent — hydrate once it arrives.
  // Without this, the server-side turns never render (Gate I client gap). The
  // functional update is idempotent (see hydrateTurns) so it never clobbers a
  // live conversation. Same async-prop-sync pattern as equipment/[id]/page.tsx.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync to async-loaded prop; idempotent via hydrateTurns
    setTurns((prev) => hydrateTurns(prev, initialTurns));
  }, [initialTurns]);

  useEffect(() => {
    turnsRef.current = turns; // keep send()'s history source current
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  // Abort an in-flight stream if the notebook unmounts mid-answer.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Composer auto-grow (CMPS-1): `field-sizing: content` where supported, with
  // a scrollHeight fallback run on every input change.
  useEffect(() => {
    growTextarea(inputRef.current, COMPOSER_MAX_PX);
  }, [input]);

  // Post one body and stream the answer. Shared by a fresh send and Retry so
  // the retried request is byte-identical to the one that failed.
  const post = useCallback(async (body: ChatBody) => {
    setFailed(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const userTurn: ChatTurn = { id: `u${Date.now()}`, role: "user", content: body.message };
    const aId = `a${Date.now()}`;
    setTurns((t) => [...t, userTurn, { id: aId, role: "assistant", content: "" }]);

    try {
      const { content, citations, status, basis, followups, machineEvidence } = await postNotebookChat(
        `${API_BASE}/api/equipment-notebooks/${notebookId}/chat/`,
        body,
        controller.signal,
        (partial, cites) => {
          setTurns((prev) => prev.map((x) => (x.id === aId ? { ...x, content: partial, citations: cites } : x)));
        },
      );
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
                // Only a served answer carries a basis claim — mirrors what
                // the server persists (084).
                basis: status === "answered" ? basis : null,
                ...(status === "answered" && machineEvidence ? { machineEvidence: [machineEvidence] } : {}),
                followups,
              }
            : x,
        ),
      );
    } catch (err) {
      if (isAbortError(err)) {
        // Stopped by the technician: keep the partial text, mark it as not an
        // answer (STRM-2). No retry, no provider call.
        const partial = (err as { partial?: string }).partial ?? "";
        setTurns((prev) => prev.map((x) => (x.id === aId ? stoppedTurn(x, partial) : x)));
      } else {
        // Failure keeps the question (CMPS-2): roll back the optimistic
        // exchange, put the text back in the composer, offer Retry with the
        // identical body. Nothing is fabricated in the transcript.
        setTurns((prev) => prev.filter((x) => x.id !== aId && x.id !== userTurn.id));
        setInput((cur) => restoreComposer(cur, body.message));
        setFailed(body);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }, [notebookId]);

  const sendText = useCallback(async (raw: string) => {
    const message = raw.trim();
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
    // Recent thread (before this exchange) → multi-turn memory; stopped turns
    // are excluded (historyFromTurns).
    await post(buildChatBody(message, enabledDocIds, turnsRef.current));
  }, [busy, enabledDocIds, post]);

  const retry = useCallback(() => {
    if (!failed || busy) return;
    setInput((cur) => (cur === failed.message ? "" : cur));
    void post(failed);
  }, [failed, busy, post]);

  const send = useCallback(() => sendText(input), [sendText, input]);
  const stop = useCallback(() => abortRef.current?.abort(), []);

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
        {turns.map((t, i) => (
          <Bubble
            key={t.id}
            turn={t}
            onCite={onOpenCitation}
            onFollowup={
              !busy && i === turns.length - 1 && t.role === "assistant"
                ? (q) => void sendText(q)
                : undefined
            }
          />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--foreground-subtle)" }}>
            <Loader2 size={14} className="animate-spin" aria-hidden /> Thinking…
          </div>
        )}
        {failed && !busy && (
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--foreground-muted)" }} data-testid="send-failed">
            <span>Couldn&apos;t send — your question is still in the box.</span>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium"
              style={{ border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--foreground)" }}
              data-testid="retry-chip"
            >
              <RotateCcw size={12} aria-hidden /> Retry
            </button>
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
            if (isEnterToSend(e)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask this machine anything…"
          rows={1}
          enterKeyHint="send"
          className="flex-1 resize-none rounded-lg px-3 py-2 text-sm leading-relaxed outline-none"
          style={{
            border: "1px solid var(--border)",
            background: "var(--surface-0)",
            color: "var(--foreground)",
            maxHeight: COMPOSER_MAX_PX,
            // Auto-grow natively where supported (Chromium 123+); the effect
            // above is the fallback for the rest.
            fieldSizing: "content",
          } as CSSProperties}
          aria-label="Ask this machine anything"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
            style={{ border: "1px solid var(--border)", background: "var(--surface-1)", color: "var(--foreground)" }}
            aria-label="Stop generating"
            data-testid="stop-button"
          >
            <Square size={14} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "var(--brand-blue)", color: "white", opacity: !input.trim() ? 0.5 : 1 }}
            aria-label="Send"
          >
            <Send size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
