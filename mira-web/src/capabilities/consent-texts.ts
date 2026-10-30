/**
 * Versioned pilot-consent wording (#4902).
 *
 * Each version names the exact words an applicant agreed to, and its sha256.
 * A published version is immutable: changing a word means a new version, never
 * an edit. CI enforces this against the PR base commit
 * (mira-web/scripts/check-consent-immutability.mjs, #4934), not against a pin the
 * same commit could edit; the test-local pins are a second, weaker check. A request row
 * stores the version and the sha256 of the text, so what an applicant agreed to
 * can be checked later.
 *
 * Historical honesty: pilot-consent-v1 was emitted by #4881 (3c4476c78) with
 * no consent string anywhere in the repo, because the /pilot form that showed
 * the wording was removed before that PR merged. Rows stamped v1 prove the
 * submitter sent `consent: true`; they do NOT prove which words were shown, and
 * no wording may be attached to them after the fact.
 */
import { createHash } from "node:crypto";
import registryJson from "./consent-texts.json";

export type ConsentTextStatus = "published" | "draft" | "text_not_recorded";

export interface ConsentText {
  version: string;
  status: ConsentTextStatus;
  /** Exact wording shown to the applicant; null when it was never recorded. */
  text: string | null;
  /** sha256 (hex) of `text`; null when `text` is null. */
  sha256: string | null;
  note: string;
}

export function consentSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// The wording lives in consent-texts.json, never in code: the CI gate
// (scripts/check-consent-immutability.mjs) parses that file as plain data at the
// PR base and at the candidate, so no candidate code runs while it decides.
function deepFreeze<T>(o: T): T {
  for (const v of Object.values(o as object)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

export const CONSENT_TEXTS: Readonly<Record<string, Readonly<ConsentText>>> = deepFreeze(
  registryJson as unknown as Record<string, ConsentText>,
);

/**
 * The version a new pilot request is recorded under. Switch it to a version
 * only once that version is `published` (the owner approved the wording and the
 * form renders it from CONSENT_TEXTS); the test fails on a draft.
 */
export const CURRENT_PILOT_CONSENT_VERSION = "pilot-consent-v1";

export function consentText(version: string): ConsentText | undefined {
  return Object.prototype.hasOwnProperty.call(CONSENT_TEXTS, version)
    ? CONSENT_TEXTS[version]
    : undefined;
}
