// Pure SSE frame parser for the Hub chat endpoints (sources → content* →
// status → [DONE]). Exported standalone so it is unit-testable and reusable by
// the Phase-4 streamed variant (same frames, incremental delivery).

export interface ChatCitation {
  citationId: string;
  sourceTitle: string;
  page?: number | null;
}

export interface ChatTurn {
  answer: string;
  citations: ChatCitation[];
  status: string;
}

export function parseChatSse(body: string, httpStatus = 200): ChatTurn {
  let answer = "";
  let citations: ChatCitation[] = [];
  let status = httpStatus === 200 ? "" : `http ${httpStatus}`;
  for (const block of body.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const frame = JSON.parse(payload) as Record<string, unknown>;
      if (frame.kind === "content") answer += String(frame.content ?? "");
      else if (frame.kind === "sources")
        citations = (frame.citations as ChatCitation[]) ?? [];
      else if (frame.kind === "status") status = String(frame.status ?? "");
    } catch {
      /* keep parsing subsequent frames */
    }
  }
  return { answer, citations, status };
}
