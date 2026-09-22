import { registerPlugin } from "@capacitor/core";

export interface BuildConfigPlugin {
  getApiBase(): Promise<{ apiBase: string }>;
  getDeepLinkConfig(): Promise<{ host: string; scheme: string }>;
}

const BuildConfig = registerPlugin<BuildConfigPlugin>("BuildConfig", {
  web: () =>
    import("./build-config-web").then((m) => new m.BuildConfigWeb()),
});

export default BuildConfig;

/**
 * The build flavor could not be read (native bridge missing, rejected, or
 * returned a malformed value). Callers MUST treat this as "no backend": a
 * staging build that cannot prove its flavor must never guess production
 * (Mike, 2026-09-21 — cross-environment fallback is an isolation defect).
 */
export class BuildConfigUnavailableError extends Error {
  constructor(what: string, cause?: unknown) {
    super(`build configuration unavailable: ${what}`);
    this.name = "BuildConfigUnavailableError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const HTTPS_ORIGIN = /^https:\/\/[a-z0-9.-]+$/i;
const HOST = /^[a-z0-9.-]+$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*$/i;

/** Flavor API origin (e.g. https://app-staging.factorylm.com). Fails closed:
 *  rejects with BuildConfigUnavailableError instead of falling back to any
 *  hard-coded environment. On the web the plugin's web implementation answers
 *  (dev/browser default), so this only ever throws on a broken native bridge. */
export async function resolveApiBase(): Promise<string> {
  let apiBase: unknown;
  try {
    ({ apiBase } = await BuildConfig.getApiBase());
  } catch (e) {
    throw new BuildConfigUnavailableError("apiBase", e);
  }
  if (typeof apiBase !== "string" || !HTTPS_ORIGIN.test(apiBase)) {
    throw new BuildConfigUnavailableError(`apiBase malformed: ${String(apiBase)}`);
  }
  return apiBase;
}

/** Flavor deep-link trust (host + custom scheme). Same fail-closed contract. */
export async function resolveDeepLinkConfig(): Promise<{ host: string; scheme: string }> {
  let cfg: { host?: unknown; scheme?: unknown };
  try {
    cfg = await BuildConfig.getDeepLinkConfig();
  } catch (e) {
    throw new BuildConfigUnavailableError("deepLink", e);
  }
  const { host, scheme } = cfg ?? {};
  if (typeof host !== "string" || !HOST.test(host) || typeof scheme !== "string" || !SCHEME.test(scheme)) {
    throw new BuildConfigUnavailableError(`deepLink malformed: ${String(host)} ${String(scheme)}`);
  }
  return { host, scheme };
}
