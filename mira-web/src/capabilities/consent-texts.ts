/**
 * Versioned pilot-consent wording (#4902).
 *
 * Each version names the exact words an applicant agreed to, and its sha256.
 * A published version is immutable: changing a word means a new version, never
 * an edit (consent-texts.test.ts pins every published hash). A request row
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

const V2_DRAFT =
  "I'm requesting a free 30-day FactoryLM pilot. There is no charge and no payment " +
  "details are collected. FactoryLM may email me about this request and the pilot. " +
  "My information is handled under the FactoryLM Privacy Policy at factorylm.com/privacy.";

export const CONSENT_TEXTS: Readonly<Record<string, ConsentText>> = Object.freeze({
  "pilot-consent-v1": {
    version: "pilot-consent-v1",
    status: "text_not_recorded",
    text: null,
    sha256: null,
    note:
      "Emitted by #4881 (3c4476c78) with no consent string in the repo; the form that " +
      "showed it was removed before merge. Records consent:true only (#4902).",
  },
  "pilot-consent-v2": {
    version: "pilot-consent-v2",
    status: "draft",
    text: V2_DRAFT,
    sha256: consentSha256(V2_DRAFT),
    note: "DRAFT pending owner approval (#4902). Not shown to anyone and not current.",
  },
});

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
