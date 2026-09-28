// Sensor REPLAY timeline — the chronological reconstruction of what Machine
// Memory actually observed around a fault (contract §4.3 / §5 S4).
//
// Renders ONLY server rows. Two facts, two labels (Workstream C, PRD §6.8 /
// §9.2): the header names the WINDOW's coverage (recorded count + bounds, or
// "history source unavailable"), and the current-cache freshness is shown as
// its own "Current connection: …" line — the word Live never stands beside an
// empty window. Each row = seconds relative to the anchor, tag, value
// (prev →), quality, and — when the two clocks disagree — the ingest time
// (D2). Three honest empty states; none draws a row that was never recorded.
import {
  EMPTY_WINDOW_MESSAGE,
  FRESHNESS_TITLE,
  HISTORY_UNAVAILABLE_MESSAGE,
  LIVE_UNAVAILABLE_BANNER,
  REPLAY_WINDOW_PRESETS,
  clocksDiverge,
  coverageHeader,
  currentConnectionLabel,
  effectiveCoverage,
  formatRelativeSeconds,
  formatValue,
  ingestLagNote,
  liveUnavailable,
  recordedBoundsLine,
  sameWindow,
  tagShortName,
  type AssetHistory,
  type ReplayWindow,
} from "../lib/replay";
import { hhmmss } from "../lib/sensor";

export function ReplayTimeline({
  history,
  onWindowChange,
}: {
  history: AssetHistory;
  /** S5 D2: the technician widens/narrows the window from the header; the
   *  caller re-fetches. The header names the window the rows were fetched
   *  for (`history.pre/post`) — the same numbers Ask MIRA sends. */
  onWindowChange?: (w: ReplayWindow) => void;
}) {
  const { anchor, rows, freshness, summary } = history;
  const current: ReplayWindow = { pre: history.pre, post: history.post };
  const coverage = effectiveCoverage(history);
  // Server degradation (§4.3): the machine-history tables are missing. There is
  // nothing to count, so the count and the "showing recorded history" banner
  // are withheld — "0 recorded observations" would claim the machine was quiet
  // when we simply never looked. The current-connection line is still a fact
  // about the cache and is shown, labelled.
  const unavailable = !coverage.historyAvailable;
  const lag = ingestLagNote(history.coverage);
  const bounds = recordedBoundsLine(history.coverage);
  return (
    <div className="card replay" data-testid="replay-timeline" data-freshness={freshness.overall}>
      <div className="title">Fault: {hhmmss(anchor.at)}</div>
      <div className="meta">
        {summary.summary?.trim() || "Machine Memory window"}
        {anchor.source === "state_window" ? " · anchored on the recorded fault window" : ""}
      </div>
      <div className="meta" title={FRESHNESS_TITLE[freshness.overall]} data-testid="current-connection">
        {currentConnectionLabel(freshness)}
      </div>
      <div className="replay-window">
        <span className="meta" data-testid="replay-window-header">
          {coverageHeader(history)}
        </span>
        {onWindowChange && (
          <div className="segmented" role="group" aria-label="Replay window">
            {REPLAY_WINDOW_PRESETS.map((p) => {
              const active = sameWindow(p, current);
              return (
                <button
                  key={p.label}
                  type="button"
                  className={`segment${active ? " segment-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => !active && onWindowChange({ pre: p.pre, post: p.post })}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {bounds && (
        <div className="meta" data-testid="recorded-bounds">
          {bounds}
        </div>
      )}
      {lag && (
        <div className="meta" data-testid="ingest-lag">
          {lag}
        </div>
      )}
      {!unavailable && rows.length > 0 && liveUnavailable(freshness) && (
        <div className="replay-banner" role="status">
          {LIVE_UNAVAILABLE_BANNER}
        </div>
      )}
      {unavailable && (
        <div className="meta" style={{ marginTop: 8 }} role="status">
          {HISTORY_UNAVAILABLE_MESSAGE}
        </div>
      )}
      {!unavailable && coverage.recorded === 0 && (
        <div className="meta" style={{ marginTop: 8 }} role="status" data-testid="empty-window">
          {EMPTY_WINDOW_MESSAGE}
        </div>
      )}
      {rows.length > 0 && (
        <ol className="replay-rows" aria-label="Recorded machine observations">
          {rows.map((r, i) => {
            const diverges = clocksDiverge(r.event_timestamp, r.ingested_at);
            return (
              <li key={`${r.event_timestamp}-${r.tag}-${i}`} className="replay-row" data-diverges={diverges}>
                <span className="replay-t">{formatRelativeSeconds(r.event_timestamp, anchor.at)}</span>
                <span className="replay-tag" title={r.tag}>
                  {tagShortName(r.tag)}
                </span>
                <span className="replay-val">
                  {formatValue(r.value)}
                  {r.prev_value !== undefined && r.prev_value !== null
                    ? ` (${formatValue(r.prev_value)} →)`
                    : ""}
                </span>
                <span className="replay-q meta">{r.quality ?? "—"}</span>
                {diverges && (
                  <span className="replay-ingested meta" title="Ingested later than observed">
                    ingested {hhmmss(r.ingested_at)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
