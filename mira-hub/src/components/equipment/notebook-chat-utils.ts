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

/** The exact request body the chat route receives. Kept as one object so a
 *  Retry (CMPS-2) re-posts it byte-identically — same message, same scope,
 *  same history window — instead of recomputing anything. */
export type ChatBody = {
  message: string;
  sourceDocIds: string[];
  history: { role: "user" | "assistant"; content: string }[];
};

type HistoryTurn = {
  role: "user" | "assistant";
  content: string;
  status?: "answered" | "insufficient_evidence" | "error";
  stopped?: boolean;
};

/** Recent thread → multi-turn memory for the server (the route caps it again
 *  at 12 / 2000 chars). Only completed turns with content. A stopped turn
 *  (Stop pressed mid-stream, live or rehydrated — see `persistedTurns`) is
 *  NOT an answer and never enters the history the model sees. */
export function historyFromTurns(turns: HistoryTurn[]): ChatBody["history"] {
  return turns
    .filter((t) => t.content && !t.stopped && (t.role === "user" || t.role === "assistant"))
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content }));
}

export function buildChatBody(message: string, sourceDocIds: string[], turns: HistoryTurn[]): ChatBody {
  return { message, sourceDocIds, history: historyFromTurns(turns) };
}

/** After a failed send the technician's question goes back into the composer
 *  — unless they already started typing something else. */
export function restoreComposer(current: string, failedMessage: string): string {
  return current.trim() ? current : failedMessage;
}

/** POST one chat body and consume the stream. A non-2xx response throws
 *  `http_<status>` (never a fabricated answer); the caller decides whether to
 *  offer Retry. `fetchImpl` is injectable for tests only. */
export async function postNotebookChat(
  url: string,
  body: ChatBody,
  signal: AbortSignal,
  onContent: (content: string, citations: EvidenceCitation[]) => void,
  fetchImpl: typeof fetch = fetch,
): Promise<StreamResult> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  if (!res.body) throw new Error("no_stream");
  return readNotebookStream(res.body.getReader(), onContent);
}

/** One persisted turn row as the GET route returns it. */
export type PersistedTurn = {
  id: string;
  question: string;
  answerStatus: string;
  answerText: string | null;
  evidence: EvidenceCitation[];
  basis?: string | null;
};

type HydratedTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "answered" | "insufficient_evidence" | "error";
  citations?: EvidenceCitation[];
  basis?: string | null;
  stopped?: boolean;
};

/** Hydration mapping (reload). STOPPED-TURN CONTRACT (STRM-2, no schema
 *  change): the server persists a client-stopped turn as
 *  `answer_status='error'` + `answer_text=<partial>`, evidence=[], basis=null;
 *  a provider-failure turn is `error` + `answer_text=NULL`. So on the client:
 *  error + text ⇒ a stopped turn (partial shown, "Stopped" caption, no
 *  citations, excluded from history); error + null ⇒ the existing error copy.
 *  Same rule the live path applies via `stoppedTurn`. */
export function persistedTurns(rows: PersistedTurn[]): HydratedTurn[] {
  return rows.flatMap((t) => {
    const stopped = t.answerStatus === "error" && !!t.answerText;
    return [
      { id: `${t.id}-q`, role: "user" as const, content: t.question },
      {
        id: `${t.id}-a`,
        role: "assistant" as const,
        content: t.answerText ?? "I couldn't find that in the selected sources.",
        status: t.answerStatus as HydratedTurn["status"],
        citations: stopped ? [] : t.evidence,
        // 084 (#3387): the persisted basis — the badge survives reload.
        basis: stopped ? null : (t.basis ?? null),
        ...(stopped ? { stopped: true } : {}),
      },
    ];
  });
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
