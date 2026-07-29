/**
 * Shared HTTP reachability probe for Command Center surfaces — read-only.
 *
 * Extracted from /api/command-center/gateways/route.ts so the gateways route
 * AND the commissioning aggregation route use ONE probe (no duplicated SSRF
 * guard / timeout policy). This only ever *reads* a URL to answer "is something
 * listening?" — never a control endpoint (.claude/rules/fieldbus-readonly.md).
 */

// Default Ignition gateway HTTP port.
export const IGNITION_PORT = 8088;
// Short timeout so callers don't hang if the host is unreachable.
export const PROBE_TIMEOUT_MS = 2_000;

/**
 * Extract the bare host from a "host" or "host:port" string.
 * Returns null for malformed values (scheme present, whitespace, etc.).
 */
export function parseGatewayHost(raw: string): string | null {
  if (!raw || /[\s/]/.test(raw) || raw.includes("://")) return null;
  const colonIdx = raw.lastIndexOf(":");
  return colonIdx === -1 ? raw : raw.slice(0, colonIdx);
}

/**
 * SSRF guard: block link-local/unspecified addresses (same policy as
 * display-registration.ts). Legit plant LAN (10.x, 192.168.x, Tailscale CGNAT
 * 100.64/10) are allowed; the full prod lockdown is
 * COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST.
 */
export function isLinkLocalHost(host: string): boolean {
  const lc = host.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    /^169\.254\./.test(host) ||
    /^fe80:/.test(lc) ||
    host === "0.0.0.0" ||
    lc === "::"
  );
}

/**
 * GET a URL with a short timeout; true on any non-5xx response. A redirect
 * (3xx) counts as up — Ignition's gateway login responds 302 unauthenticated.
 * redirect:'manual' so a dashboard redirect counts as up without a second hop.
 */
export async function probeUrlReachable(
  url: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "manual" });
    return res.status < 500;
  } catch {
    return false; // connection refused / DNS / timeout
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe an Ignition gateway's /main endpoint. Returns false (skips probe) for
 * link-local addresses or hosts not in COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST
 * when that env var is set. gateway_hostname may be "host" or "host:port".
 */
export async function isGatewayOnline(hostname: string): Promise<boolean> {
  const host = parseGatewayHost(hostname);
  if (!host || isLinkLocalHost(host)) return false;

  // SSRF lockdown: reuse the same allowlist env var as the display route.
  const allow = (process.env.COMMAND_CENTER_DISPLAY_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length > 0 && !allow.includes(host)) return false;

  const hasPort = hostname.includes(":");
  const base = hasPort ? `http://${hostname}` : `http://${hostname}:${IGNITION_PORT}`;
  return probeUrlReachable(`${base}/main`);
}
