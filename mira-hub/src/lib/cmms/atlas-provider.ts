import {
  applyTemplate,
  stripTrailingSlash,
  type BuildDeepLinkArgs,
  type CMMSProvider,
  type DeepLinkKind,
} from "./provider";

// Atlas (FactoryLM Works) — the default CMMS for every tenant.
//
// Note: only deep-link building lives here. The actual Atlas REST client
// (auth, sync) is in src/lib/atlas/client.ts and is wired to the sync worker
// in scripts/cmms-sync-worker.ts. Provider sync methods will be added when
// we generalize the sync worker (Phase 5 in the deep-link spec).

export class AtlasProvider implements CMMSProvider {
  readonly name = "Atlas";
  readonly slug = "atlas" as const;
  readonly defaultLinkTemplates: Required<Record<DeepLinkKind, string>> = {
    work_order: "/app/work-orders/{external_id}",
    asset:      "/app/assets/{external_id}",
    pm:         "/app/preventive-maintenances/{external_id}",
  };

  buildDeepLink(args: BuildDeepLinkArgs): string {
    const { kind, externalId, baseUrl, overrideTemplates } = args;
    const template =
      overrideTemplates?.[kind] ?? this.defaultLinkTemplates[kind];
    const path = applyTemplate(template, { externalId });
    return `${stripTrailingSlash(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
  }
}
