// CMMS provider abstraction. Each concrete provider knows how to build
// deep-link URLs for its CMMS. Sync (push to the external system) is an
// optional method on the same interface — only Atlas implements it today.
//
// Spec: docs/specs/cmms-deep-link-multi-provider-spec.md §4.2

export type CMMSProviderSlug = "atlas" | "maximo" | "fiix" | "maintainx" | "upkeep";

export type DeepLinkKind = "work_order" | "asset" | "pm";

export type LinkTemplates = Partial<Record<DeepLinkKind, string>>;

export interface BuildDeepLinkArgs {
  kind: DeepLinkKind;
  externalId: string;
  baseUrl: string;
  /** Per-tenant override map — wins over provider defaults when a key is set. */
  overrideTemplates?: LinkTemplates;
}

export interface CMMSProvider {
  /** Display name shown in button copy: "Open in {name}". */
  readonly name: string;
  /** Stable slug used in DB enum + registry lookup. */
  readonly slug: CMMSProviderSlug;
  /** Default URL templates. Tokens supported: {external_id}, {tenant_id}. */
  readonly defaultLinkTemplates: Required<Record<DeepLinkKind, string>>;
  /** Pure function — no I/O. Returns the absolute deep-link URL. */
  buildDeepLink(args: BuildDeepLinkArgs): string;
}

/** Substitute {external_id} / {tenant_id} tokens in a URL template. */
export function applyTemplate(
  template: string,
  vars: { externalId: string; tenantId?: string },
): string {
  return template
    .replace(/\{external_id\}/g, encodeURIComponent(vars.externalId))
    .replace(/\{tenant_id\}/g, encodeURIComponent(vars.tenantId ?? ""));
}

/** Strip a single trailing slash from a URL. */
export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
