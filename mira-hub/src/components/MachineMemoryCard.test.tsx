import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MachineMemoryCard, type MachineMemoryResponse } from "./MachineMemoryCard";

const EMPTY: MachineMemoryResponse = {
  uns_path: null,
  latest_run: null,
  latest_window: null,
  latest_diffs: [],
  evidence_window: null,
};

const POPULATED: MachineMemoryResponse = {
  uns_path: "enterprise.garage.demo_cell.cv_101",
  latest_run: {
    run_id: "r1",
    status: "closed",
    started_at: "2026-07-01T00:00:00Z",
    stopped_at: "2026-07-01T01:00:00Z",
    duration_seconds: 3600,
    run_trigger_tag: "cv101.run",
  },
  latest_window: {
    window_id: "w1",
    state: "idle",
    started_at: "2026-07-01T01:00:00Z",
    ended_at: null,
  },
  latest_diffs: [
    {
      diff_id: "d1",
      tag_path: "cv101.motor_current",
      severity: "warning",
      diff_type: "anomaly_A1_COMM_STALE",
      observed: 5.2,
      baseline: 4.0,
      delta_percent: 30,
      event_timestamp: "2026-07-01T00:30:00Z",
      next_check: "verify VFD comm cable",
    },
  ],
  evidence_window: {
    started_at: "2026-07-01T00:00:00Z",
    stopped_at: "2026-07-01T01:00:00Z",
    uns_path: "enterprise.garage.demo_cell.cv_101",
  },
};

