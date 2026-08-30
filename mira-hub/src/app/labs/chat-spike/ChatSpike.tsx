"use client";
/**
 * Compatibility-spike thread (PRD §8.3 criteria 1, 3, 4, 5-web, 6, 7).
 *
 * Transport: recorded contract-shaped SSE transcripts replayed incrementally
 * (fixture mode — deterministic, no auth). The production transport is the
 * same hook with `postNotebookChat`; nothing in this file parses display text
 * for control state. Keyword → fixture map below.
 */
import { useMemo, useState } from "react";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type DataMessagePartComponent,
  type SourceMessagePartComponent,
  type TextMessagePartComponent,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import type { MachineEvidenceEntry } from "@/lib/notebook-chat-types";
import { AssistantRuntimeProvider, useMiraChatRuntime, type SpikeTransport } from "@/lib/chat-adapter/runtime";
import {
  ABSTAIN_TRANSCRIPT,
  ANSWERED_TRANSCRIPT,
  MACHINE_EVIDENCE_TRANSCRIPT,
  PERSISTED_ROWS,
  PROVIDER_ERROR_TRANSCRIPT,
  SAFETY_TRANSCRIPT,
  UNKNOWN_FRAME_TRANSCRIPT,
} from "@/lib/chat-adapter/__fixtures__/transcripts";

function pickTranscript(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("14:03") || m.includes("replay") || m.includes("happened")) return MACHINE_EVIDENCE_TRANSCRIPT;
  if (m.includes("live") || m.includes("energized") || m.includes("cabinet")) return SAFETY_TRANSCRIPT;
  if (m.includes("torque")) return ABSTAIN_TRANSCRIPT;
  if (m.includes("fail")) return PROVIDER_ERROR_TRANSCRIPT;
  if (m.includes("unknown")) return UNKNOWN_FRAME_TRANSCRIPT;
  return ANSWERED_TRANSCRIPT;
}

/** Replays a transcript frame-by-frame (400 ms cadence), honoring abort the
 *  way a real fetch stream cancellation does. */
const fixtureTransport: SpikeTransport = (message, signal, onRawChunk) =>
  new Promise<void>((resolve, reject) => {
    const events = pickTranscript(message)
      .split("\n\n")
      .filter((l) => l.trim())
      .map((l) => l + "\n\n");
    let i = 0;
    let raw = "";
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", () => {
      clearInterval(timer);
      abort();
    });
    const timer = setInterval(() => {
      if (i >= events.length) {
        clearInterval(timer);
        resolve();
        return;
      }
      raw += events[i++];
      onRawChunk(raw);
    }, 400);
  });

/**
 * Real-HTTP SSE probe transport (spike device-pass lane). Same platform
 * primitives as the mobile `requestStream` (STRM-1): `window.fetch` +
 * `body.getReader()` + AbortSignal. On web this streams incrementally and
 * Stop aborts the server run (assert via GET /labs/chat-spike/stream). On a
 * Capacitor WebView with the CapacitorHttp fetch patch the body arrives as
 * ONE buffered chunk and the abort never reaches the server — the honest
 * platform limit this probe exists to observe (#3453). `onHttpChunk` reports
 * the delivery granularity so the proof is readable on-screen.
 */
function makeLiveTransport(onHttpChunk: (count: number) => void): SpikeTransport {
  return async (message, signal, onRawChunk) => {
    const res = await fetch("/labs/chat-spike/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`probe stream failed: ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let raw = "";
    let chunks = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      chunks += 1;
      onHttpChunk(chunks);
      onRawChunk(raw);
    }
  };
}

const SpikeText: TextMessagePartComponent = () => (
  <div style={{ color: "var(--foreground)" }}>
    <MarkdownTextPrimitive className="text-sm leading-relaxed [&_a]:pointer-events-none [&_img]:hidden" />
  </div>
);

const SpikeSource: SourceMessagePartComponent = (props) => (
  <span
    data-testid="source-chip"
    className="mr-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
    style={{ borderColor: "var(--border)", color: "var(--foreground-subtle)" }}
  >
    <span className="font-medium">[{props.id}]</span> {props.title}
  </span>
);

/** Criterion 7: machine-evidence card as a REGISTERED data-part component —
 *  recorded history styled distinctly from live, frozen label strings from
 *  the cross-lane replay contract rendered verbatim. */
const MachineEvidenceCard: DataMessagePartComponent = ({ data }) => {
  const e = data as MachineEvidenceEntry;
  const caption =
    e.reason === "unavailable"
      ? "Machine history unavailable"
      : e.rowCount === 0
        ? "No machine changes recorded in this window"
        : `${e.rowCount} observed changes`;
  return (
    <div
      data-testid="machine-evidence-card"
      className="mt-2 rounded-lg border p-2 text-xs"
      style={{ borderColor: "var(--border)", background: "var(--background-subtle)" }}
    >
      <div className="font-medium" style={{ color: "var(--foreground)" }}>
        Recorded machine history — {e.assetId}
      </div>
      <div style={{ color: "var(--foreground-subtle)" }}>
        {new Date(e.anchorAt).toISOString()} · −{e.pre}s / +{e.post}s · {caption} · freshness:{" "}
        {e.freshness}
      </div>
    </div>
  );
};

