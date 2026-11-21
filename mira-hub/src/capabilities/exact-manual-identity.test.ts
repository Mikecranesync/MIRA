import { describe, expect, it } from "vitest";

import { exactManualIdentity, isSafeCandidateSearchIdentity } from "./candidate-identity";

const REQUEST = "Find the manual for this equipment.";

describe("the exact public identifier in a LOOK observation", () => {
  it("keeps an exact model that LOOK formatted as Markdown beside ratings and a separate private field", () => {
    const photo = "**Brand:** AutomationDirect\n**Model:** **GS11N-20P2**\n**Input:** 110-120 VAC\n**Serial number:** SYNTH-00081";
    const request = "Find me the manual for this drive.";

    expect(exactManualIdentity(photo, request)).toEqual({ manufacturer: "AUTOMATIONDIRECT", model: "GS11N-20P2" });
    expect(isSafeCandidateSearchIdentity(photo, request, "GS11N-20P2", "AUTOMATIONDIRECT")).toBe(false);
  });

  it("blocks automatic search when Markdown splits the literal private label", () => {
    const photo = "**Brand:** AutomationDirect\n**Model:** GS11N-20P2\nSe**ri**al: 00091234";

    expect(exactManualIdentity(photo, REQUEST)).toEqual({ manufacturer: "AUTOMATIONDIRECT", model: "GS11N-20P2" });
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, "GS11N-20P2", "AUTOMATIONDIRECT")).toBe(false);
  });

  it("offers a labelled model without a pre-reviewed publication when there is no private field", () => {
    const photo = "**Brand:** Festo\n**Order number:** VUVG-LK10-M52-AT-G14-F";

    expect(exactManualIdentity(photo, REQUEST)).toEqual({ manufacturer: "FESTO", model: "VUVG-LK10-M52-AT-G14-F" });
  });

  it("requires a reviewed public identity when the photo contains a private field", () => {
    const photo = "**Brand:** Festo\n**Order number:** VUVG-LK10-M52-AT-G14-F\n**Serial number:** SYNTH-00081";

    expect(exactManualIdentity(photo, REQUEST)).toBeNull();
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, "VUVG-LK10-M52-AT-G14-F", "FESTO")).toBe(false);
  });

  it.each([
    "**Brand:** AutomationDirect\n**Model:** GS11N-20P2\n**Serial number:** GS11N-20P2",
    "**Brand:** AutomationDirect\n**Model:** GS11N-20P2\n**Serial number:** SYNTH-00081\n**Model:** GS11N-20P5",
    "**Brand:** Festo\n**Order number:** VUVG-LK10-M52-AT-G14-F\n**Model:** VUVG-LK10-M52-AT-G14-G",
    "**Brand:** Festo\n**Order number:** VUVG-LK10-M52-AT-G14-F\n**Asset tag:** VUVGLK10M52ATG14F",
  ])("keeps contradictory or private marked identities ineligible (%j)", (photo) => {
    expect(exactManualIdentity(photo, REQUEST)).toBeNull();
  });
});

describe("exact manual identity for a nameplate with private fields", () => {
  it.each([
    ["ABB", "ACS355", "S/N: TEST-ABB-001", "IP20"],
    ["ABB", "ACS355", "Serial No. TEST-ABB-001", "IP20"],
    ["ABB", "ACS355", "Serial No. ACS580", "IP20\n200-240V\n50/60Hz\n100kA\nIEC 61800-5-1\nUL 508\nNEMA 4X"],
    ["SCHNEIDER ELECTRIC", "CA3KN22BD", "S/N: TEST-SE-001", "24VDC"],
    ["SCHNEIDER ELECTRIC", "CA3KN22BD", "S/N: ACH580-01-07A3-4", "24VDC\nIEC60947-5-1\nCSA C22.2 No. 14"],
  ])("can offer %s %s with a distinct serial line (%j) and a trailing rating", (manufacturer, model, serial, rating) => {
    const photo = [manufacturer, model, serial, rating].join("\r\n");

    expect(exactManualIdentity(photo, REQUEST)).toEqual({ manufacturer, model });
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, model, manufacturer)).toBe(false);
  });

  it("ignores ratings and standards before the distinct serial", () => {
    const photo = "ABB\nACS355\n100kA\nIEC 61800-5-1\nNEMA 4X\nS/N: TEST-ABB-001";

    expect(exactManualIdentity(photo, REQUEST)).toEqual({ manufacturer: "ABB", model: "ACS355" });
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, "ACS355", "ABB")).toBe(false);
  });

  it.each([
    "S/N: ACS355\nIP20",
    "Serial No. ACS355\nIP20",
    "S/N: TEST-ABB-001\nIP20\nSerial: ACS 355",
    "S/N: TEST-ABB-001\nIP20\nAsset tag: ACS-355",
  ])("refuses a compact model repeated in a private field (%j)", (privateFields) => {
    const photo = `ABB\nACS355\n${privateFields}`;

    expect(exactManualIdentity(photo, REQUEST)).toBeNull();
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, "ACS355", "ABB")).toBe(false);
  });

  it.each([
    ["ABB", "ACS355", "ACS580\nS/N: TEST-ABB-001"],
    ["ABB", "ACS355", "S/N: TEST-ABB-001\nACS580"],
    ["ABB", "ACS355", "S/N: TEST-ABB-001\nACH580"],
    ["ABB", "ACS355", "S/N: 1234A\nACH580"],
    ["ABB", "ACS355", "S/N: TEST-ABB-001\nACH580-01-07A3-4"],
    ["ABB", "ACS355", "S/N: TEST-ABB-001\nACH580‑01‑07A3‑4"],
    ["ABB", "ACS355", "S/N: TEST-ABB-001\nIEC 61800-5-1 ACH580"],
    ["ABB", "ACS355", "S/N: TEST-ABB-001\nMODEL: ACH580"],
    ["ABB", "ACS355", "Serial No. TEST-ABB-001\nIP20\nACS580"],
    ["SCHNEIDER ELECTRIC", "CA3KN22BD", "S/N: TEST-SE-001\nACS580"],
  ])("refuses %s %s beside a second known model (%j)", (manufacturer, model, otherMarking) => {
    const photo = [manufacturer, model, otherMarking].join("\n");

    expect(exactManualIdentity(photo, REQUEST)).toBeNull();
    expect(isSafeCandidateSearchIdentity(photo, REQUEST, model, manufacturer)).toBe(false);
  });

  it.each(["Serial Number", "Serial Numero", "Serial Warranty"])(
    "requires a serial value on the line (%j)",
    (line) => {
      expect(exactManualIdentity(`ABB\nACS355\n${line}\nTEST-ABB-001\nIP20`, REQUEST)).toBeNull();
    },
  );

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
