function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first || null;
}

export function trailingSlashRedirectTarget(requestUrl: string, headers: Headers): string | null {
  const url = new URL(requestUrl);
  if (url.pathname === "/" || !url.pathname.endsWith("/")) return null;

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(headers.get("host"));

  if (forwardedProto) url.protocol = `${forwardedProto}:`;
  if (host) {
    const hostUrl = new URL(`${url.protocol}//${host}`);
    url.hostname = hostUrl.hostname;
    url.port = hostUrl.port;
  }

  return url.toString();
}
