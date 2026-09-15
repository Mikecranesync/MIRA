import type { DemoAsset, ShellState, SimLabDemoState } from "@factorylm/interaction";

export interface MachineViewProps {
  readonly state: ShellState;
  readonly demo: SimLabDemoState;
  /** Load the case-packer jam scenario. Absent = the control is not offered. */
  readonly onInject?: () => void;
  /** Return the line to its healthy baseline. Absent = the control is not offered. */
  readonly onReset?: () => void;
  /** A control is in flight; both are disabled and say so. */
  readonly busy?: boolean;
}

const CONDITION_LABEL: Readonly<Record<DemoAsset["condition"], string>> = {
  running: "Running",
  blocked: "Blocked",
  faulted: "Faulted",
  stopped: "Stopped",
  unknown: "No data",
};

const CONNECTION_LABEL: Readonly<Record<SimLabDemoState["connection"], string>> = {
  connecting: "Connecting to the simulated line…",
  live: "Live",
  stale: "Data is stale",
  offline: "Simulator unreachable",
};

function formatValue(value: number | boolean | string, unit: string): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const shown = typeof value === "number"
    ? (Number.isInteger(value) ? String(value) : value.toFixed(1))
    : value;
  return unit ? `${shown} ${unit}` : shown;
}

function formatAge(ageMs: number | null): string | null {
  if (ageMs === null) return null;
  const seconds = Math.round(ageMs / 1000);
  return seconds < 1 ? "just now" : `${seconds}s ago`;
}

/**
 * Whether the belt itself is turning.
 *
 * Read from `process.speed_fpm` and nothing else. A belt is not stopped because
 * the zone is blocked — on a real accumulation conveyor the belt keeps running
 * underneath held product, which is exactly what the snapshot says during the
 * jam (zone 02: `blocked = true`, `speed_fpm ≈ 60`). Conflating the two would
 * mean drawing a stopped belt while the payload on screen reports 60 fpm.
 */
function beltMotion(asset: DemoAsset, live: boolean): "running" | "stopped" {
  return live && asset.speedFpm !== null && asset.speedFpm > 0 ? "running" : "stopped";
}

/**
 * Whether PRODUCT is moving, which is the different question.
 *
 * Held when the zone is blocked (backpressure), stopped when the machine is
 * faulted or the data cannot be trusted. Splitting product motion from belt
 * motion is what lets the jam read correctly at a glance: the belts keep
 * turning, the cases stop.
 */
function productMotion(asset: DemoAsset, live: boolean): "moving" | "held" | "stopped" {
  if (!live) return "stopped";
  if (asset.condition === "blocked") return "held";
  if (asset.condition === "running") return asset.speedFpm === null || asset.speedFpm > 0 ? "moving" : "stopped";
  return "stopped";
}

/** Seconds for one case to cross a zone, from the belt's own speed. */
function beltDuration(speedFpm: number | null): string {
  if (speedFpm === null || speedFpm <= 0) return "0s";
  return `${Math.min(12, Math.max(1, 120 / speedFpm)).toFixed(2)}s`;
}

const ZONES = [
  { assetId: "conveyorzone01", x: 8, width: 176 },
  { assetId: "conveyorzone02", x: 208, width: 176 },
] as const;

function Belt({ asset, live }: { readonly asset: DemoAsset; readonly live: boolean }) {
  const zone = ZONES.find((candidate) => candidate.assetId === asset.assetId);
  if (!zone) return null;
  const { x, width } = zone;
  const product = productMotion(asset, live);
  const cases = [0, 1, 2, 3];
  return <g
    className="fl-machine__zone"
    data-asset={asset.assetId}
    data-condition={asset.condition}
    data-belt={beltMotion(asset, live)}
    data-product={product}
    style={{ "--fl-belt-duration": beltDuration(asset.speedFpm) } as Record<string, string>}
  >
    <rect className="fl-machine__belt" x={x} y={44} width={width} height={26} rx={4} />
    <line className="fl-machine__belt-run" x1={x + 6} y1={70} x2={x + width - 6} y2={70} />
    <g className="fl-machine__cases">
      {cases.map((index) => <rect
        key={index}
        className="fl-machine__case"
        x={x + 10 + index * 42}
        y={30}
        width={22}
        height={16}
        rx={2}
        style={{ "--fl-case-index": String(index) } as Record<string, string>}
      />)}
    </g>
    {asset.condition === "blocked"
      ? <line className="fl-machine__stop-bar" x1={x + width} y1={24} x2={x + width} y2={74} />
      : null}
  </g>;
}

function Packer({ asset }: { readonly asset: DemoAsset }) {
  return <g className="fl-machine__packer" data-condition={asset.condition}>
    <rect className="fl-machine__packer-body" x={408} y={24} width={168} height={50} rx={6} />
    <rect className="fl-machine__packer-infeed" x={384} y={44} width={24} height={26} rx={2} />
    {asset.condition === "faulted"
      ? <g className="fl-machine__packer-fault">
        <line x1={432} y1={36} x2={552} y2={62} />
        <line x1={432} y1={62} x2={552} y2={36} />
      </g>
      : null}
  </g>;
}

