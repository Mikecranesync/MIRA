/**
 * Technician-facing manual-search status copy (#4160). Lives in its own module
 * so tests that mock the acquisition pipelines with explicit export lists keep
 * the real sentences — this file has no I/O and is never mocked.
 */

/** Owner-approved (#4160 S7 decision 2026-10-01 §1), verbatim. Never a reset
 *  time and never a retry promise: the denial may be the daily or the monthly
 *  cap, and a retry only happens on a later chat turn. */
export const MANUAL_SEARCH_LIMIT_COPY =
  "Manual-search limit reached — try again later, or upload the manual yourself.";

/** #4160 gate NO-GO: the outage counterpart, mirroring the limit copy (owner
 *  decision 2026-10-01). An outage is never "no manual exists". */
export const MANUAL_SEARCH_UNAVAILABLE_COPY =
  "Manual search is unavailable right now — try again later, or upload the manual yourself.";
