/**
 * Prompt block for the observed state of the bound machine. The chat route
 * appends this after the visual-evidence section. It is labelled as human
 * report, not machine measurement, and says what these reports do not establish.
 */
import type { ObservedState } from "./project";

export const OBSERVED_STATE_HEADING = "Technician-reported observations (unverified; not machine measurements):";
export const OBSERVED_STATE_LIMITS =
  "Root cause, health and safe-to-operate are NOT established by these reports. Do not treat them as machine measurements or as confirmed causes.";

/** Empty state → "" so the prompt is byte-identical when nothing was observed. */
export function renderObservedStateSection(state: ObservedState | null): string {
  if (!state || state.facts.length === 0) return "";
  const lines = state.facts.map((f) => {
    const who = (e: ObservedState["facts"][number]["current"]) =>
      `${f.factKey}=${e.factValue} by ${e.author ?? "unknown technician"}, observed ${e.observedAt}, recorded ${e.recordedAt}, verification ${e.verificationMethod}, ${e.uncertainty}`;
    if (f.contested) {
      const hidden = f.conflictTotal - f.conflicting.length;
      return [
        `- ${f.factKey}: contested (${f.conflictTotal} conflicting reports within one hour)`,
        ...f.conflicting.map((e) => `  - ${who(e)}`),
        // Bounded list, exact count (#5106): the rest are unresolved, not dismissed.
        ...(hidden > 0 ? [`  - ${hidden} more conflicting reports are not listed here; they are unresolved, not dismissed.`] : []),
      ].join("\n");
    }
    return `- ${f.factKey}: ${f.state} — ${who(f.current)}`;
  });
  return [OBSERVED_STATE_HEADING, ...lines, OBSERVED_STATE_LIMITS].join("\n");
}
