/**
 * Connector Commissioning status — PURE aggregation logic, no framework imports.
 *
 * Turns the signals the Hub already collects (activation/claim rows, gateway
 * online probe, approved_tags, live_signal_cache freshness, kg_entities UNS
 * binding, display reachability) into the remote-commissioning checklist a user
 * in Orlando reads to know whether a customer-site connector is ready — and what
 * still needs doing on-site.
 *
 * READ-ONLY by nature: this is a pure function over already-fetched signals. It
 * computes status; it never mutates anything. Same store-agnostic / injected-
 * input pattern as command-center-freshness.ts so it unit-tests under vitest with
 * no DB or network. The route layer (api/command-center/commissioning) does all
 * I/O and calls this.
 *
 * This ASSEMBLES the existing loop (ignition/ edge → mira-web claim → mira-relay
 * ingest → mira-hub); it does NOT introduce a new connector/relay/claim system.
 * Remote tag approval (discovered/rejected tags, approve-to-UNS) is deliberately
 * out of scope here — see feat/remote-tag-approval.
 */

export type ItemState = "ok" | "warn" | "missing";

/** Signals the route gathers from existing tables/probes, fed to the pure fn. */
export interface CommissioningSignals {
  /** activated rows in plg_activation_codes for this tenant */
  gatewayCount: number;
  /** of those, how many the gateway probe found reachable right now */
  onlineGatewayCount: number;
  /** kg_entities/cmms_equipment nodes with a (resolvable) uns_path */
  boundEquipmentCount: number;
  /** equipment nodes whose uns_path is resolvable → Ask-MIRA can bind */
  resolvableUnsCount: number;
  /** enabled approved_tags rows for this tenant */
  approvedTagCount: number;
  /** enabled display_endpoints rows */
  displayCount: number;
  /** of those, how many probed reachable */
  reachableDisplayCount: number;
  /** tenant-wide tag freshness counts (from command-center-freshness) */
  freshness: { live: number; stale: number; simulated: number };
}

export interface CommissioningItem {
  key: string;
  label: string;
  state: ItemState;
  detail: string;
}

export interface CommissioningStatus {
  /** core readiness: a desk user can rely on this connector for live + Ask-MIRA */
  ready: boolean;
  checklist: CommissioningItem[];
  /** the single most important thing still owed (on-site or in-Hub) */
  nextAction: string;
}

const item = (key: string, label: string, state: ItemState, detail: string): CommissioningItem => ({
  key,
  label,
  state,
  detail,
});

/**
 * Build the commissioning checklist + next action for ONE connector context
 * (a tenant/site/equipment). Pure — caller passes already-gathered signals.
 *
 * State meaning: ok (green) = done; warn (amber) = degraded but present;
 * missing (red/grey) = not done, needs action. `ready` requires the core path
 * (claimed → online → bound → approved tags → live data → Ask-MIRA bindable);
 * display reachability is secondary and never blocks `ready`.
 */
export function buildCommissioningStatus(s: CommissioningSignals): CommissioningStatus {
  const claimed = s.gatewayCount > 0;
  const online = s.onlineGatewayCount > 0;
  const bound = s.boundEquipmentCount > 0;
  const tags = s.approvedTagCount > 0;
  const askMira = s.resolvableUnsCount > 0;

  // live data: live > 0 → ok; only stale → warn; only simulated → warn; none → missing
  let liveState: ItemState;
  let liveDetail: string;
  if (s.freshness.live > 0) {
    liveState = "ok";
    liveDetail = `${s.freshness.live} tag(s) live`;
  } else if (s.freshness.stale > 0) {
    liveState = "warn";
    liveDetail = `${s.freshness.stale} tag(s) stale — no fresh data`;
  } else if (s.freshness.simulated > 0) {
    liveState = "warn";
    liveDetail = "only simulated data";
  } else {
    liveState = "missing";
    liveDetail = "no live data yet";
  }

  // display: reachable > 0 → ok; configured but none reachable → warn; none → missing
  let displayState: ItemState;
  let displayDetail: string;
  if (s.reachableDisplayCount > 0) {
    displayState = "ok";
    displayDetail = `${s.reachableDisplayCount} display(s) reachable`;
  } else if (s.displayCount > 0) {
    displayState = "warn";
    displayDetail = `${s.displayCount} display(s) configured, none reachable`;
  } else {
    displayState = "missing";
    displayDetail = "no live display registered";
  }

  const checklist: CommissioningItem[] = [
    item("claimed", "Connector claimed", claimed ? "ok" : "missing",
      claimed ? `${s.gatewayCount} gateway(s) activated` : "no gateway has activated a claim code"),
    item("online", "Connector online", online ? "ok" : "missing",
      online ? `${s.onlineGatewayCount}/${s.gatewayCount} gateway(s) reachable`
             : claimed ? "claimed but no gateway is reachable" : "no connector to reach"),
    item("bound", "Bound to equipment / UNS", bound ? "ok" : "missing",
      bound ? `${s.boundEquipmentCount} equipment node(s) on the namespace` : "no equipment bound in the namespace"),
    item("source", "Source reachable", online ? "ok" : "missing",
      online ? "Ignition gateway responding" : "Ignition gateway not reachable"),
    item("display", "Display reachable", displayState, displayDetail),
    item("approvedTags", "Approved tags present", tags ? "ok" : "missing",
      tags ? `${s.approvedTagCount} tag(s) on the allowlist` : "no tags approved (allowlist empty — ingest is fail-closed)"),
    item("liveData", "Live data flowing", liveState, liveDetail),
    item("askMira", "Ask-MIRA ready", askMira ? "ok" : "missing",
      askMira ? "asset has a resolvable UNS path" : "no resolvable UNS path to bind Ask-MIRA"),
  ];

  const ready = claimed && online && bound && tags && askMira && liveState === "ok";

  // next action = first unmet step in commissioning order
  let nextAction: string;
  if (!claimed) {
    nextAction = "Generate a claim code in the Hub and enter it on the gateway (Ignition ConnectSetup).";
  } else if (!online) {
    nextAction = "Connector claimed but offline — have the on-site person confirm the gateway/edge box is running.";
  } else if (!bound) {
    nextAction = "Bind the connector to a site/equipment node — build the namespace for this asset.";
  } else if (!tags) {
    nextAction = "Approve the connector's tags (allowlist) so live data can flow — ingest is fail-closed.";
  } else if (liveState !== "ok") {
    nextAction =
      liveState === "warn"
        ? "Live data is stale/simulated — have the on-site person check the gateway tag-stream timer."
        : "No live data yet — have the on-site person start the gateway tag-stream timer.";
  } else if (!askMira) {
    nextAction = "Resolve the asset's UNS path so Ask-MIRA can bind to it.";
  } else if (displayState !== "ok") {
    nextAction = "Live data is flowing; optionally register/repair the live display for hands-off viewing.";
  } else {
    nextAction = "Ready — connector is claimed, online, live, and Ask-MIRA is bound.";
  }

  return { ready, checklist, nextAction };
}
