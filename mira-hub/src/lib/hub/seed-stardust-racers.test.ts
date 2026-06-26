import { describe, expect, it } from "vitest";
import { STARDUST_ASSETS } from "../../../scripts/seed-stardust-racers";

describe("seed-stardust-racers contract", () => {
  it("includes the Stardust block-zone assets required by the one-board view", () => {
    const tags = STARDUST_ASSETS.map((asset) => asset.plc_tag);

    expect(tags).toEqual(
      expect.arrayContaining([
        "stardust.launch_1",
        "stardust.launch_2",
        "stardust.station_load",
        "stardust.station_unload",
      ]),
    );
  });

  it("keeps block-zone assets wired to Stardust UNS paths", () => {
    const blockZones = STARDUST_ASSETS.filter((asset) => asset.plc_tag.startsWith("stardust."));

    expect(blockZones).toHaveLength(4);
    for (const asset of blockZones) {
      expect(asset.equipment_type).toBe("Ride Block Zone");
      expect(asset.uns_topic_path).toMatch(/^factorylm\/stardust-racers\//);
      expect(asset.scada_path).toMatch(/^Site\/StardustRacers\//);
      expect(asset.last_reported_fault).toContain("magnetic brake");
    }
  });
});
