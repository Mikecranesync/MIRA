// ChatV2 — the ChatGPT-class conversation surface (PRD
// docs/prd/2026-08-30-chatgpt-class-ui-prd.md; ADR-0038 protocol, ADR-0039
// adapter boundary). One continuous conversation: type, attach a photo or a
// PDF, ask, stop, come back. LOOK/READ/REPLAY stay available as instruments,
// but ordinary conversation never routes through a mode.
//
// BOUNDARY (ADR-0039). assistant-ui owns the commodity conversation shell:
// thread viewport, stick-to-bottom + jump-to-latest, message list, run state,
// composer state, Send↔Stop. MIRA owns everything that carries meaning: the
// typed SSE frames (ONE parser, src/lib/sse.ts), the canonical part contract
// (src/chat-adapter/), the send path with its riders and byte-identical Retry,
// citations, evidence cards, safety semantics, and the citation viewer chain.
// MIRA parts render through REGISTERED data-part components — never a fork of
// the library core, and never a second SSE parser.
import { useState } from "react";
import {
  MessagePrimitive,
  ThreadPrimitive,
  type DataMessagePartComponent,
} from "@assistant-ui/react";
import { autoGrow, composerKeyAction } from "../lib/composer";
import {
  AssistantRuntimeProvider,
  useMiraChatRuntime,
} from "../chat-adapter/runtime";
import type { ChatCitation, ChatTurn } from "../lib/sse";
import type { NotebookServerTurn } from "../api/resources";
import type { MachineEvidenceEntry } from "../lib/replay";
import type { VisualObservationEntry } from "../lib/sensor";
import { basisCaption, replayCardTitle } from "../lib/replay";
import { visualCardTitle } from "../lib/sensor";
import { AnswerMarkdown, copyText } from "./AnswerMarkdown";
import { SourceThumb } from "./FilePreview";
import { Sheet } from "./Sheet";

/** Callbacks the screen owns; ChatV2 never fetches, uploads, or persists. */
export interface ChatV2Handlers {
  /** The screen's send path — scope, history, riders, Retry body. */
  onSend: (text: string) => void;
  onStop: () => void;
  /** Open the existing citation sheet (viewer chain unchanged). */
  onCitation: (c: ChatCitation) => void;
  /** Attach a photo to this conversation (existing LOOK upload path). */
  onAttachPhoto: () => void;
  /** Attach a PDF as a citable source (existing two-step upload path). */
  onAttachFile: () => void;
  /** Retry the byte-identical failed body, when one is pending. */
  onRetry?: () => void;
}

// --- registered MIRA part components ---------------------------------------
// Each renders ONE canonical part kind. They read only their own payload; no
// part component reaches into transport, state, or another part.

let citationSink: ((c: ChatCitation) => void) | null = null;

/** The assistant answer body: MIRA markdown + inline [n] citation marks
 *  (gated on the structured ids — an unknown [7] stays literal text) + the
 *  trailing chip row. Same components the legacy surface used, so the citation
 *  tap chain into the source viewer is byte-for-byte unchanged. */
