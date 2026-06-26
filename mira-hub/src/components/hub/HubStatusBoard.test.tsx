import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HubStatusBoard } from "./HubStatusBoard";
import type { HubZoneStatus } from "@/lib/hub/status";

const zones: HubZoneStatus[] = [
  {
    id: "conv_simple",
    label: "Conveyor Cell",
    kind: "conveyor_cell",
    state: "running",
    stale: false,
    metrics: {
      motor_run: true,
      vfd_speed_hz: 30,
      height_sensor_mm: 42,
    },
    updatedAt: "2026-06-25T12:00:00.000Z",
  },
  {
    id: "stardust.launch_1",
    label: "Stardust Launch 1",
    kind: "coaster_zone",
    state: "blocked",
    stale: false,
    metrics: {
      block_occupied: true,
      lsm_ready: false,
    },
    updatedAt: "2026-06-25T12:00:00.000Z",
  },
  {
    id: "stardust.launch_2",
    label: "Stardust Launch 2",
    kind: "coaster_zone",
    state: "faulted",
    stale: true,
    metrics: {
      brake_fault: true,
      magnetic_brake_temp_c: 78,
    },
    updatedAt: "2026-06-25T11:58:00.000Z",
  },
];

describe("HubStatusBoard", () => {
  it("renders conveyor, Stardust launch, and stale/fault states", () => {
    const html = renderToStaticMarkup(
      <HubStatusBoard initialStatus={{ zones, as_of: "2026-06-25T12:00:05.000Z" }} poll={false} />,
    );

    expect(html).toContain("One-Board Status");
    expect(html).toContain("Conveyor Cell");
    expect(html).toContain("Running");
    expect(html).toContain("Stardust Launch 1");
    expect(html).toContain("Blocked");
    expect(html).toContain("Stardust Launch 2");
    expect(html).toContain("Faulted");
    expect(html).toContain("Stale");
    expect(html).toContain("vfd speed hz");
    expect(html).toContain("magnetic brake temp c");
  });
});