describe("MachineMemoryCard", () => {
  it("renders the empty state when there is no machine memory data", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={null} poll={false} />,
    );

    expect(html).toContain("Machine memory");
    expect(html).toContain("No machine runs recorded for this asset yet.");
  });

  it("renders the empty state when the response has an empty payload", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={EMPTY} poll={false} />,
    );

    expect(html).toContain("No machine runs recorded for this asset yet.");
  });

  it("renders run/state status pills, severity rows, and next_check for a populated payload", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={POPULATED} poll={false} />,
    );

    expect(html).toContain("Run: closed");
    expect(html).toContain("State: idle");
    expect(html).toContain("cv101.motor_current");
    expect(html).toContain("anomaly_A1_COMM_STALE");
    expect(html).toContain("Next check: verify VFD comm cable");
    expect(html).toContain("Evidence: tag_events");
  });

  // T4 — anomaly→work-order link: the button goes live once a diff exists,
  // linking to /workorders/new with the diff prefilled.
  it("enables the create-work-order button and links to the prefilled form when a diff exists", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={POPULATED} poll={false} />,
    );

    expect(html).toContain(">Create work order<");
    expect(html).not.toContain("Create work order (soon)");
    expect(html).not.toContain("Create work order (no anomaly yet)");

    const hrefMatch = html.match(/href="([^"]*\/workorders\/new\?[^"]*)"/);
    expect(hrefMatch).not.toBeNull();
    const href = hrefMatch![1].replace(/&amp;/g, "&");
    const params = new URLSearchParams(href.split("?")[1]);

    expect(params.get("prefill_title")).toBe("[CV-101] anomaly_A1_COMM_STALE on cv101.motor_current");
    expect(params.get("prefill_description")).toBe("warning — next check: verify VFD comm cable");
    expect(params.get("source_run_diff_id")).toBe("d1");
  });

  it("keeps the create-work-order button disabled with a (no anomaly yet) label when there are no diffs", () => {
    const noDiffs: MachineMemoryResponse = { ...POPULATED, latest_diffs: [] };
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={noDiffs} poll={false} />,
    );

    const buttonMatch = html.match(/<button[^>]*>Create work order \(no anomaly yet\)<\/button>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch?.[0]).toContain("disabled");
    expect(html).not.toContain("/workorders/new?");
  });

  it("disables the button on the empty-data state (no anomaly yet)", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={EMPTY} poll={false} />,
    );

    const buttonMatch = html.match(/<button[^>]*>Create work order \(no anomaly yet\)<\/button>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch?.[0]).toContain("disabled");
  });

  // Live signals + current-state bubble (2026-07-04).
  const LIVE_AND_STALE: MachineMemoryResponse = {
    ...POPULATED,
    live_tags: [
      {
        tag_path: "[default]MIRA_IOCheck/VFD/vfd_dc_bus",
        value: "320.4",
        last_seen_at: new Date(Date.now() - 2_000).toISOString(),
        freshness: "live",
      },
      {
        tag_path: "[default]MIRA_IOCheck/VFD/vfd_torque",
        value: 0,
        last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        freshness: "stale",
      },
    ],
    current_state: { state: "running", since: "2026-07-01T01:00:00Z", fresh: true },
  };

  it("current_state wins over the (stale) latest_window in the State pill", () => {
    // latest_window.state is "idle" but current_state says "running".
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={LIVE_AND_STALE} poll={false} />,
    );
    expect(html).toContain("State: running");
    expect(html).not.toContain("State: idle");
  });

  it("live tags render underlined in the green ink token; stale tags render muted with last-seen", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={LIVE_AND_STALE} poll={false} />,
    );
    expect(html).toContain("Live signals");

    // Live row: underlined + state-green ink token + value.
    const liveRow = html.match(/<span class="underline[^"]*"[^>]*>vfd_dc_bus: 320\.4<\/span>/);
    expect(liveRow).not.toBeNull();
    expect(liveRow![0]).toContain("var(--status-green-ink)");

    // Stale row: muted, no underline, "last seen Xm ago" suffix. Match the
    // stale row's own opening <span> (the one directly wrapping vfd_torque).
    expect(html).toMatch(/last seen 10m ago/);
    const staleRow = html.match(/<span[^>]*>vfd_torque: 0/);
    expect(staleRow).not.toBeNull();
    expect(staleRow![0]).toContain("--foreground-muted");
    expect(staleRow![0]).not.toContain("underline");

    // Full tag path + raw value preserved in the title attribute.
    expect(html).toContain('title="[default]MIRA_IOCheck/VFD/vfd_dc_bus (raw: 320.4)"');
  });

  it("renders the engineering-unit display string when provided", () => {
    const scaled: MachineMemoryResponse = {
      ...POPULATED,
      live_tags: [
        {
          tag_path: "[default]MIRA_IOCheck/VFD/vfd_dc_bus",
          value: "3286",
          display: "328.6 V",
          numeric: 328.6,
          unit: "V",
          last_seen_at: new Date(Date.now() - 2_000).toISOString(),
          last_changed_at: new Date(Date.now() - 4_000).toISOString(),
          freshness: "live",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={scaled} poll={false} />,
    );
    expect(html).toContain("vfd_dc_bus: 328.6 V");
    expect(html).not.toContain("vfd_dc_bus: 3286");
    expect(html).toContain("· chg 4s ago"); // last_changed_at surfaced on live rows
  });

  it("renders a sparkline for tags with history points", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard
        assetId="asset-1"
        initialData={LIVE_AND_STALE}
        poll={false}
        initialHistory={{
          "[default]MIRA_IOCheck/VFD/vfd_dc_bus": [
            { t: 100, v: 320.4 },
            { t: 102, v: 328.6 },
            { t: 104, v: 322.1 },
          ],
        }}
      />,
    );
    expect(html).toContain('data-testid="sparkline"');
    expect(html).toContain("<polyline");
    // only the tag with history gets a sparkline
    expect(html.match(/data-testid="sparkline"/g)).toHaveLength(1);
  });

  it("collapses duplicate anomalies into one row with a ×N chip", () => {
    const dup = (id: string) => ({
      ...POPULATED.latest_diffs[0],
      diff_id: id,
      tag_path: "vfd/vfd101/dc_bus_v",
      diff_type: "anomaly_A9_DC_BUS",
    });
    const withDups: MachineMemoryResponse = {
      ...POPULATED,
      latest_diffs: [dup("d1"), dup("d2"), dup("d3"), dup("d4")],
    };
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={withDups} poll={false} />,
    );
    // one visible diff row (the "— <type>" span; the WO prefill href also
    // carries the type but URL-encoded, so this matches rows only)
    expect(html.match(/— anomaly_A9_DC_BUS/g)).toHaveLength(1);
    expect(html).toContain("×4");
  });

  it("renders State: comm_down when current_state downgrades", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard
        assetId="asset-1"
        initialData={{ ...POPULATED, current_state: { state: "comm_down", since: null, fresh: false } }}
        poll={false}
      />,
    );
    expect(html).toContain("State: comm_down");
  });

  it("live tags alone (no runs/windows) escape the empty state", () => {
    const onlySignals: MachineMemoryResponse = {
      ...EMPTY,
      uns_path: "enterprise.garage.demo_cell.cv_101",
      live_tags: LIVE_AND_STALE.live_tags,
      current_state: { state: "unknown", since: null, fresh: true },
    };
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={onlySignals} poll={false} />,
    );
    expect(html).not.toContain("No machine runs recorded for this asset yet.");
    expect(html).toContain("Live signals");
  });
});
