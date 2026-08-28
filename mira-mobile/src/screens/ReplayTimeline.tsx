// Sensor REPLAY timeline — the chronological reconstruction of what Machine
// Memory actually observed around a fault (contract §4.3 / §5 S4).
//
// Renders ONLY server rows. Header = the Machine Memory summary + the Hub's
// freshness label; a "Live unavailable" banner whenever the roll-up is not
// live; each row = seconds relative to the anchor, tag, value (prev →),
// quality, and — when the two clocks disagree — the ingest time (D2). Three
// honest empty states; none of them draws a row that was never recorded.
import {
  FRESHNESS_LABEL,
  FRESHNESS_TITLE,
  LIVE_UNAVAILABLE_BANNER,
  REPLAY_WINDOW_PRESETS,
  clocksDiverge,
  formatRelativeSeconds,
  formatValue,
  liveUnavailable,
  replayWindowHeader,
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
  const label = FRESHNESS_LABEL[freshness.overall];
  const current: ReplayWindow = { pre: history.pre, post: history.post };
  // Server degradation (§4.3): the machine-history tables are missing. There is
  // nothing to count and nothing whose freshness could be labelled, so the
  // count, the freshness label and the "showing recorded history" banner are
  // all withheld — "0 observed changes · Stale" would claim the machine was
  // quiet when we simply never looked.
  const unavailable = history.reason === "unavailable";
  return (
    <div className="card replay" data-testid="replay-timeline" data-freshness={freshness.overall}>
      <div className="title">Fault: {hhmmss(anchor.at)}</div>
      <div className="meta">
        {summary.summary?.trim() || "Machine Memory window"}
        {unavailable ? null : (
          <>
            {" · "}
            <span title={FRESHNESS_TITLE[freshness.overall]} data-testid="freshness-label">
              {label}
            </span>
          </>
        )}
        {anchor.source === "state_window" ? " · anchored on the recorded fault window" : ""}
      </div>
      <div className="replay-window">
        <span className="meta" data-testid="replay-window-header">
          {unavailable ? `−${current.pre} s … +${current.post} s` : replayWindowHeader(rows.length, current)}
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
      {!unavailable && liveUnavailable(freshness) && (
        <div className="replay-banner" role="status">
          {LIVE_UNAVAILABLE_BANNER}
        </div>
      )}
      {unavailable && (
        <div className="meta" style={{ marginTop: 8 }}>
          Machine Memory isn&apos;t available for this workspace yet, so there is
          no recorded history to show.
        </div>
      )}
      {!unavailable && rows.length === 0 && (
        <div className="meta" style={{ marginTop: 8 }}>
          No recorded changes in the {history.pre} s before / {history.post} s
          after this fault.
        </div>
      )}
      {rows.length > 0 && (
        <ol className="replay-rows" aria-label="Observed machine changes">
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
