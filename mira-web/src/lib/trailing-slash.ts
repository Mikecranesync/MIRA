function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

const TRUSTED_REDIRECT_HOSTS = new Set([
  // Public app domains
  "factorylm.com",
  "www.factorylm.com",
  "app.factorylm.com",
  // Local development
  "localhost:3000",
  "localhost:3200",
  "127.0.0.1:3000",
  "127.0.0.1:3200",
]);

function firstTrustedHost(value: string | null): string | null {
  if (!value) return null;
  try {
    const hostUrl = new URL(`https://${value}`);
    const host = hostUrl.host.toLowerCase();
    const hostname = hostUrl.hostname.toLowerCase();
    if (TRUSTED_REDIRECT_HOSTS.has(host) || TRUSTED_REDIRECT_HOSTS.has(hostname)) {
      return host;
    }
  } catch {
    return null;
  }
  return null;
}

export function trailingSlashRedirectTarget(requestUrl: string, headers: Headers): string | null {
  const url = new URL(requestUrl);
  if (url.pathname === "/" || !url.pathname.endsWith("/")) return null;

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"))?.toLowerCase();
  if (forwardedProto === "http" || forwardedProto === "https") {
    url.protocol = `${forwardedProto}:`;
  }

  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
  const host = firstTrustedHost(forwardedHost)
    ?? firstTrustedHost(firstHeaderValue(headers.get("host")))
    ?? firstTrustedHost(url.host)
    ?? "factorylm.com";

  if (host) {
    const hostUrl = new URL(`${url.protocol}//${host}`);
    url.hostname = hostUrl.hostname;
    url.port = hostUrl.port;
  }

  return url.toString();
}
