// Human copy for machine answer-status tokens (punch list COPY-09): the
// grounding logic is right — the SURFACE must never leak a developer token
// like "(insufficient_evidence)" into a technician's chat.

export function humanizeAnswerStatus(status: string): string {
  const s = status.trim();
  if (!s || s === "answered") return "";
  if (s === "insufficient_evidence")
    return "I couldn't find anything about that in your sources.";
  if (s === "error") return "Something went wrong answering that — try again.";
  const http = s.match(/^http (\d+)$/);
  if (http) return `Something went wrong (${http[1]}) — try again.`;
  return s.replace(/_/g, " ");
}

export const PHOTO_ABSTENTION_COPY =
  "I saw your photo, but I couldn't find anything about it in the selected sources.";

/** Render an answer body: real text, or the humanized status fallback. */
export function answerBody(
  answerText: string | null,
  status: string,
  statusMessage: string | null | undefined = null,
  hasVisualEvidence = false,
): string {
  if (answerText && answerText.trim()) return answerText;
  if (status === "insufficient_evidence") {
    if (statusMessage?.trim()) return statusMessage;
    if (hasVisualEvidence) return PHOTO_ABSTENTION_COPY;
  }
  return humanizeAnswerStatus(status) || "No answer.";
}
