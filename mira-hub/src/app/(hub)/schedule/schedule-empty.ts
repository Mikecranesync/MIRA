// Pure helpers for the PM Schedule empty state (#1949). Kept JSX-free so the
// "is it empty / which CTAs / disable exports" logic is unit-testable under
// vitest's node environment (the page itself is a "use client" component).

/**
 * The schedule is "empty" only once the fetch has settled (`!loading`) AND no
 * PMs came back. While loading we are NOT empty — the header shows "loading…"
 * and we must not flash the empty card before /api/pm-schedules resolves.
 */
export function isScheduleEmpty(pms: { length: number }, loading: boolean): boolean {
  return !loading && pms.length === 0;
}

/**
 * Export controls (CSV / ICS) are disabled while there is nothing to export, so
 * we never hand the operator an empty file. Honest copy lives at
 * `EXPORT_EMPTY_HINT_KEY` (shown as the button tooltip when disabled).
 */
export function exportsDisabledWhenEmpty(pms: { length: number }): boolean {
  return pms.length === 0;
}

export const EXPORT_EMPTY_HINT_KEY = "exportEmptyHint";

/**
 * Call-to-action buttons for the empty state. Every href points at a route that
 * exists in the Hub today. "Create PM" from the issue is intentionally omitted —
 * there is no PM-create form/route yet, so a button for it would dead-end. The
 * issue asks for "CTAs where supported"; these three are supported.
 *
 * hrefs are basePath-relative (plain "/route"); Next.js adds the "/hub" basePath
 * at render time — do NOT hardcode "/hub" here.
 */
export type EmptyCta = {
  /** i18n key under the "schedule" namespace */
  labelKey: string;
  href: string;
  testid: string;
};

export const EMPTY_CTAS: ReadonlyArray<EmptyCta> = [
  { labelKey: "emptyUploadManual", href: "/documents", testid: "schedule-empty-cta-upload" },
  { labelKey: "emptyViewAssets", href: "/assets", testid: "schedule-empty-cta-assets" },
  { labelKey: "emptyExtractPms", href: "/knowledge/suggestions", testid: "schedule-empty-cta-extract" },
];
