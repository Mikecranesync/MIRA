// Asset-tag extraction — Hub `extractAssetTag` semantics (scan-target.ts):
// full URL | /m/<TAG> path | raw tag. Pure + unit-tested; also the deep-link
// trust filter (foreign absolute URLs never resolve).

export function extractAssetTag(input: string): string | null {
  const s = input.trim();
  const m = s.match(/(?:^|\/m\/)([A-Za-z0-9][A-Za-z0-9._-]{1,63})\/?$/);
  if (!m) return null;
  if (/^[a-z]+:\/\//i.test(s)) {
    const ok =
      s.startsWith("https://app.factorylm.com/m/") || s.startsWith("factorylm://m/");
    if (!ok) return null;
  }
  return m[1];
}
