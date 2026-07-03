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
});
