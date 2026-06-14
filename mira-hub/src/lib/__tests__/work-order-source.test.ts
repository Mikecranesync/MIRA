import { describe, it, expect } from "vitest";
import { workOrderSourceLabel } from "../work-order-source";

describe("workOrderSourceLabel", () => {
  it("never leaks the raw internal hub_ui slug (secret-shopper QA finding)", () => {
    expect(workOrderSourceLabel("hub_ui", false)).toBe("Manual");
  });

  it("maps known channel sources to friendly labels", () => {
    expect(workOrderSourceLabel("telegram_text", false)).toBe("Telegram");
    expect(workOrderSourceLabel("slack_text", false)).toBe("Slack");
    expect(workOrderSourceLabel("web", false)).toBe("Manual");
  });

  it("labels auto-PM work orders regardless of source", () => {
    expect(workOrderSourceLabel("hub_ui", true)).toBe("Auto-PM");
    expect(workOrderSourceLabel("", true)).toBe("Auto-PM");
  });

  it("defaults empty/missing source to Manual", () => {
    expect(workOrderSourceLabel("", false)).toBe("Manual");
    expect(workOrderSourceLabel(null, false)).toBe("Manual");
    expect(workOrderSourceLabel(undefined, false)).toBe("Manual");
  });

  it("humanizes any unmapped slug so no raw snake_case reaches the UI", () => {
    expect(workOrderSourceLabel("kiosk_qr", false)).toBe("Kiosk Qr");
  });
});
