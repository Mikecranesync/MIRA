import { describe, expect, it } from "vitest";

import {
  nameplateDocTitle,
  resolveCitationTitle,
} from "../citation-identity";

/**
 * Gate E-1 — a citation must name a document a technician can identify.
 *
 * Both observed strings below are CAPTURES, not reconstructions:
 *
 *   - the UUID label is the one photographed in the 2026-09-07 mobile teardown,
 *     rendered under the answer "Serial number 49849 is listed on the nameplate [1]";
 *   - the PDF label is verbatim from a real Pixel 9a run on 2026-09-08, which is
 *     the evidence that the upload path was never broken and only DERIVED
 *     documents needed a name chosen for them.
 */

const OBSERVED_UUID_LABEL = "nameplate-12ac8c22-018a-4104-a247-d81c37bdb292.txt";
const OBSERVED_PDF_LABEL = "22mvn67cah_Series_3_End_Trucks_Owners_Manual (2).pdf";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("nameplateDocTitle — the producer names derived docs for humans", () => {
  it("names the machine when the technician confirmed one", () => {
    expect(
      nameplateDocTitle({
        identity: { manufacturer: "Allen-Bradley", model: "PowerFlex 525" },
        notebookName: "Line 1 drive",
      }),
    ).toBe("Nameplate — Allen-Bradley PowerFlex 525.txt");
  });

  it("falls back to the catalog number when there is no model", () => {
    expect(
      nameplateDocTitle({
        identity: { manufacturer: "Siemens", model: null, catalogNumber: "6SL3210" },
        notebookName: "Line 1 drive",
      }),
    ).toBe("Nameplate — Siemens 6SL3210.txt");
  });

  it("falls back to the notebook rather than inventing a machine", () => {
    expect(
      nameplateDocTitle({ identity: {}, notebookName: "Conveyor 3 gearbox" }),
    ).toBe("Nameplate — Conveyor 3 gearbox.txt");
  });

  it("still names something when nothing is confirmed at all", () => {
    expect(nameplateDocTitle({ identity: {}, notebookName: "   " })).toBe("Nameplate.txt");
  });

  it("never emits a UUID on any branch", () => {
    const photoId = "12ac8c22-018a-4104-a247-d81c37bdb292";
    const all = [
      nameplateDocTitle({ identity: { manufacturer: "AB", model: "525" }, notebookName: photoId }),
      nameplateDocTitle({ identity: {}, notebookName: "Line 1" }),
      nameplateDocTitle({ identity: {}, notebookName: "" }),
    ];
    expect(all).toHaveLength(3); // control: an empty set would pass vacuously
    for (const t of all) expect(t, `"${t}" contains a UUID`).not.toMatch(UUID_RE);
  });

  it("is deterministic — a replayed confirmation reuses rather than mints", () => {
    const opts = {
      identity: { manufacturer: "Allen-Bradley", model: "PowerFlex 525" },
      notebookName: "Line 1 drive",
    };
    expect(nameplateDocTitle(opts)).toBe(nameplateDocTitle(opts));
  });
});

describe("resolveCitationTitle — the read path never shows a database key", () => {
  it("passes a real uploaded filename through untouched", () => {
    // The upload path was never broken. Rewriting it would be the regression.
    expect(resolveCitationTitle(OBSERVED_PDF_LABEL)).toEqual({
      title: OBSERVED_PDF_LABEL,
      reason: "stored",
    });
  });

  it("refuses to render the observed UUID label", () => {
    const got = resolveCitationTitle(OBSERVED_UUID_LABEL);
    expect(got.title).toBe("Nameplate");
    expect(got.title).not.toMatch(UUID_RE);
    expect(got.reason).toBe("generated_key");
  });

  it("distinguishes a missing title from a generated one", () => {
    // The whole point of returning a reason. A floor that rewrote both to the
    // same string would collapse "the lookup broke" and "this document has no
    // name" into one outcome, and the surface could no longer tell a working
    // lookup from a dead one.
    expect(resolveCitationTitle("").reason).toBe("missing");
    expect(resolveCitationTitle(null).reason).toBe("missing");
    expect(resolveCitationTitle(OBSERVED_UUID_LABEL).reason).toBe("generated_key");
    expect(resolveCitationTitle(OBSERVED_PDF_LABEL).reason).toBe("stored");
  });

  it("never invents a machine name the stored title did not contain", () => {
    // A bare key has no human prefix to keep, so it degrades to the generic
    // label rather than guessing what the document was about.
    const got = resolveCitationTitle("12ac8c22-018a-4104-a247-d81c37bdb292");
    expect(got.title).toBe("Attached document");
    expect(got.reason).toBe("generated_key");
  });

  it("keeps whatever human prefix a generated name carries", () => {
    expect(resolveCitationTitle("wiring-12ac8c22-018a-4104-a247-d81c37bdb292.txt").title).toBe(
      "Wiring",
    );
  });
});
