/**
 * #6119: the vendor hosts a public manufacturer manual may be fetched from (and
 * linked to from the cited-page viewer): the hosts of the curated OEM tiers in
 * `mira-crawler/sources.yaml` (`3_manufacturer`, `5_reference`, the tiers
 * `ManufacturerCrawler` trusts — `.claude/rules/oem-crawler-trusted.md`).
 * Checked in, not read at runtime; `oem-source-bytes.test.ts` fails when it
 * drifts from sources.yaml. Kept free of server imports so the viewer can use it.
 */
export const OEM_SOURCE_HOSTS: readonly string[] = [
  "cache.industry.siemens.com",
  "cdn.automationdirect.com",
  "cdn.skfmediahub.skf.com",
  "content2.smcetech.com",
  "download.schneider-electric.com",
  "forums.ni.com",
  "library.e.abb.com",
  "literature.rockwellautomation.com",
  "www.demagcranes.com",
  "www.emerson.com",
  "www.iaeng.org",
  "www.interroll.com",
  "www.magnetekdrives.com",
  "www.nema.org",
  "www.smcworld.com",
  "www.stle.org",
  "www.wago.com",
];

/** True when `raw` is an https URL on one of the hosts above. */
export function isOemSourceAddress(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && OEM_SOURCE_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
