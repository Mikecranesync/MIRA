/**
 * MIRA ExternalStoreRuntime wiring — mobile (ADR-0039).
 *
 * MIRA owns message state, transport, evidence semantics and the STRM-2
 * stopped contract; assistant-ui renders. The screen keeps owning the send
 * path (`sendQuestion`) so LOOK/REPLAY riders, byte-identical Retry, scope
 * and history are unchanged — this hook only projects that state into the
 * runtime and routes composer actions back to it.
 */
import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ChatCitation, ChatTurn } from "../lib/sse";
import type { NotebookServerTurn } from "../api/resources";
import { citationsOf, type AdapterMessage, type MessagePart } from "./contract";
import { threadMessages } from "./turns-to-parts";

type TMLPart = Exclude<ThreadMessageLike["content"], string>[number];

/** Sentinel marking a user turn, whose body is plain text (no citations). */
const USER_TURN: ChatCitation[] = [];

/** The ONLY function that speaks assistant-ui types inbound (ADR-0039
 *  isolation rule): MIRA parts → library message parts. MIRA-specific parts
 *  ride as `data-*` and are rendered by REGISTERED components — never a fork
 *  of the library core. */
function partToContent(part: MessagePart, citations: ChatCitation[]): TMLPart | null {
  switch (part.type) {
    case "text":
      // The assistant body renders through MIRA's own markdown + citation-mark
      // pipeline (AnswerMarkdown / remarkCitationMarks), so it rides as a data
      // part carrying the structured citations that gate which [n] marks may
      // become chips. A user turn is plain text.
      return citations === USER_TURN
        ? { type: "text", text: part.text }
        : {
            type: "data-answer",
            data: { text: part.text, citations, knownIds: part.knownCitationIds } as never,
          };
    case "source":
      // Citations are already carried structurally on `data-answer` (they must
      // gate the inline marks in the SAME render pass). Emitting them again as
      // library source parts would double-render the chip row.
      return null;
    case "machine_evidence":
      return { type: "data-machine-evidence", data: part.entry as never };
    case "observation":
      return { type: "data-observation", data: part.entry as never };
    case "safety_notice":
      return { type: "data-safety-notice", data: { trigger: part.trigger } as never };
    case "basis":
      return { type: "data-basis", data: { basis: part.basis, label: part.label } as never };
    case "followups":
      return { type: "data-followups", data: { suggestions: part.suggestions } as never };
    case "error":
      return { type: "data-error", data: { reason: part.reason } as never };
    case "unknown":
      return { type: "data-unknown", data: { raw: part.raw } as never };
  }
}

export function toThreadMessage(msg: AdapterMessage): ThreadMessageLike {
  const citations = msg.role === "user" ? USER_TURN : citationsOf(msg);
  const content = msg.parts
    .map((p) => partToContent(p, citations))
    .filter((c): c is TMLPart => c !== null);
  const status: ThreadMessageLike["status"] =
    msg.role !== "assistant"
      ? undefined
      : msg.lifecycle === "running"
        ? { type: "running" }
        : msg.lifecycle === "stopped"
          ? { type: "incomplete", reason: "cancelled" }
          : msg.lifecycle === "failed"
            ? { type: "incomplete", reason: "error" }
            : { type: "complete", reason: "stop" };
  return {
    id: msg.id,
    role: msg.role,
    content: content.length ? content : [{ type: "text", text: "" }],
    status,
  };
}

export function useMiraChatRuntime(opts: {
  /** Persisted server turns (hydration truth). */
  turns: NotebookServerTurn[];
  /** Session live turns. */
  liveTurns: { q: string; a: ChatTurn }[];
  /** In-flight turn, or null. */
  pending: { q: string; a: ChatTurn } | null;
  busy: boolean;
  /** The screen's send path — riders, history, scope and Retry stay there. */
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const messages = useMemo(
    () => threadMessages(opts.turns, opts.liveTurns, opts.pending),
    [opts.turns, opts.liveTurns, opts.pending],
  );

  const runtime = useExternalStoreRuntime<AdapterMessage>({
    messages,
    isRunning: opts.busy,
    convertMessage: toThreadMessage,
    onNew: async (message) => {
      const first = message.content.find(
        (p): p is { type: "text"; text: string } =>
          typeof p === "object" && p !== null && (p as { type?: string }).type === "text",
      );
      const text = first?.text?.trim() ?? "";
      if (text) opts.onSend(text);
    },
    onCancel: async () => {
      opts.onCancel();
    },
  });

  return runtime;
}

export { AssistantRuntimeProvider };
