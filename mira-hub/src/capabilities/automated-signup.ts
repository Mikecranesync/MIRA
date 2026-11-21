/** Reserved, run-unique identities emitted by provision-beta-gate.ts and
 * tests/stranger-walk/walk.spec.ts. This controls outbound effects and cohort
 * admission, never authentication or approval bypass. Do not use the broad
 * display-only isSystemAccount heuristics here: names and "test" substrings
 * can belong to real applicants. No request flag/header can opt out.
 */
export function isAutomatedSignup(email: string): boolean {
  return /^(?:betagate-[0-9]+|strangerwalk-[a-z0-9-]+)@factorylm\.com$/.test(email.trim().toLowerCase());
}
