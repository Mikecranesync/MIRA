// Pure SSE frame parser for the Hub chat endpoints (sources → content* →
// status → [DONE]). Exported standalone so it is unit-testable and reusable by
// the Phase-4 streamed variant (same frames, incremental delivery).

export interface ChatCitation {
  citationId: string;
  sourceTitle: string;
  page?: number | null;
  /** 240-char cited passage from the server's sources frame (CIT-07: the
   *  tap-a-chip trust feature renders this). */
  quote?: string | null;
  docId?: string | null;
  /** Workspace file the cited chunk came from — the door to "Open original at
   *  cited page" (`/api/namespace/files/{fileId}/`). Present on live sources
   *  frames AND on persisted turn evidence; never invented client-side. */
  fileId?: string | null;
  /** Canonical ORIGIN file the cited doc was DERIVED from (server-resolved,
   *  085) — the nameplate photograph behind a materialized text doc. When
   *  present, THIS is the technician's original; `fileId` is the derived
   *  sidecar. Null/absent for ordinary uploads. */
  originFileId?: string | null;
}

export interface ChatTurn {
  answer: string;
  citations: ChatCitation[];
  status: string;
  /** Evidence basis (spec 1.3). Absent on older servers -> render nothing
   *  rather than guessing; an unlabelled answer must never be presented as
   *  grounded. */
  evidenceBasis?: string;
  /** One-sentence caption the server supplies for the badge. */
  evidenceLabel?: string;
  /** Deterministic follow-up questions (CONV-4) — answered turns only. */
  followups?: string[];
}

/** Explicit field-by-field mapping so a new server field is a deliberate
 *  addition here, not an accident of casting — and so `fileId` (the
 *  open-the-original door) can never be silently dropped. */
export function normalizeCitations(raw: unknown): ChatCitation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is Record<string, unknown> =>
        typeof c === "object" && c !== null && "citationId" in c,
    )
    .map((c) => ({
      citationId: String(c.citationId),
      sourceTitle: String(c.sourceTitle ?? "Attached document"),
      page: typeof c.page === "number" ? c.page : null,
      quote: typeof c.quote === "string" ? c.quote : null,
      docId: c.docId != null ? String(c.docId) : null,
      fileId: c.fileId != null ? String(c.fileId) : null,
      originFileId: c.originFileId != null ? String(c.originFileId) : null,
    }));
}

export function parseChatSse(body: string, httpStatus = 200): ChatTurn {
  let answer = "";
  let citations: ChatCitation[] = [];
  let status = httpStatus === 200 ? "" : `http ${httpStatus}`;
  let evidenceBasis: string | undefined;
  let followups: string[] | undefined;
  let evidenceLabel: string | undefined;
  for (const block of body.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const frame = JSON.parse(payload) as Record<string, unknown>;
      if (frame.kind === "content") answer += String(frame.content ?? "");
      else if (frame.kind === "sources")
        citations = normalizeCitations(frame.citations);
      else if (frame.kind === "status") status = String(frame.status ?? "");
      else if (frame.kind === "followups") {
        followups = Array.isArray(frame.suggestions)
          ? (frame.suggestions as unknown[]).map(String)
          : undefined;
      } else if (frame.kind === "evidence") {
        evidenceBasis = String(frame.basis ?? "");
        evidenceLabel = String(frame.label ?? "");
      }
    } catch {
      /* keep parsing subsequent frames */
    }
  }
  return { answer, citations, status, evidenceBasis, evidenceLabel, followups };
}
