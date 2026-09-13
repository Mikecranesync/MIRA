/**
 * Dependency licence policy for the shared UI workspace (PRD §4: MIT or
 * Apache-2.0 only), plus the maintainer-approved exceptions.
 *
 * An exception is NOT a widening of the allowlist. It names one package at one
 * resolved version under one licence, and it carries the decision that granted
 * it. A version bump, a licence change, or a new package with the same licence
 * fails the audit again and needs a fresh maintainer decision — exactly the
 * scope the approving comment set.
 */

export const ALLOWED_LICENSES: ReadonlySet<string> = new Set(["MIT", "Apache-2.0"]);

export interface ApprovedException {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  /** Who decided, and where the decision is recorded (durable, GitHub). */
  readonly approvedBy: string;
  readonly decision: string;
  /** Why the package is in the tree at all. */
  readonly via: string;
}

/**
 * Maintainer decision, PR #3731, 2026-09-09 21:29Z (Mikecranesync): the two
 * assistant-ui transitive dependencies below are approved "limited to the
 * packages, licenses, and resolved versions present at this PR head", with the
 * requirement that their copyright and licence notices are preserved in the
 * generated third-party notices (THIRD_PARTY_NOTICES.md).
 */
export const APPROVED_EXCEPTIONS: readonly ApprovedException[] = [
  {
    name: "secure-json-parse",
    version: "4.1.0",
    license: "BSD-3-Clause",
    approvedBy: "Mikecranesync",
    decision: "https://github.com/Mikecranesync/MIRA/pull/3731 (maintainer decision comment, 2026-09-09)",
    via: "@assistant-ui/react@0.15.17 → assistant-stream",
  },
  {
    name: "tslib",
    version: "2.8.1",
    license: "0BSD",
    approvedBy: "Mikecranesync",
    decision: "https://github.com/Mikecranesync/MIRA/pull/3731 (maintainer decision comment, 2026-09-09)",
    via: "@assistant-ui/react@0.15.17 → radix-ui / assistant-stream",
  },
];

export type LicenseVerdict =
  | { readonly ok: true; readonly reason: "allowed" | "approved-exception"; readonly exception?: ApprovedException }
  | { readonly ok: false; readonly reason: "missing" | "not-allowed" };

export function findException(name: string, version: string): ApprovedException | undefined {
  return APPROVED_EXCEPTIONS.find((exception) => exception.name === name && exception.version === version);
}

/** The ONE decision the audit makes per package. Pure; no I/O. */
export function licenseVerdict(name: string, version: string, license: string | undefined): LicenseVerdict {
  if (!license) return { ok: false, reason: "missing" };
  if (ALLOWED_LICENSES.has(license)) return { ok: true, reason: "allowed" };
  const exception = findException(name, version);
  // The licence must match the approved one too: a package that changes licence
  // at the same version (it happens) is a new decision, not the old one.
  if (exception && exception.license === license) return { ok: true, reason: "approved-exception", exception };
  return { ok: false, reason: "not-allowed" };
}

/** Whitespace-insensitive containment, so a re-wrapped notice still counts. */
export function normalizeNoticeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
