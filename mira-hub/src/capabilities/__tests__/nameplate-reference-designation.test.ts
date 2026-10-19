// A plant reference designation (IEC 81346, e.g. `=EQU+96 -A57`) is never a
// manufacturer model / catalog / serial. Staging walk 2026-10-19: a
// Bihl+Wiedemann ASi gateway's panel tag came back as its catalog number and
// was sent to manual discovery (PR #4540; Codex F1: the rejection must reach
// the pre-filled candidate and the confirm identity, not only the evidence).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isReferenceDesignation, scrubReferenceDesignations, toFact } from "@/lib/nameplate/evidence";

const BIHL = { manufacturer: "Bihl+Wiedemann", model: undefined, catalogNumber: "=EQU+96 -A57", confidence: 0.95 };

describe("isReferenceDesignation", () => {
  it.each(["=EQU+96 -A57", "+CAB1-K3", "-A57", "-K1", " =A1"])("recognizes %s", (v) => {
    expect(isReferenceDesignation(v)).toBe(true);
  });
  it.each(["25B-D010N104", "6AV2124-0GC01-0AX0", "SS5Y3-DUW01302", "700-HA32Z24", "BWU2797", "3RV20", "-"])(
    "keeps the real identifier %s (control)",
    (v) => expect(isReferenceDesignation(v)).toBe(false),
  );
});

describe("toFact rejects a designation in an identity field", () => {
  it.each(["catalogNumber", "model", "serialNumber"] as const)("%s", (field) => {
    expect(toFact({ field, value: "=EQU+96 -A57", rawText: ["=EQU+96 -A57"] }).status).toBe("rejected");
  });
  it("keeps a real catalog number (control)", () => {
    expect(toFact({ field: "catalogNumber", value: "BWU2797", rawText: ["CAT NO. BWU2797"] }).status).not.toBe("rejected");
  });
  it("leaves a non-identity field alone", () => {
    expect(toFact({ field: "equipmentType", value: "-A57", rawText: ["-A57"] }).status).not.toBe("rejected");
  });
});

describe("scrubReferenceDesignations (the candidate a client pre-fills / the identity a confirm submits)", () => {
  it("drops the designation and keeps everything else", () => {
    expect(scrubReferenceDesignations(BIHL)).toEqual({ manufacturer: "Bihl+Wiedemann", model: undefined, confidence: 0.95 });
  });
  it("leaves a real identity untouched (control)", () => {
    const real = { manufacturer: "Allen-Bradley", model: "PowerFlex 525", catalogNumber: "25B-D010N104" };
    expect(scrubReferenceDesignations(real)).toEqual(real);
  });
  it("does not mutate its input", () => {
    const input = { ...BIHL };
    scrubReferenceDesignations(input);
    expect(input.catalogNumber).toBe("=EQU+96 -A57");
  });
});

// Wiring pins (source-level): both routes are DB-heavy with no route harness in
// this repo, so these assert the scrub sits on the two paths Codex F1 named —
// the recognize response's candidate and the confirm identity before discovery.
describe("route wiring", () => {
  const api = path.join(__dirname, "..", "..", "app", "api", "equipment-notebooks", "[id]", "nameplate");
  it("recognize returns the scrubbed candidate", () => {
    const src = readFileSync(path.join(api, "recognize", "route.ts"), "utf8");
    expect(src).toMatch(/candidate: scrubReferenceDesignations\(candidate\)/);
  });
  it("confirm scrubs the submitted identity before using it", () => {
    const src = readFileSync(path.join(api, "confirm", "route.ts"), "utf8");
    expect(src).toMatch(/const identity = scrubReferenceDesignations\(readIdentity\(body\.identity\)\);/);
  });
  it("confirm refuses a designation-valued visual correction before it is stored, and reports it (Codex F3)", () => {
    const src = readFileSync(path.join(api, "confirm", "route.ts"), "utf8");
    expect(src).toMatch(/const acceptedCorrections = submittedCorrections\.filter\(\(c\) => !isReferenceDesignation\(c\.value\)\);/);
    expect(src).toMatch(/corrections: acceptedCorrections,/);
    expect(src).not.toMatch(/corrections: submittedCorrections,/);
    expect(src).toMatch(/visualCorrectionRejected,/);
  });
});
