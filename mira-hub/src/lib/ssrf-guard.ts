// mira-hub/src/lib/ssrf-guard.ts
//
// streamFromSignedUrl() takes a user-controlled URL from the Dropbox flow.
// Without restrictions, an attacker could submit
//   externalDownloadUrl: "http://100.86.236.11:9099/..."
// and probe internal Tailscale services (mira-pipeline, atlas-api, ollama)
// or AWS metadata endpoints (169.254.169.254).
//
// Defense:
//   1. https only — no http, no file:, no ftp:
//   2. Hostname must end with an allowlisted suffix (Dropbox / Google)
//   3. Hostname must NOT be an IP literal (defense against IP-literal probes)
//   4. If hostname IS an IP literal somehow, it must NOT be in private ranges
//   5. On redirect, re-validate the Location URL (caller wraps with redirect: "manual")
import { isIP } from "node:net";

// Suffixes — leading "." ensures we match subdomains AND the apex.
// e.g. ".dropbox.com" matches "uc.dropbox.com" but NOT "evildropbox.com".
const ALLOWED_HOST_SUFFIXES = [
  ".dropbox.com",
  ".dropboxusercontent.com",
  ".googleusercontent.com",
];

export class SsrfBlockedError extends Error {
  url: string;
  reason: string;
  constructor(url: string, reason: string) {
    super(`ssrf_blocked: ${reason} (url=${url})`);
    this.name = "SsrfBlockedError";
    this.url = url;
    this.reason = reason;
  }
}

function hostMatchesAllowlist(host: string): boolean {
  const normalized = host.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => {
    // suffix is ".dropbox.com" — match "X.dropbox.com" or "dropbox.com" exactly.
    const apex = suffix.slice(1);
    return normalized === apex || normalized.endsWith(suffix);
  });
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  // 10/8
  if (a === 10) return true;
  // 172.16/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168/16
  if (a === 192 && b === 168) return true;
  // 127/8 loopback
  if (a === 127) return true;
  // 169.254/16 link-local (covers AWS metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 100.64/10 CGNAT (Tailscale)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 0/8
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 loopback (after dropping brackets / leading zeros)
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  // fc00::/7 ULA — first hex char is f, second is c or d
  if (/^f[cd]/.test(lower)) return true;
  // fe80::/10 link-local
  if (/^fe[89ab]/.test(lower)) return true;
  return false;
}

/**
 * Validate a URL is safe to fetch from a server-side handler.
 *
 * Throws SsrfBlockedError on rejection. Returns the parsed URL on success.
 */
export function assertSafeUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, "invalid_url");
  }
  if (parsed.protocol !== "https:") {
    throw new SsrfBlockedError(rawUrl, `non_https_protocol: ${parsed.protocol}`);
  }
  // hostname includes brackets stripped for IPv6 — check with isIP first
  const host = parsed.hostname;
  const ipFamily = isIP(host);
  if (ipFamily !== 0) {
    // Hostname IS an ip literal. Even if not private, it bypasses the
    // allowlist by design — reject all IP literals.
    if (ipFamily === 4 && isPrivateIPv4(host)) {
      throw new SsrfBlockedError(rawUrl, `private_ipv4: ${host}`);
    }
    if (ipFamily === 6 && isPrivateIPv6(host)) {
      throw new SsrfBlockedError(rawUrl, `private_ipv6: ${host}`);
    }
    throw new SsrfBlockedError(rawUrl, `ip_literal_host_not_allowed: ${host}`);
  }
  if (!hostMatchesAllowlist(host)) {
    throw new SsrfBlockedError(rawUrl, `host_not_allowlisted: ${host}`);
  }
  return parsed;
}

// Exported for unit tests
export const _internals = {
  hostMatchesAllowlist,
  isPrivateIPv4,
  isPrivateIPv6,
};
