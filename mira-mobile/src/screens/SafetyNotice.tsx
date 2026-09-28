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

/**
 * Shared safety banner. Presentational only — no state, no transport.
 *
 * Two variants, split by `terminal` (mirrors the hub's terminal-vs-directive
 * split, #3841/#3893):
 *   - `terminal` (default) — the hard stop: the reply is an isolation
 *     instruction, not an answer. Red, `role="alert"`.
 *   - `terminal={false}` — the energized-electrical DIRECTIVE: the turn IS an
 *     answer, framed by an NFPA 70E warning. A warning, not a stop, so the
 *     answer/citations/basis around it stay visible; `role="note"` and warning
 *     colour keep it distinct from a hard stop without claiming the turn was
 *     refused. Colour is never the only channel (glyph + bold lead-in state the
 *     meaning) — industrial-hmi doctrine.
 */
export function SafetyNotice({ terminal = true }: { terminal?: boolean } = {}) {
  if (!terminal) {
    return (
      <div
        className="safety-notice safety-notice-directive"
        data-testid="safety-notice"
        data-variant="directive"
        role="note"
        aria-label="Energized-work safety directive"
      >
        <strong>⚠ Energized-work safety directive.</strong> This answer covers
        work on or near energized equipment. De-energize and verify absence of
        voltage where possible; if energized work is unavoidable, follow NFPA 70E
        (risk assessment, PPE, permit) before proceeding.
      </div>
    );
  }
  return (
    <div
      className="safety-notice"
      data-testid="safety-notice"
      data-variant="stop"
      role="alert"
      aria-label="Safety stop"
    >
      <strong>⚠ Safety stop.</strong> This reply is a safety instruction, not a
      troubleshooting answer. Isolate and verify before working on this equipment.
    </div>
  );
}
