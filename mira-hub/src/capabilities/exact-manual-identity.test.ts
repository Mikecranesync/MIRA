import { describe, expect, it } from "vitest";

import { exactManualIdentity, isSafeCandidateSearchIdentity } from "./candidate-identity";

const REQUEST = "Find the manual for this equipment.";

describe("exact manual identity for a nameplate with private fields", () => {
  it.each([
    ["ABB", "ACS355", "TEST-ABB-001", "IP20"],
    ["SCHNEIDER ELECTRIC", "CA3KN22BD", "TEST-SE-001", "24VDC"],
  ])("can offer the %s model with a rating after a distinct serial", (manufacturer, model, serial, rating) => {
    const photo = [manufacturer, model, `S/N: ${serial}`, rating].join("\r\n");

    expect(exactManualIdentity(photo, REQUEST)).toEqual({ manufacturer, model });
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, model, manufacturer)).toBe(false);
  });

  it.each([
    "S/N: ACS355\nIP20",
    "S/N: TEST-ABB-001\nIP20\nSerial: ACS 355",
    "S/N: TEST-ABB-001\nIP20\nAsset tag: ACS-355",
  ])("refuses a compact model repeated in a private field (%j)", (privateFields) => {
    const photo = `ABB\nACS355\n${privateFields}`;

    expect(exactManualIdentity(photo, REQUEST)).toBeNull();
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, "ACS355", "ABB")).toBe(false);
  });

  it.each(["GS10", "GS11N", "GS10\nGS11N"])("can offer one exact reviewed model beside its compatible family (%j)", (family) => {
    const photo = `AutomationDirect\n${family}\nMODEL: GS11N-20P2\nS/N: TEST-AD-001`;

    expect(exactManualIdentity(photo, REQUEST)).toEqual({ manufacturer: "AUTOMATIONDIRECT", model: "GS11N-20P2" });
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, "GS11N-20P2", "AUTOMATIONDIRECT")).toBe(false);
  });

  it.each([
    "GS21",
    "GS10\nGS21",
    "GS10\nGS11N-20P5",
    "GS10\nMODEL: GS11N-20P5",
  ])("refuses an incompatible series or a competing exact model (%j)", (otherMarking) => {
    const photo = `AutomationDirect\n${otherMarking}\nMODEL: GS11N-20P2\nS/N: TEST-AD-001`;

    expect(exactManualIdentity(photo, REQUEST)).toBeNull();
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, "GS11N-20P2", "AUTOMATIONDIRECT")).toBe(false);
  });

  it.each(["GS21", "GS11N-20P5"])("refuses a competing model marking after the serial (%j)", (otherMarking) => {
    const photo = `AutomationDirect\nGS10\nMODEL: GS11N-20P2\nS/N: TEST-AD-001\n${otherMarking}`;

    expect(exactManualIdentity(photo, REQUEST)).toBeNull();
  });
});
