/**
 * Conversational follow-up suggestions for the Equipment Notebook.
 *
 * Deterministic and evidence-derived — no LLM call, no new retrieval. The
 * completeness machinery already knows the question's shape and which facets
 * the excerpts PROVED; a parameter/fault answer names its own subject. Each
 * suggestion is a real question the proven answer paths handle well
 * (facet setup/how-it-works, spec range, keypad navigation, fault clear), so
 * tapping a chip lands on a battle-tested lane instead of a novel one.
 *
 * Contract: never suggest a facet the excerpts did not prove (a gap facet is
 * declared in the answer, not dangled as a tappable dead end), and never
 * suggest anything on a refusal or error. Builds ON TOP of the frozen
 * intelligence baseline — this module only READS the plan/evidence outputs.
 */
import type { CoveragePlan } from "@/lib/notebook-query";

const MAX_SUGGESTIONS = 3;

// Local copies of the frozen layer's token shapes (read-only duplication —
// importing would require exporting internals from the frozen module).
const PARAM_ID = /\b[PpAaBbCcHhLdtUu]\d{2,4}\b/;
const FAULT_CODE = /\bF\d{2,4}\b/i;
const COMM_FACET = /ethernet|modbus|dsi|adapter|profibus|profinet|devicenet|canopen|bacnet/i;

export function buildFollowupSuggestions(input: {
  plan: CoveragePlan;
  /** Facets whose evidence pages were non-empty (facetEvidencePages output). */
  provenFacets: string[];
  answer: string;
  status: "answered" | "insufficient_evidence" | "error";
}): string[] {
  if (input.status !== "answered") return [];
  const out: string[] = [];
  const push = (s: string) => {
    if (out.length < MAX_SUGGESTIONS && !out.includes(s)) out.push(s);
  };

  if ((input.plan.shape === "multi_facet" || input.plan.shape === "exhaustive") && input.provenFacets.length) {
    for (const facet of input.provenFacets) {
      push(
        COMM_FACET.test(facet)
          ? `How do I set up ${facet}?`
          : `How does ${facet} work on this drive?`,
      );
    }
    return out;
  }

  // Fault answers first: a fault-meaning reply's natural next step is clearing
  // it (the fault-clear procedure is a proven lane).
  const fault = input.answer.match(FAULT_CODE);
  if (fault && /\bfault\b/i.test(input.answer)) {
    push(`How do I clear fault ${fault[0].toUpperCase()}?`);
  }

  // Parameter answers: range (spec lane) + keypad navigation (procedure lane).
  const param = input.answer.match(PARAM_ID);
  if (param) {
    const id = param[0];
    push(`What's the valid range for ${id}?`);
    push(`How do I change ${id} from the keypad?`);
  }

  return out;
}
