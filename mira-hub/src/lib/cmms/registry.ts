import { AtlasProvider } from "./atlas-provider";
import type { CMMSProvider, CMMSProviderSlug } from "./provider";

// Provider registry. Phase 1 ships Atlas only; Phase 3 adds Maximo, Fiix,
// MaintainX, UpKeep deep-link stubs.
//
// Every slug in this registry must also be a value in the `cmms_provider`
// Postgres enum (migration 008). When adding a new provider, ship the
// registry entry and `ALTER TYPE cmms_provider ADD VALUE` in the same PR.

const ATLAS = new AtlasProvider();

const PROVIDERS: Partial<Record<CMMSProviderSlug, CMMSProvider>> = {
  atlas: ATLAS,
};

/** Returns the configured provider, or Atlas as a safe fallback. */
export function getProvider(slug: CMMSProviderSlug | string): CMMSProvider {
  return PROVIDERS[slug as CMMSProviderSlug] ?? ATLAS;
}

/** Whether a slug has a registered implementation. False for unimplemented enum values. */
export function hasProvider(slug: string): slug is CMMSProviderSlug {
  return slug in PROVIDERS;
}
