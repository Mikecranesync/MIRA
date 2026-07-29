import { describe, expect, it } from "vitest";
import { summarizeHubSignals, type SignalRow } from "./status";

const now = new Date("2026-06-25T12:00:00.000Z");

describe("summarizeHubSignals", () => {
  it("marks conveyor running from motor and speed tags", () => {
    const rows: SignalRow[] = [
      {
        plc_tag: "conv_simple.motor_run",
        value: true,
        last_changed_at: "2026-06-25T11:59:55.000Z",
      },
      {
        plc_tag: "conv_simple.vfd_speed_hz",
        value: 30,
        last_changed_at: "2026-06-25T11:59:55.000Z",
      },
      {
        plc_tag: "conv_simple.comm_ok",
        value: true,
        last_changed_at: "2026-06-25T11:59:55.000Z",
      },
    ];

    expect(summarizeHubSignals(rows, now)).toContainEqual(
      expect.objectContaining({
        id: "conv_simple",
        state: "running",
        stale: false,
      }),
    );
  });

  it("marks Stardust launch blocked from block occupied tag", () => {
    const rows: SignalRow[] = [
      {
        plc_tag: "stardust.launch_1.block_occupied",
        value: true,
        last_changed_at: "2026-06-25T11:59:55.000Z",
      },
      {
        plc_tag: "stardust.launch_1.lsm_ready",
        value: false,
        last_changed_at: "2026-06-25T11:59:55.000Z",
      },
    ];

    expect(summarizeHubSignals(rows, now)).toContainEqual(
      expect.objectContaining({
        id: "stardust.launch_1",
        state: "blocked",
      }),
    );
  });

  it("marks stale rows unknown when older than 60 seconds", () => {
    const rows: SignalRow[] = [
      {
        plc_tag: "conv_simple.comm_ok",
        value: true,
        last_changed_at: "2026-06-25T11:58:00.000Z",
      },
    ];

    expect(summarizeHubSignals(rows, now)[0]).toMatchObject({
      stale: true,
      state: "unknown",
    });
  });
});
