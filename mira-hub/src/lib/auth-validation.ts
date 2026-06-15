// Client-side auth validation (#1957).
//
// The login / signup forms set `noValidate` on their <form> so the browser
// never raises native constraint-validation popups (e.g. "Please include an
// '@' in the email address"). Those popups are inconsistent across mobile /
// shop-floor devices and hard to read. We re-implement the checks here so the
// forms can show short, app-styled inline errors under the relevant field.
//
// The email regex intentionally mirrors what `type="email"` accepts — a single
// "@" with non-empty local part, domain, and TLD — so dropping native
// validation doesn't change which addresses are accepted.

export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Inline error for an email field, or null when valid. */
export function emailError(value: string): string | null {
  if (!value.trim()) return "Enter your work email.";
  if (!isValidEmail(value)) return "Enter a valid work email.";
  return null;
}

/** Inline error for a password field, or null when valid. */
export function passwordError(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
