/**
 * AdapterMessage → assistant-ui ThreadMessageLike (spike criterion 7 support:
 * MIRA-specific parts ride as `data-*` message parts rendered by REGISTERED
 * components — zero forks of the library core).
 *
 * This is the ONLY module that speaks library types on the way in; the rest
 * of the app deals in the canonical contract (ADR-0039 isolation rule).
 */
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { AdapterMessage, MessagePart } from "./contract";

type TMLContentPart = Exclude<ThreadMessageLike["content"], string>[number];

function partToContent(part: MessagePart): TMLContentPart | null {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "source":
      return {
        type: "source",
        sourceType: "document",
        id: part.citation.citationId,
        title: part.citation.sourceTitle,
        mediaType: "text/plain",
      } as TMLContentPart;
    case "machine_evidence":
      return { type: "data-machine-evidence", data: part.entry };
    case "observation":
      return { type: "data-observation", data: part.entry };
    case "safety_notice":
      return { type: "data-safety-notice", data: { trigger: part.trigger } };
    case "basis":
      return { type: "data-basis", data: { basis: part.basis, label: part.label } };
    case "followups":
      return { type: "data-followups", data: { suggestions: part.suggestions } };
    case "usage":
      return { type: "data-usage", data: part.usage };
    case "unknown":
      return { type: "data-unknown", data: { raw: part.raw } };
    case "error":
      // Also drives message STATUS (below); the data part lets a registered
      // component render the stopped/failed caption.
      return { type: "data-error", data: { reason: part.reason } };
  }
}

export function toThreadMessage(msg: AdapterMessage): ThreadMessageLike {
  const content = msg.parts
    .map(partToContent)
    .filter((c): c is TMLContentPart => c !== null);
  const status: ThreadMessageLike["status"] =
    msg.role !== "assistant"
      ? undefined
      : msg.lifecycle === "running" || msg.lifecycle === "queued"
        ? { type: "running" }
        : msg.lifecycle === "stopped" || msg.lifecycle === "stopping"
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
