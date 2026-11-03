/**
 * applicability.test.ts — Work Packet V2: does a manual line apply to THIS pump?
 *
 * Invented models only (85xx). A line that names only other models is left out; a line that names
 * this model and others is shown with a "read your part" note; a model, date, serial, revision,
 * style or application restriction the documents cannot settle is never guessed.
 */
import { describe, expect, it } from "vitest";
import { captionApplicability, scopedApplicability, textApplicability } from "../applicability";

const COVERED = ["8520", "8521", "8527", "8531", "8535", "8537", "8541", "8545", "8560"];
const kind = (text: string, model = "8520") => textApplicability(text, model, COVERED).kind;

describe("model names in a note or step", () => {
  it("a line naming no model applies (it inherits its section)", () => {
    expect(kind("Hold the head level so the Plungers are not scratched.")).toBe("applies");
  });
  it("a line naming only other models does not apply", () => {
    expect(kind("The 8545, 8541 do not have Guide Rings.")).toBe("other_models");
    expect(kind("On Model 8545, 8541 slide the Lip Spacer onto each plunger.")).toBe("other_models");
  });
  it("control: the same line applies to a pump it names", () => {
    expect(kind("The 8545, 8541 do not have Guide Rings.", "8541")).toBe("applies");
  });
  it("one model list that includes this pump applies", () => {
    expect(kind("Pull out the Guide Cylinder (8520, 8521, 8527) with two screwdrivers.")).toBe("applies");
    expect(kind("Pull out the Guide Cylinder (8520, 8521, 8527) with two screwdrivers.", "8531")).toBe("other_models");
  });
  it("two model groups, this pump in one, is mixed", () => {
    expect(kind("Press the Guide Cylinder (8520, 8521, 8527) or the head bore (8531, 8535, 8537) fully into place.")).toBe("mixed");
    expect(kind("Models 8531, 8535 use a Spacer. Models 8520, 8521, 8527 use a Washer and an Inlet Adapter.")).toBe("mixed");
  });
  it("'except' lists exclude only the models they name", () => {
    expect(kind("Remove the Spacer Spring (except 8560).")).toBe("applies");
    expect(kind("Remove the Spacer Spring (except 8560).", "8560")).toBe("other_models");
    expect(kind("All models except 8520, 8521 use the long screw.")).toBe("other_models");
  });
  it("a suffixed model is a different model, never a prefix match", () => {
    expect(textApplicability("The 8520C has a flushed head.", "8520", [...COVERED, "8520C"]).kind).toBe("other_models");
    expect(textApplicability("The 8520 has a plain head.", "8520C", [...COVERED, "8520C"]).kind).toBe("other_models");
  });
});

describe("restrictions the documents cannot settle are never guessed", () => {
  for (const text of [
    "See Tech Bulletin 902 for early style pumps; the spring and the head must both be changed.",
    "See Tech Bulletin 950 when servicing old style pumps.",
    "For some installations apply sealant to the ring grooves. See Tech Bulletin 901 to identify the model.",
    "For certain applications use the long screw.",
    "Pumps built before 2019 use the short spring.",
    "Pre-2019 builds use the short spring.",
    "Prior to 2021 the head was cast iron.",
    "2020 and later pumps use a two-piece retainer.",
    "Serial number 120045 and later use the new seal.",
    "Rev C and later heads have a groove.",
    "Before Rev D the spring was shorter.",
  ]) {
    it(`unresolved: "${text}"`, () => {
      const a = textApplicability(text, "8520", COVERED);
      expect(a.kind).toBe("unresolved");
      if (a.kind === "unresolved") expect(text).toContain(a.phrase);
    });
  }
  it("control: a part number or bulletin number alone is not a restriction", () => {
    expect(kind("Apply anti-seize (PN 6119) to the threads. See Tech Bulletin 053.")).toBe("applies");
    expect(kind("Torque per chart in a cross pattern.")).toBe("applies");
  });
  it("a restriction outranks a model match: naming this pump does not settle a date cut-off", () => {
    expect(kind("8520 pumps built before 2019 use the short spring.")).toBe("unresolved");
  });
});

describe("section scope comes first", () => {
  it("a note with no model name inside an other-model block does not apply", () => {
    const a = scopedApplicability("Fit the Lip Spacer on the plunger, not in the head bore.", { include: ["8541", "8545"], exclude: [] }, "8520", COVERED);
    expect(a.kind).toBe("other_models");
  });
  it("an unresolved block is unresolved", () => {
    expect(scopedApplicability("Lubricate each bore.", { include: [], exclude: [], unresolved: true }, "8520", COVERED).kind).toBe("unresolved");
  });
  it("control: inside this pump's block the note applies", () => {
    expect(scopedApplicability("Fit the Lip Spacer on the plunger.", { include: ["8541", "8545"], exclude: [] }, "8541", COVERED).kind).toBe("applies");
  });
});

describe("figure captions", () => {
  it("a caption for other models is left out; this pump's caption is kept", () => {
    expect(captionApplicability(["8531, 8535, 8537, 8541, 8545", "Spacer and Guide Ring Layout"], "8520", COVERED).kind).toBe("other_models");
    expect(captionApplicability(["8520, 8521, 8527", "Guide Cylinder and Seal Layout"], "8520", COVERED).kind).toBe("applies");
    expect(captionApplicability(["All models except 8560", "Removal of Valve Cap"], "8520", COVERED).kind).toBe("applies");
    expect(captionApplicability(["All models except 8560", "Removal of Valve Cap"], "8560", COVERED).kind).toBe("other_models");
  });
  it("a caption naming a model the manual does not cover is unresolved, not dropped as 'other'", () => {
    expect(captionApplicability(["8650", "Lip Seal Layout"], "8520", COVERED).kind).toBe("unresolved");
  });
  it("a caption with no model line applies", () => {
    expect(captionApplicability(["Plunger Layout"], "8520", COVERED).kind).toBe("applies");
  });
});