/**
 * The public demo's machine view: three assets of a simulated bottling line,
 * drawn small, above a conversation that stays the point of the page.
 *
 * **Public-only, by the component's own rule.** Like `DemoNotice`, it returns
 * `null` off a `publicDemo` profile rather than relying on a host to withhold
 * it, so the enterprise surfaces cannot grow a marketing diagram by accident.
 *
 * **The SVG is the look; the list is the meaning.** The diagram is
 * `aria-hidden` and every fact it depicts is also a real DOM element — asset
 * name, condition word, the evidence sentence behind that condition, and the
 * signals with their units. A screen reader, a text search, and a DOM test all
 * see the same thing the eye does, and nothing is stated in colour alone.
 *
 * **Motion is evidence, not decoration.** Belt movement is read from
 * `process.speed_fpm`; product movement is read from the blocked/faulted
 * condition. They are separate because during the jam they genuinely disagree —
 * the belts keep turning at 60 fpm while the cases stop. When the data goes
 * stale or the simulator is unreachable, everything stops moving and the strip
 * says why: an animation that keeps running on data we no longer trust is the
 * most confident lie this view could tell.
 */
export function MachineView({ state, demo, onInject, onReset, busy = false }: MachineViewProps) {
  if (!state.profile.publicDemo) return null;

  const live = demo.connection === "live";
  const age = formatAge(demo.ageMs);
  const zone01 = demo.assets.find((asset) => asset.assetId === "conveyorzone01");
  const zone02 = demo.assets.find((asset) => asset.assetId === "conveyorzone02");
  const packer = demo.assets.find((asset) => asset.assetId === "casepacker01");

  return <section
    className="fl-machine"
    aria-label="Demo line"
    data-connection={demo.connection}
    data-live={live}
  >
    <header className="fl-machine__status">
      <h2 className="fl-machine__title">Simulated bottling line — Line 01</h2>
      <p className="fl-machine__freshness" data-connection={demo.connection}>
        <span className="fl-machine__freshness-state">{CONNECTION_LABEL[demo.connection]}</span>
        {demo.observedAt !== null && age ? <span className="fl-machine__freshness-age"> · updated {age}</span> : null}
        {demo.observedAt !== null ? <span className="fl-machine__freshness-tick"> · tick {demo.tick}</span> : null}
      </p>
      {demo.error
        ? <p className="fl-machine__error" role="status">{demo.error}</p>
        : null}
      <div className="fl-machine__controls">
        {onInject
          ? <button type="button" className="fl-machine__control" data-action="inject" onClick={onInject} disabled={busy}>
            Inject case-packer jam
          </button>
          : null}
        {onReset
          ? <button type="button" className="fl-machine__control" data-action="reset" onClick={onReset} disabled={busy}>
            Reset to healthy
          </button>
          : null}
        {!onInject && !onReset
          ? <p className="fl-machine__hint">Fault injection is not wired up in this preview.</p>
          : null}
      </div>
    </header>

    {demo.assets.length > 0
      ? <svg
        className="fl-machine__diagram"
        viewBox="0 0 584 96"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        {zone01 ? <Belt asset={zone01} live={live} /> : null}
        {zone02 ? <Belt asset={zone02} live={live} /> : null}
        {packer ? <Packer asset={packer} /> : null}
      </svg>
      : null}

    {demo.assets.length === 0
      ? <p className="fl-machine__empty">
        No readings from the simulated line yet. Start it with <code>python -m simlab</code>.
      </p>
      : <ol className="fl-machine__assets">
        {demo.assets.map((asset) => <li
          key={asset.assetId}
          className="fl-machine__asset"
          data-asset={asset.assetId}
          data-condition={asset.condition}
        >
          <p className="fl-machine__asset-head">
            <span className="fl-machine__asset-name">{asset.name}</span>
            <span className="fl-machine__asset-state" data-condition={asset.condition}>
              {CONDITION_LABEL[asset.condition]}
            </span>
          </p>
          <p className="fl-machine__asset-reason">{asset.conditionReason}</p>
          {asset.signals.length > 0
            ? <dl className="fl-machine__signals">
              {asset.signals.map((signal) => <div key={signal.tag} className="fl-machine__signal">
                <dt>{signal.label}</dt>
                <dd>{formatValue(signal.value, signal.unit)}</dd>
              </div>)}
            </dl>
            : null}
        </li>)}
      </ol>}

    {demo.alarms.length > 0
      ? <ul className="fl-machine__alarms" aria-label="Active alarms">
        {demo.alarms.map((alarm) => <li
          key={`${alarm.assetId}-${alarm.code}`}
          className="fl-machine__alarm"
          data-severity={alarm.severity}
        >
          <span className="fl-machine__alarm-code">{alarm.code}</span>
          <span className="fl-machine__alarm-message">{alarm.message}</span>
          <span className="fl-machine__alarm-since">since tick {alarm.sinceTick}</span>
        </li>)}
      </ul>
      : null}
  </section>;
}
