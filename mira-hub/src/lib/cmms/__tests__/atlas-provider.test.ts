import { describe, expect, it } from "vitest";

import { AtlasProvider } from "../atlas-provider";

describe("AtlasProvider", () => {
  it("builds browser-routable FactoryLM Works app links", () => {
    const provider = new AtlasProvider();
    const baseUrl = "https://cmms.factorylm.com/";

    expect(provider.buildDeepLink({ kind: "work_order", externalId: "WO 1", baseUrl }))
      .toBe("https://cmms.factorylm.com/app/work-orders/WO%201");
    expect(provider.buildDeepLink({ kind: "asset", externalId: "Pump #4", baseUrl }))
      .toBe("https://cmms.factorylm.com/app/assets/Pump%20%234");
    expect(provider.buildDeepLink({ kind: "pm", externalId: "PM-7", baseUrl }))
      .toBe("https://cmms.factorylm.com/app/preventive-maintenance/PM-7");
  });
});
