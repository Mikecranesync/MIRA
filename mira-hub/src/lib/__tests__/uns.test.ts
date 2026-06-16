import { describe, it, expect } from "vitest";
import { slugify, sitePath, linePath, equipmentPath, manufacturerPath, modelPath } from "../uns";

describe("uns", () => {
  describe("slugify", () => {
    it("returns null for empty string", () => {
      expect(slugify("")).toBeNull();
    });

    it("returns null for non-alphanumeric chars only", () => {
      expect(slugify("!!!")).toBeNull();
      expect(slugify("   ")).toBeNull();
    });

    it("converts to lowercase", () => {
      expect(slugify("PowerFlex")).toBe("powerflex");
    });

    it("collapses non-alphanumeric runs", () => {
      expect(slugify("Power Flex 525")).toBe("power_flex_525");
    });

    it("strips leading and trailing underscores", () => {
      expect(slugify("_PowerFlex_")).toBe("powerflex");
    });

    it("handles real-world examples", () => {
      expect(slugify("Rockwell Automation")).toBe("rockwell_automation");
    });
  });

  describe("sitePath", () => {
    it("returns null for empty site name", () => {
      expect(sitePath("")).toBeNull();
    });

    it("returns null for non-alphanumeric site name", () => {
      expect(sitePath("!!!")).toBeNull();
    });

    it("builds valid site path", () => {
      expect(sitePath("Detroit Plant")).toBe("enterprise.detroit_plant");
    });
  });

  describe("linePath", () => {
    it("returns null for empty site", () => {
      expect(linePath("", "Assembly")).toBeNull();
    });

    it("returns null for empty line", () => {
      expect(linePath("Detroit Plant", "")).toBeNull();
    });

    it("returns null for non-alphanumeric site", () => {
      expect(linePath("!!!", "Line 1")).toBeNull();
    });

    it("returns null for non-alphanumeric line", () => {
      expect(linePath("Detroit Plant", "!!!")).toBeNull();
    });

    it("builds valid line path", () => {
      expect(linePath("Detroit Plant", "Assembly Line 1")).toBe(
        "enterprise.detroit_plant.assembly_line_1"
      );
    });
  });

  describe("equipmentPath", () => {
    it("returns null when parentPath is null", () => {
      expect(equipmentPath(null, "Motor123")).toBeNull();
    });

    it("returns null when eqIdentifier is null", () => {
      expect(equipmentPath("enterprise.detroit_plant.line_1", null)).toBeNull();
    });

    it("returns null when eqIdentifier is non-alphanumeric", () => {
      expect(equipmentPath("enterprise.detroit_plant.line_1", "!!!")).toBeNull();
    });

    it("builds valid equipment path", () => {
      expect(equipmentPath("enterprise.detroit_plant.line_1", "Motor-123")).toBe(
        "enterprise.detroit_plant.line_1.motor_123"
      );
    });
  });

  describe("manufacturerPath", () => {
    it("returns null for empty manufacturer", () => {
      expect(manufacturerPath("")).toBeNull();
    });

    it("returns null for non-alphanumeric manufacturer", () => {
      expect(manufacturerPath("!!!")).toBeNull();
    });

    it("builds valid manufacturer path", () => {
      expect(manufacturerPath("Rockwell Automation")).toBe(
        "enterprise.knowledge_base.rockwell_automation"
      );
    });
  });

  describe("modelPath", () => {
    it("returns null for empty manufacturer", () => {
      expect(modelPath("", "525")).toBeNull();
    });

    it("returns null for empty model", () => {
      expect(modelPath("Rockwell Automation", "")).toBeNull();
    });

    it("returns null for non-alphanumeric manufacturer", () => {
      expect(modelPath("!!!", "525")).toBeNull();
    });

    it("returns null for non-alphanumeric model", () => {
      expect(modelPath("Rockwell Automation", "!!!")).toBeNull();
    });

    it("builds valid model path", () => {
      expect(modelPath("Rockwell Automation", "PowerFlex 525")).toBe(
        "enterprise.knowledge_base.rockwell_automation.powerflex_525"
      );
    });
  });
});
