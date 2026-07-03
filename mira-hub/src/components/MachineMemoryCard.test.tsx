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

  it("renders the work-order button disabled", () => {
    const html = renderToStaticMarkup(
      <MachineMemoryCard assetId="asset-1" initialData={POPULATED} poll={false} />,
    );

    const buttonMatch = html.match(/<button[^>]*>Create work order \(soon\)<\/button>/);
    expect(buttonMatch).not.toBeNull();
    expect(buttonMatch?.[0]).toContain("disabled");
  });
});
