// Pure helpers for the Equipment Notebook chat (unit-tested in node; the hub
// has no jsdom). Streaming / stop / composer mechanics live here so the
// component stays a thin view.

import { parseFrame, type EvidenceCitation, type NotebookChatFrame } from "@/lib/notebook-chat-types";

/** Enter sends; Shift+Enter is a newline; an in-progress IME composition
 *  (Japanese / Chinese / Korean keyboards, keyCode 229) never sends (CMPS-1). */
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

/** Auto-grow fallback for browsers without `field-sizing: content`: the height
 *  a textarea should take for its scrollHeight, capped at `maxPx` (≈6 rows). */
export function nextComposerHeight(scrollHeight: number, maxPx: number): number {
  return Math.max(0, Math.min(scrollHeight, maxPx));
}

/** Apply the auto-grow fallback to a live textarea (no-op under SSR). */
export function growTextarea(el: HTMLTextAreaElement | null, maxPx: number): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${nextComposerHeight(el.scrollHeight, maxPx)}px`;
  el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
}

export function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    ("name" in err ? (err as { name?: string }).name === "AbortError" : false)
  );
}

export type StreamResult = {
  content: string;
  citations: EvidenceCitation[];
  status: "answered" | "insufficient_evidence" | "error";
  basis: string | null;
  followups: string[];
};

/** Consume the notebook SSE body frame by frame. `onContent` fires after every
 *  `content` frame with the accumulated text so far (live rendering). Frames
 *  are `\n\n`-delimited `data:` lines — the same wire contract as before
 *  (content* → sources → evidence → [usage] → status → [followups] → [DONE]).
 *
 *  If the reader throws (an abort, a dropped connection) the partial `content`
 *  accumulated so far is attached to the error as `partial` so the caller can
 *  keep what streamed (STRM-2). */
export async function readNotebookStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onContent: (content: string, citations: EvidenceCitation[]) => void,
): Promise<StreamResult> {
  const dec = new TextDecoder();
  let buf = "";
  const out: StreamResult = { content: "", citations: [], status: "answered", basis: null, followups: [] };
  try {
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
        const frame: NotebookChatFrame | null = parseFrame(data);
        if (!frame) continue;
        if (frame.kind === "sources") out.citations = frame.citations;
        else if (frame.kind === "evidence") out.basis = frame.basis;
        else if (frame.kind === "followups") out.followups = frame.suggestions;
        else if (frame.kind === "content") {
          out.content += frame.content;
          onContent(out.content, out.citations);
        } else if (frame.kind === "status") out.status = frame.status;
      }
    }
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { partial: out.content });
  }
  return out;
}

/** What a stopped generation becomes: the partial text stays, the turn is an
 *  `error` (never `answered`), and it carries no citations / basis / follow-ups
 *  — a stopped answer is not an answer (STRM-2). */
export function stoppedTurn<T extends { content: string }>(turn: T, partial: string): T & {
  status: "error";
  stopped: true;
  citations: EvidenceCitation[];
  basis: null;
  followups: string[];
} {
  return { ...turn, content: partial, status: "error", stopped: true, citations: [], basis: null, followups: [] };
}
