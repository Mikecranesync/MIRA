/**
 * #4902: published consent wording is immutable and every version is honest
 * about what it records.
 */
import { describe, test, expect } from "bun:test";
import {
  CONSENT_TEXTS,
  CURRENT_PILOT_CONSENT_VERSION,
  consentSha256,
  consentText,
} from "./consent-texts";

// Pinned hashes of every PUBLISHED version. Adding a published version adds a
// row here; never update a row. These pins live in the candidate tree, so a
// commit can edit text and pin together: the authority is the CI gate that
// compares against the PR base (scripts/check-consent-immutability.ts, #4934).
const PINNED_PUBLISHED: Record<string, string> = {};

describe("consent text registry", () => {
  test("every version with text carries the sha256 of that exact text", () => {
    for (const v of Object.values(CONSENT_TEXTS)) {
      if (v.text === null) expect(v.sha256).toBeNull();
      else expect(v.sha256).toBe(consentSha256(v.text));
    }
  });

  test("published versions match their pinned hash, and every pin is still published", () => {
    const published = Object.values(CONSENT_TEXTS).filter((v) => v.status === "published");
    for (const v of published) expect(PINNED_PUBLISHED[v.version]).toBe(v.sha256!);
    for (const [version, sha] of Object.entries(PINNED_PUBLISHED)) {
      expect(CONSENT_TEXTS[version]?.status).toBe("published");
      expect(CONSENT_TEXTS[version]?.sha256).toBe(sha);
    }
  });

  test("v1 records no wording: nothing may be attached to it after the fact", () => {
    const v1 = consentText("pilot-consent-v1")!;
    expect(v1.status).toBe("text_not_recorded");
    expect(v1.text).toBeNull();
    expect(v1.sha256).toBeNull();
  });

  test("the current version is never a draft", () => {
    const current = consentText(CURRENT_PILOT_CONSENT_VERSION);
    expect(current).toBeDefined();
    expect(current!.status).not.toBe("draft");
  });

  test("published and draft versions have text; unrecorded ones do not", () => {
    for (const v of Object.values(CONSENT_TEXTS)) {
      if (v.status === "text_not_recorded") expect(v.text).toBeNull();
      else expect(typeof v.text === "string" && v.text.length > 20).toBe(true);
    }
  });

  test("unknown and prototype keys are not versions", () => {
    expect(consentText("pilot-consent-v9")).toBeUndefined();
    expect(consentText("toString")).toBeUndefined();
  });
});