const AnswerPart: DataMessagePartComponent = ({ data }) => {
  const d = data as unknown as { text: string; citations: ChatCitation[] };
  const [copied, setCopied] = useState(false);
  if (!d.text?.trim() && d.citations.length === 0) return null;
  return (
    <div data-testid="v2-answer">
      <AnswerMarkdown
        text={d.text}
        citations={d.citations}
        onCitation={(c) => citationSink?.(c)}
      />
      {d.citations.length > 0 && (
        <div>
          {d.citations.map((c) => (
            <button
              key={c.citationId}
              className="cite-chip"
              style={{ border: "none", cursor: "pointer" }}
              onClick={() => citationSink?.(c)}
            >
              {c.citationId} · {c.sourceTitle}
              {c.page ? ` p.${c.page}` : ""}
            </button>
          ))}
        </div>
      )}
      <div className="v2-message-actions">
        <button
          type="button"
          className="btn-link"
          aria-label="Copy answer"
          onClick={() => {
            void copyText(d.text).then((ok) => {
              setCopied(ok);
              if (ok) setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
};

/** Sensor LOOK evidence — the parked photo, never a citation. */
const ObservationPart: DataMessagePartComponent = ({ data }) => {
  const e = data as unknown as VisualObservationEntry;
  return (
    <div
      className="card sensor-evidence"
      data-testid="visual-observation-card"
      style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
    >
      <SourceThumb fileId={e.fileId} />
      <div className="grow">
        <div className="title">{visualCardTitle(e.capturedAt)}</div>
        <div className="meta">
          {e.provenance === "phone_photo" ? "Phone photo" : e.provenance} · saved to this
          notebook&apos;s files
        </div>
      </div>
    </div>
  );
};

/** Sensor REPLAY evidence — recorded machine history, never styled as live.
 *  The title/meta strings come from the frozen cross-lane contract in
 *  lib/replay.ts and render verbatim. */
const MachineEvidencePart: DataMessagePartComponent = ({ data }) => {
  const e = data as unknown as MachineEvidenceEntry;
  return (
    <div className="card sensor-evidence" data-testid="machine-replay-card">
      <div className="title">{replayCardTitle(e)}</div>
      <div className="meta">
        {e.pre} s before / {e.post} s after · Machine Memory
        {e.windowId ? " · fault window" : ""}
      </div>
    </div>
  );
};

/** Evidence-ladder badge. Amber is reserved for general reasoning; machine
 *  bases get the muted caption. A grounded documentary answer shows its chips
 *  instead — a second "grounded" badge would be noise. */
const BasisPart: DataMessagePartComponent = ({ data }) => {
  const d = data as unknown as { basis: string; label: string | null };
  if (d.basis === "general_reasoning") {
    return (
      <div className="evidence-basis-general" data-testid="basis-general">
        {d.label || "General guidance — not grounded in this machine's documents."}
      </div>
    );
  }
  const caption = basisCaption(d.basis);
  return caption ? <div className="evidence-basis-machine">{caption}</div> : null;
};

/** Safety hard-stop. The turn is a safety notice, not a troubleshooting
 *  answer, and must never be presentable as an ordinary reply. */
const SafetyNoticePart: DataMessagePartComponent = () => (
  <div className="safety-notice" data-testid="safety-notice" role="alert">
    <strong>Safety stop.</strong> This reply is a safety instruction, not a
    troubleshooting answer. Isolate and verify before working on this equipment.
  </div>
);

/** STRM-2 terminal semantics, rendered from the typed part — never inferred
 *  by scraping the answer text. */
const ErrorPart: DataMessagePartComponent = ({ data }) => {
  const reason = (data as unknown as { reason: string }).reason;
  return reason === "stopped" ? (
    <div className="meta answer-stopped" data-testid="stopped-caption">
      Stopped
    </div>
  ) : (
    <div className="meta answer-stopped" data-testid="incomplete-caption">
      Incomplete — this answer didn&apos;t finish. Ask again to retry.
    </div>
  );
};

let followupSink: ((q: string) => void) | null = null;

/** Deterministic follow-ups (CONV-4): tapping one sends it as the next turn. */
const FollowupsPart: DataMessagePartComponent = ({ data }) => {
  const d = data as unknown as { suggestions: string[] };
  if (!d.suggestions?.length) return null;
  return (
    <div className="chip-row" aria-label="Ask follow-up:">
      {d.suggestions.map((f) => (
        <button key={f} className="chip" onClick={() => followupSink?.(f)}>
          {f}
        </button>
      ))}
    </div>
  );
};

/** A frame kind this build doesn't know (PRD §9.2): preserved, inspectable,
 *  never rendered as an answer and never a crash. */
const UnknownPart: DataMessagePartComponent = ({ data }) => (
  <div className="meta" data-testid="unknown-part">
    This answer included something this app version can&apos;t display yet.
  </div>
);

const HiddenPart: DataMessagePartComponent = () => null;

const partComponents = {
  data: {
    by_name: {
      answer: AnswerPart,
      observation: ObservationPart,
      "machine-evidence": MachineEvidencePart,
      basis: BasisPart,
      "safety-notice": SafetyNoticePart,
      error: ErrorPart,
      followups: FollowupsPart,
      unknown: UnknownPart,
      usage: HiddenPart,
    },
    Fallback: UnknownPart,
  },
};

function UserMessage() {
  return (
    <MessagePrimitive.Root className="v2-row v2-row-user">
      <div className="msg-user">
        <MessagePrimitive.Parts components={partComponents} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="v2-row" data-testid="v2-assistant">
      <MessagePrimitive.Parts components={partComponents} />
    </MessagePrimitive.Root>
  );
}

export function ChatV2({
  turns,
  liveTurns,
  pending,
  busy,
  canStop,
  draft,
  onDraftChange,
  scopeCount,
  chatError,
  canRetry,
  handlers,
}: {
  turns: NotebookServerTurn[];
  liveTurns: { q: string; a: ChatTurn }[];
  pending: { q: string; a: ChatTurn } | null;
  busy: boolean;
  canStop: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  scopeCount: number;
  chatError: unknown;
  canRetry: boolean;
  handlers: ChatV2Handlers;
}) {
  // Module-level sinks keep the registered part components stable (remounting
  // them on every render would restart markdown parsing mid-stream).
  citationSink = handlers.onCitation;
  followupSink = handlers.onSend;

  const runtime = useMiraChatRuntime({
    turns,
    liveTurns,
    pending,
    busy,
    onSend: handlers.onSend,
    onCancel: handlers.onStop,
  });

  const [attachOpen, setAttachOpen] = useState(false);
  const empty = turns.length === 0 && liveTurns.length === 0 && !pending;

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    handlers.onSend(text);
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="v2-thread">
        <ThreadPrimitive.Viewport className="v2-viewport" autoScroll>
          {empty && (
            <div className="v2-empty" data-testid="v2-empty">
              <div className="v2-empty-title">Ask about this machine</div>
              <div className="v2-empty-sub">
                {scopeCount === 0
                  ? "Answers are general until this machine has documents — then they're grounded and cited."
                  : "Answers cite this machine's manuals."}
              </div>
            </div>
          )}
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          {busy && !pending?.a.answer && (
            <div className="empty" aria-live="polite">
              Searching your docs…
            </div>
          )}
          {chatError != null && canRetry && (
            <div className="chip-row">
              <button className="chip" onClick={() => handlers.onRetry?.()}>
                Retry
              </button>
            </div>
          )}
          <ThreadPrimitive.ScrollToBottom
            className="v2-jump"
            data-testid="jump-to-latest"
            aria-label="Jump to latest"
          >
            ↓ Latest
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>

        {/* COMPOSER: deliberately MIRA-owned, not ComposerPrimitive.Input.
            The Enter/Shift+Enter/IME contract (lib/composer.ts
            `composerKeyAction`) and `enterKeyHint="send"` are already proven
            on the device against a soft keyboard; the library's input did not
            submit on a synthetic Enter here, and a composer that might not
            send on a phone is not a tradeoff worth taking for shell purity.
            assistant-ui still owns the thread, scroll and run state — the
            parts of the shell where it earns its keep. */}
        <div className="composer v2-composer">
          <button
            className="v2-attach"
            aria-label="Add a photo or document"
            data-testid="v2-attach"
            onClick={() => setAttachOpen((v) => !v)}
          >
            +
          </button>
          <textarea
            rows={1}
            enterKeyHint="send"
            aria-label="Ask a question"
            data-testid="v2-input"
            placeholder={
              scopeCount === 0 ? "Ask anything — no manual loaded yet" : "Ask a question…"
            }
            value={draft}
            onChange={(e) => {
              onDraftChange(e.target.value);
              autoGrow(e.target, 20);
            }}
            onKeyDown={(e) => {
              if (
                composerKeyAction({
                  key: e.key,
                  shiftKey: e.shiftKey,
                  isComposing: e.nativeEvent.isComposing,
                  keyCode: e.keyCode,
                }) === "send"
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy && canStop ? (
            <button
              className="btn-primary"
              data-testid="v2-stop"
              aria-label="Stop generating"
              onClick={handlers.onStop}
            >
              Stop
            </button>
          ) : busy ? (
            <button
              className="btn-primary"
              data-testid="v2-working"
              aria-label="Working"
              disabled
            >
              Working…
            </button>
          ) : (
            <button
              className="btn-primary"
              data-testid="v2-send"
              aria-label="Send"
              disabled={!draft.trim()}
              onClick={submit}
            >
              Send
            </button>
          )}
        </div>

        {attachOpen && (
          <Sheet label="Add to conversation" onClose={() => setAttachOpen(false)}>
            <div className="v2-attach-menu" data-testid="v2-attach-menu">
              <h3>Add to conversation</h3>
              <button
                className="v2-attach-item"
                onClick={() => {
                  setAttachOpen(false);
                  handlers.onAttachPhoto();
                }}
              >
                📷 Photo — ask about what you&apos;re looking at
              </button>
              <button
                className="v2-attach-item"
                onClick={() => {
                  setAttachOpen(false);
                  handlers.onAttachFile();
                }}
              >
                📄 Document — add a manual MIRA can cite
              </button>
            </div>
          </Sheet>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
