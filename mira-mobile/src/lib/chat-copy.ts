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

/** Render an answer body: real text, or the humanized status fallback. */
export function answerBody(answerText: string | null, status: string): string {
  if (answerText && answerText.trim()) return answerText;
  return humanizeAnswerStatus(status) || "No answer.";
}
