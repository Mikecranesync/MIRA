import type { GroundingStatus } from "@factorylm/interaction";

/**
 * F004 (#4303): the ONE source of the status line both the Hub and the phone
 * show under a turn. Each line describes what MIRA's ATTEMPT did — searched,
 * found nothing, couldn't answer from what it read, couldn't reach the
 * library — and never claims the manual lacks the answer. `null` means the
 * turn's existing presentation already says enough (a cited answer's chips, a
 * stop's error, a safety stop's notice, an ordinary general answer's label).
 */
export const NOT_A_VERDICT = "That doesn't mean the manual doesn't cover it.";

export function groundingStatusLine(status: GroundingStatus): string | null {
  switch (status.outcome) {
    case "abstained_no_passages":
      return `The search didn't find a passage in the selected manual for this question. ${NOT_A_VERDICT}`;
    case "refused_without_passages":
      // A refusal in general mode searched no manual — nothing to say about one.
      return status.manualSearched
        ? `The search didn't find a passage in the selected manual for this question. ${NOT_A_VERDICT}`
        : null;
    case "refused_with_passages":
      return `MIRA read passages from the selected manual but couldn't answer from them. ${NOT_A_VERDICT}`;
    case "abstained_retrieval_unavailable":
      return "The manual library couldn't be reached just now, so this wasn't checked against it. Try again in a moment.";
    case "answered_uncited_with_passages":
      return "This answer doesn't point to a passage in the selected manual. Treat it as general guidance.";
    case "answered_without_manual":
      return status.isGeneralFallback ? "General guidance — not from your manual." : null;
    case "answered_citation_linked":
    case "safety_stop":
    case "stopped":
    case "provider_error":
      return null;
  }
}

export const GENERAL_GUIDANCE_ACTION = "Get general guidance (not from the manual)";
