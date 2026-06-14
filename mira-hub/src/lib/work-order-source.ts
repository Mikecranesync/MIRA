// Human-friendly display label for a work order's `source`.
//
// `source` is an internal slug (e.g. `hub_ui`, `telegram_text`, `slack_text`).
// It must NEVER leak to a maintenance-facing surface as the raw value — the
// secret-shopper QA pass found a detail page showing "hub_ui" in the Type
// field. This is the single point that maps a source slug to a label; both
// work-order API routes import it.
export function workOrderSourceLabel(source: string | null | undefined, isAutoPM: boolean): string {
  if (isAutoPM) return "Auto-PM";

  const known: Record<string, string> = {
    telegram_text: "Telegram",
    slack_text: "Slack",
    hub_ui: "Manual",
    web: "Manual",
  };
  const slug = (source ?? "").trim();
  if (!slug) return "Manual";
  if (known[slug]) return known[slug];

  // Unmapped slug: humanize so a raw `snake_case` internal value never reaches
  // the UI (e.g. "kiosk_qr" -> "Kiosk Qr"), rather than exposing the slug.
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
