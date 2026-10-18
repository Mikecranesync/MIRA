/**
 * Action library tests.
 * Validates the 13 shipped actions and their properties.
 */

import { describe, it, expect } from "bun:test";
import { LIBRARY } from "../diagnostic-plan/library";
import { validateLibrary } from "../diagnostic-plan/validate";

describe("Action Library", () => {
  it("should have exactly 13 actions", () => {
    expect(LIBRARY).toHaveLength(13);
  });

  it("should have unique IDs", () => {
    const result = validateLibrary(LIBRARY);
    expect(result.ok).toBe(true);
  });

  describe("Identify actions", () => {
    const identifyActions = LIBRARY.filter((a) => a.group === "identify");

    it("should have 4 identify actions", () => {
      expect(identifyActions).toHaveLength(4);
    });

    it("should have IDENTIFY_ASSET", () => {
      const action = LIBRARY.find((a) => a.id === "IDENTIFY_ASSET");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("mira");
      expect(action?.verification).toBe("machine");
    });

    it("should have READ_FAULT", () => {
      const action = LIBRARY.find((a) => a.id === "READ_FAULT");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("mira");
      expect(action?.verification).toBe("machine");
    });

    it("should have OBSERVE_STATE", () => {
      const action = LIBRARY.find((a) => a.id === "OBSERVE_STATE");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("technician");
      expect(action?.verification).toBe("self_reported");
      expect(action?.requiresReport).toBe(true);
    });

    it("should have REVIEW_HISTORY", () => {
      const action = LIBRARY.find((a) => a.id === "REVIEW_HISTORY");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("mira");
      expect(action?.verification).toBe("machine");
    });
  });

  describe("Safety actions", () => {
    const safetyActions = LIBRARY.filter((a) => a.group === "safety");

    it("should have 2 safety actions", () => {
      expect(safetyActions).toHaveLength(2);
    });

    it("should have ASSESS_HAZARDS with safetyWording", () => {
      const action = LIBRARY.find((a) => a.id === "ASSESS_HAZARDS");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("technician");
      expect(action?.verification).toBe("self_reported");
      expect(action?.safetyWording).toBe("PENDING_R3");
      expect(action?.requiresReport).toBe(true);
    });

    it("should have CONFIRM_ISOLATION with attestation", () => {
      const action = LIBRARY.find((a) => a.id === "CONFIRM_ISOLATION");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("technician");
      expect(action?.verification).toBe("attested");
      expect(action?.attestation).toBe("named_person");
      expect(action?.safetyWording).toBe("PENDING_R3");
    });
  });

  describe("Measure actions", () => {
    const measureActions = LIBRARY.filter((a) => a.group === "measure");

    it("should have 3 measure actions", () => {
      expect(measureActions).toHaveLength(3);
    });

    it("should have READ_PLC_TAG", () => {
      const action = LIBRARY.find((a) => a.id === "READ_PLC_TAG");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("mira");
      expect(action?.verification).toBe("machine");
    });

    it("should have READ_DRIVE_PARAMETER", () => {
      const action = LIBRARY.find((a) => a.id === "READ_DRIVE_PARAMETER");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("mira");
      expect(action?.verification).toBe("machine");
    });

    it("should have MEASURE", () => {
      const action = LIBRARY.find((a) => a.id === "MEASURE");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("technician");
      expect(action?.verification).toBe("self_reported");
      expect(action?.requiresReport).toBe(true);
    });
  });

  describe("Diagnose actions", () => {
    const diagnoseActions = LIBRARY.filter((a) => a.group === "diagnose");

    it("should have 2 diagnose actions", () => {
      expect(diagnoseActions).toHaveLength(2);
    });

    it("should have COMPARE_TO_SPEC", () => {
      const action = LIBRARY.find((a) => a.id === "COMPARE_TO_SPEC");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("mira");
      expect(action?.verification).toBe("machine");
    });

    it("should have SELECT_NEXT_TEST", () => {
      const action = LIBRARY.find((a) => a.id === "SELECT_NEXT_TEST");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("mira");
      expect(action?.verification).toBe("machine");
    });
  });

  describe("Record actions", () => {
    const recordActions = LIBRARY.filter((a) => a.group === "record");

    it("should have 2 record actions", () => {
      expect(recordActions).toHaveLength(2);
    });

    it("should have RECORD_FINDING", () => {
      const action = LIBRARY.find((a) => a.id === "RECORD_FINDING");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("technician");
      expect(action?.verification).toBe("self_reported");
      expect(action?.requiresReport).toBe(true);
    });

    it("should have ESCALATE", () => {
      const action = LIBRARY.find((a) => a.id === "ESCALATE");
      expect(action).toBeDefined();
      expect(action?.executor).toBe("technician");
      expect(action?.verification).toBe("self_reported");
      expect(action?.requiresReport).toBe(true);
    });
  });

  it("all actions should have defined inputs and outputs", () => {
    for (const action of LIBRARY) {
      expect(typeof action.inputs).toBe("object");
      expect(typeof action.outputs).toBe("object");
    }
  });

  it("all technician actions should have requiresReport", () => {
    for (const action of LIBRARY) {
      if (action.executor === "technician") {
        expect(action.requiresReport).toBe(true);
      }
    }
  });

  it("mira actions should have machine verification", () => {
    for (const action of LIBRARY) {
      if (action.executor === "mira") {
        expect(action.verification).toBe("machine");
      }
    }
  });
});