const SafetyNotice: DataMessagePartComponent = () => (
  <div
    data-testid="safety-notice"
    className="mb-2 rounded-lg border-2 p-2 text-sm font-medium"
    style={{ borderColor: "var(--danger, #b91c1c)", color: "var(--danger, #b91c1c)" }}
  >
    ⚠ Safety stop — this reply is a safety notice, not a troubleshooting answer.
  </div>
);

const BasisBadge: DataMessagePartComponent = ({ data }) => {
  const d = data as { basis: string; label: string | null };
  return (
    <div data-testid="basis-badge" className="mt-1 text-xs" style={{ color: "var(--foreground-subtle)" }}>
      {d.label ?? d.basis}
    </div>
  );
};

/** STRM-2 captions, rendered from the typed `data-error` part — never derived
 *  by scraping display text. */
const ErrorCaption: DataMessagePartComponent = ({ data }) => {
  const reason = (data as { reason: string }).reason;
  return (
    <p className="mt-1 text-xs" style={{ color: "var(--foreground-subtle)" }} data-testid={reason === "stopped" ? "stopped-caption" : "error-caption"}>
      {reason === "stopped"
        ? "Stopped — partial response, not a complete answer."
        : "MIRA couldn't answer this time. Retry when ready."}
    </p>
  );
};

const UnknownPartView: DataMessagePartComponent = ({ data }) => (
  <details data-testid="unknown-part" className="mt-1 text-xs" style={{ color: "var(--foreground-subtle)" }}>
    <summary>Unrecognized message part (inspect)</summary>
    <pre className="overflow-x-auto">{JSON.stringify(data, null, 2)}</pre>
  </details>
);

const HiddenPart: DataMessagePartComponent = () => null;

const partComponents = {
  Text: SpikeText,
  Source: SpikeSource,
  data: {
    by_name: {
      "machine-evidence": MachineEvidenceCard,
      "safety-notice": SafetyNotice,
      basis: BasisBadge,
      error: ErrorCaption,
      unknown: UnknownPartView,
      usage: HiddenPart,
      followups: HiddenPart,
      observation: HiddenPart,
    },
    Fallback: UnknownPartView,
  },
};

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-3 flex justify-end">
      <div
        className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed"
        style={{ background: "var(--brand-blue)", color: "white" }}
      >
        <MessagePrimitive.Parts components={partComponents} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="mb-3 w-full" data-testid="assistant-message">
      <MessagePrimitive.Parts components={partComponents} />
    </MessagePrimitive.Root>
  );
}

export function ChatSpike() {
  const [live, setLive] = useState(false);
  const [httpChunks, setHttpChunks] = useState(0);
  const transport = useMemo(
    () => (live ? makeLiveTransport(setHttpChunks) : fixtureTransport),
    [live],
  );
  const { runtime } = useMiraChatRuntime({
    transport,
    initialRows: PERSISTED_ROWS,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="mx-auto flex h-dvh max-w-2xl flex-col p-4">
        <div className="mb-2 rounded border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--foreground-subtle)" }}>
          <strong>Compatibility spike</strong> (dev-only, fixture transport). Try: a plain question ·
          “what happened at 14:03” · “is it safe to open the cabinet live” · “torque spec” ·
          “unknown frame” · “fail”. Stop mid-stream to prove STRM-2.
          <label className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              data-testid="live-toggle"
              checked={live}
              onChange={(e) => {
                setLive(e.target.checked);
                setHttpChunks(0);
              }}
            />
            Live SSE probe (real HTTP stream — web: incremental; device: one buffered chunk)
          </label>
          {live ? (
            <div data-testid="chunk-count">HTTP chunks this stream: {httpChunks}</div>
          ) : null}
        </div>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="relative min-h-0 flex-1 overflow-y-auto pr-1" autoScroll>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
            <ThreadPrimitive.ScrollToBottom
              data-testid="jump-to-latest"
              className="sticky bottom-2 left-1/2 rounded-full border px-3 py-1 text-xs disabled:hidden"
              style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              ↓ Latest
            </ThreadPrimitive.ScrollToBottom>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="mt-2 flex items-end gap-2 rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
            <ComposerPrimitive.Input
              rows={1}
              placeholder="Ask about the machine…"
              className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
              style={{ color: "var(--foreground)" }}
            />
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send
                data-testid="send"
                className="rounded-lg px-3 py-1.5 text-sm text-white disabled:opacity-40"
                style={{ background: "var(--brand-blue)" }}
              >
                Send
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel
                data-testid="stop"
                className="rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                Stop
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </div>
    </AssistantRuntimeProvider>
  );
}
