import { describe, test, expect } from "vitest";
import {
  scanForSafetyKeywords,
  scanBoth,
  formatAlertTelegram,
  formatAlertSlackBlocks,
  safetyAlertSseChunk,
} from "../safety-alert";

describe("scanForSafetyKeywords", () => {
  test("returns null for safe text", () => {
    expect(scanForSafetyKeywords("Check the oil level on the motor", "VFD-07")).toBeNull();
  });

  test("detects 'loto' keyword", () => {
    const alert = scanForSafetyKeywords("Before replacing the capacitor, follow LOTO procedure", "VFD-07");
    expect(alert).not.toBeNull();
    expect(alert!.keyword).toBe("loto");
    expect(alert!.severity).toBe("critical");
  });

  test("detects 'arc flash' keyword", () => {
    const alert = scanForSafetyKeywords("There is an arc flash risk on panel B", "PANEL-B");
    expect(alert).not.toBeNull();
    expect(alert!.keyword).toBe("arc flash");
  });

  test("detects 'voltage' keyword", () => {
    const alert = scanForSafetyKeywords("Check the voltage before touching the terminals", "EQ-1");
    expect(alert).not.toBeNull();
    expect(alert!.keyword).toBe("voltage");
  });

  test("detects 'confined space' keyword", () => {
    const alert = scanForSafetyKeywords("Work requires confined space entry permit", "TANK-1");
    expect(alert).not.toBeNull();
    expect(alert!.keyword).toBe("confined space");
    expect(alert!.severity).toBe("critical");
  });

  test("picks highest severity when multiple keywords present", () => {
    // 'voltage' is medium, 'arc flash' is critical — critical wins
    const alert = scanForSafetyKeywords("voltage arc flash hazard", "EQ-1");
    expect(alert!.severity).toBe("critical");
    expect(alert!.keyword).toBe("arc flash");
  });

  test("is case-insensitive", () => {
    expect(scanForSafetyKeywords("LOCKOUT procedure required", "EQ-1")).not.toBeNull();
    expect(scanForSafetyKeywords("Energized equipment present", "EQ-1")).not.toBeNull();
  });

  test("sets detectedIn field correctly", () => {
    const alert = scanForSafetyKeywords("loto required", "EQ-1", "bot_response");
    expect(alert!.detectedIn).toBe("bot_response");
  });

  test("returns assetId in alert", () => {
    const alert = scanForSafetyKeywords("arc flash risk", "VFD-07");
    expect(alert!.asset).toBe("VFD-07");
  });

  test("includes scannedAt timestamp", () => {
    const alert = scanForSafetyKeywords("lockout", "EQ-1");
    expect(alert!.scannedAt).toBeTruthy();
    expect(new Date(alert!.scannedAt).getTime()).toBeGreaterThan(0);
  });
});

describe("scanBoth", () => {
  test("returns null when neither side has keywords", () => {
    expect(scanBoth("change the filter", "filter replaced successfully", "EQ-1")).toBeNull();
  });

  test("returns alert from user message", () => {
    const alert = scanBoth("LOTO this panel", "I'll help you with that", "EQ-1");
    expect(alert).not.toBeNull();
    expect(alert!.detectedIn).toBe("user_message");
  });

  test("returns alert from bot response", () => {
    const alert = scanBoth("fix the motor", "Make sure to follow lockout procedures", "EQ-1");
    expect(alert).not.toBeNull();
    expect(alert!.detectedIn).toBe("bot_response");
  });

  test("marks detectedIn as 'both' when both sides trigger", () => {
    const alert = scanBoth("LOTO the panel", "Arc flash hazard present", "EQ-1");
    expect(alert!.detectedIn).toBe("both");
  });

  test("returns highest severity when both trigger different levels", () => {
    // user: voltage (medium), bot: arc flash (critical)
    const alert = scanBoth("voltage check", "arc flash risk present", "EQ-1");
    expect(alert!.severity).toBe("critical");
  });
});

describe("formatAlertTelegram", () => {
  const alert = scanForSafetyKeywords("loto required", "VFD-07")!;

  test("contains severity", () => {
    expect(formatAlertTelegram(alert)).toContain("CRITICAL");
  });

  test("contains asset", () => {
    expect(formatAlertTelegram(alert)).toContain("VFD-07");
  });

  test("contains keyword", () => {
    expect(formatAlertTelegram(alert)).toContain("loto");
  });

  test("contains recommendation", () => {
    expect(formatAlertTelegram(alert)).toContain("lockout/tagout procedure");
  });
});

describe("formatAlertSlackBlocks", () => {
  const alert = scanForSafetyKeywords("arc flash hazard", "PANEL-A")!;

  test("returns array of blocks", () => {
    const blocks = formatAlertSlackBlocks(alert);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  test("first block is header", () => {
    const blocks = formatAlertSlackBlocks(alert) as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe("header");
  });

  test("contains severity in header text", () => {
    const out = JSON.stringify(formatAlertSlackBlocks(alert));
    expect(out).toContain("CRITICAL");
  });
});

describe("safetyAlertSseChunk", () => {
  test("returns a valid SSE data: line", () => {
    const alert = scanForSafetyKeywords("loto", "EQ-1")!;
    const chunk = safetyAlertSseChunk(alert);
    expect(chunk.startsWith("data:")).toBe(true);
    expect(chunk.endsWith("\n\n")).toBe(true);
  });

  test("contains keyword in chunk content", () => {
    const alert = scanForSafetyKeywords("arc flash", "EQ-1")!;
    const chunk = safetyAlertSseChunk(alert);
    expect(chunk).toContain("ARC FLASH");
  });
});
