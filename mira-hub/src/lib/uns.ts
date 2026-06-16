/**
 * Shared UNS (Unified Namespace) path helpers.
 *
 * Spec: docs/specs/uns-kg-unification-spec.md
 * Slug rule mirrors the SQL `uns_slug()` defined in
 * mira-hub/db/migrations/014_uns_path_backfill.sql so paths computed in
 * TypeScript and SQL match byte-for-byte.
 *
 * Path grammar (wizard / hub style — compact, no ISA-95 type markers):
 *   enterprise.<site>[.<area>].<line>.<asset>...
 *   enterprise.knowledge_base.<manufacturer>[.<model>]
 *
 * Older `cmms_equipment.uns_path` rows use the ISA-95 marker grammar
 * (enterprise.<tenant>.site.<s>.area.<a>.line.<l>.equipment.<e>); this
 * module deliberately does NOT emit that style — see ADR / spec for why
 * the hub-side projection uses the compact form.
 */

/**
 * Lowercase, collapse any run of non-alphanumeric chars to `_`, strip
 * leading/trailing `_`, cap at 64 chars, return null for empty input.
 *
 * Matches:
 *   - SQL `uns_slug()` in migration 014 (returns NULL for empty)
 *   - the wizard helper that previously lived inline in
 *     `mira-hub/src/app/api/wizard/[step]/route.ts`
 */
export function slugify(value: string): string | null {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return result.length > 0 ? result : null;
}

/** Compact UNS path for a site. */
export function sitePath(site: string): string | null {
  const slug = slugify(site);
  return slug ? `enterprise.${slug}` : null;
}

/** Compact UNS path for a line under a site. */
export function linePath(site: string, line: string): string | null {
  const sPath = sitePath(site);
  const lSlug = slugify(line);
  return sPath && lSlug ? `${sPath}.${lSlug}` : null;
}

/**
 * Compact UNS path for an equipment row.
 *
 * `parentPath` is whichever wizard-side path already exists for the tenant
 * (typically the line path; sometimes only a site path if the wizard didn't
 * advance past site). When non-null this is the SOURCE OF TRUTH and we just
 * append the equipment slug.
 *
 * Returns `null` when both `parentPath` and `eqIdentifier` are absent — the
 * caller decides whether to skip the row or leave uns_path unset.
 */
export function equipmentPath(
  parentPath: string | null,
  eqIdentifier: string | null
): string | null {
  const slug = eqIdentifier ? slugify(eqIdentifier) : null;
  if (!slug) return null;
  if (!parentPath) return null;
  return `${parentPath}.${slug}`;
}

/** Knowledge-base UNS path for a manufacturer node. */
export function manufacturerPath(manufacturer: string): string | null {
  const slug = slugify(manufacturer);
  return slug ? `enterprise.knowledge_base.${slug}` : null;
}

/** Knowledge-base UNS path for a model under a manufacturer. */
export function modelPath(manufacturer: string, model: string): string | null {
  const mPath = manufacturerPath(manufacturer);
  const mSlug = slugify(model);
  return mPath && mSlug ? `${mPath}.${mSlug}` : null;
}
