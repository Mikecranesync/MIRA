import { describe, expect, it } from "vitest";
import { connectorCardControls } from "./connector-card-controls";

describe("connectorCardControls — In testing must not hide an existing connection", () => {
  it("shows Disconnect and hides Connect when MaintainX is already connected", () => {
    expect(
      connectorCardControls({ connected: true, statusLabel: "In testing" }),
    ).toEqual({ showConnect: false, showDisconnect: true });
  });

  it("hides Connect when In testing and not connected", () => {
    expect(
      connectorCardControls({ connected: false, statusLabel: "In testing" }),
    ).toEqual({ showConnect: false, showDisconnect: false });
  });

  it("offers Connect for a proven connector that is not connected", () => {
    expect(connectorCardControls({ connected: false })).toEqual({
      showConnect: true,
      showDisconnect: false,
    });
  });

  it("offers Disconnect for a proven connector that is connected", () => {
    expect(connectorCardControls({ connected: true })).toEqual({
      showConnect: false,
      showDisconnect: true,
    });
  });

  it("hides both actions on info-only cards even if marked connected", () => {
    expect(
      connectorCardControls({ connected: true, infoOnly: true }),
    ).toEqual({ showConnect: false, showDisconnect: false });
  });
});
