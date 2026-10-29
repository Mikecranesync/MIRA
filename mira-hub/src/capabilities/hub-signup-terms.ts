/**
 * Versioned registry of the consent wording shown on Hub signup (#4902,
 * owner decision 5).
 *
 * The signup page (src/app/signup/page.tsx) renders the sentence below right
 * under the "Create account" button. /api/auth/register records the CURRENT
 * entry's version + sha256 + server NOW() on every NEW password account
 * (hub_users.terms_version / terms_sha256 / terms_accepted_at, migration 109).
 *
 * Historical honesty:
 *   - Rows created before migration 109, and accounts created by any path
 *     that does not go through /api/auth/register (Google OAuth, magic-link,
 *     team invites), keep NULL in all three columns. NULL means "not
 *     recorded" — it is never back-filled with this or any other wording.
 *   - The page sends no version; the server attaches it. What makes the
 *     recorded version equal what the user saw is the drift test
 *     (src/capabilities/__tests__/hub-signup-terms.test.ts), which fails if the
 *     rendered sentence stops matching HUB_SIGNUP_TERMS_CURRENT.text.
 *
 * Changing the wording: never edit an existing entry. Add a new version,
 * point HUB_SIGNUP_TERMS_CURRENT at it, and update the page in the same PR.
 */

export interface HubSignupTermsVersion {
  /** Stable id written to hub_users.terms_version. */
  version: string;
  /** Exact rendered sentence (whitespace-collapsed, as a user reads it). */
  text: string;
  /** sha256 hex of `text` (UTF-8), written to hub_users.terms_sha256. */
  sha256: string;
  /** Commit where this wording first appeared on the signup page. */
  firstShownCommit: string;
}

export const HUB_SIGNUP_TERMS_V1: HubSignupTermsVersion = Object.freeze({
  version: "hub-signup-terms-v1",
  text: "By creating an account you agree to our Terms and Privacy Policy.",
  sha256: "d96565a2ceabab067df6e83493df836974c38fcd2c0f458656fc6127a3881dc8",
  firstShownCommit: "64e156c97",
});

export const HUB_SIGNUP_TERMS_CURRENT: HubSignupTermsVersion = HUB_SIGNUP_TERMS_V1;

/** The consent values the register route records for a new account. */
export function currentSignupTermsConsent(): { version: string; sha256: string } {
  return { version: HUB_SIGNUP_TERMS_CURRENT.version, sha256: HUB_SIGNUP_TERMS_CURRENT.sha256 };
}
