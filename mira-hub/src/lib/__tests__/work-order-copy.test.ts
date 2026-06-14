import { describe, it, expect } from "vitest";
import { photoAttachHelp } from "../work-order-copy";

describe("photoAttachHelp", () => {
  it("keeps a space between the asset tag and 'in' (secret-shopper QA finding)", () => {
    const s = photoAttachHelp("QA-CMMS-SS-214546");
    expect(s).toBe("Photos attach to asset QA-CMMS-SS-214546 in MIRA's knowledge base.");
    expect(s).toContain("214546 in MIRA");
    expect(s).not.toContain("214546in");
  });

  it("falls back to a generic phrase when no tag is selected", () => {
    expect(photoAttachHelp(null)).toBe("Photos attach to the selected asset in MIRA's knowledge base.");
    expect(photoAttachHelp("")).toBe("Photos attach to the selected asset in MIRA's knowledge base.");
    expect(photoAttachHelp("  ")).toBe("Photos attach to the selected asset in MIRA's knowledge base.");
  });
});
