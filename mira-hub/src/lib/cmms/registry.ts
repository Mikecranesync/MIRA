import type { CMMSProvider } from "./provider";
import { atlasProvider } from "./atlas-provider";

/**
 * Registry of CMMS providers, keyed by their id (matches tenant_cmms_config.provider).
 *
 * To add a new provider: implement CMMSProvider, import it here, add it to the
 * map. tenant_cmms_config.provider values that aren't in this map fall through
 * to "no CMMS configured" — the OpenInCMMSButton renders the connect-CTA fallback.
 */
const PROVIDERS: Record<string, CMMSProvider> = {
  [atlasProvider.id]: atlasProvider,
};

export function getProvider(id: string): CMMSProvider | null {
  return PROVIDERS[id] ?? null;
}

export function listProviders(): CMMSProvider[] {
  return Object.values(PROVIDERS);
}
