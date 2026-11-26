/**
 * Permanent (301) slug moves for /blog/:slug. Old slugs must not keep
 * serving the retired title or body; the destination is the current page.
 */
export const BLOG_PERMANENT_REDIRECTS: Record<string, string> = {
  "siemens-f30011-heatsink-overtemp": "siemens-g120c-f30011-line-phase-failure",
};

/** Absolute path to redirect to, or null if the slug is current. */
export function blogRedirectPath(slug: string): string | null {
  const dest = BLOG_PERMANENT_REDIRECTS[slug];
  return dest ? `/blog/${dest}` : null;
}
