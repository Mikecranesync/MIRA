/**
 * The safety hard-stop banner — ONE definition, both mobile surfaces
 * (FLEET-003; ADR-0038 item 3, mobile completion).
 *
 * WHY THIS FILE EXISTS. ChatV2 already rendered a safety banner; the classic
 * NotebookScreen rendered nothing at all, so a LOTO / arc-flash refusal
 * reloaded there as an ordinary assistant answer. Fixing that by pasting the
 * markup into the classic screen would have created two copies of safety copy
 * free to drift — and the classic screen is precisely the FALLBACK surface a
 * technician lands on when the server withholds the `chat_v2` capability. The
 * one place where the two surfaces must agree is the one place that must never
 * be duplicated.
 *
 * Colour is NOT the carrier: the icon glyph, the bold lead-in and
 * `role="alert"` all state the meaning without it (industrial-hmi doctrine —
 * strong colour is reserved for the abnormal state, and it may never be the
 * only channel).
 */

/** Shared safety-stop banner. Presentational only — no state, no transport. */
export function SafetyNotice() {
  return (
    <div
      className="safety-notice"
      data-testid="safety-notice"
      role="alert"
      aria-label="Safety stop"
    >
      <strong>⚠ Safety stop.</strong> This reply is a safety instruction, not a
      troubleshooting answer. Isolate and verify before working on this equipment.
    </div>
  );
}
