/**
 * #5910: the one test for a link MIRA may hand a technician to open.
 *
 * A public https URL (no credentials, default port, per isPublicHttpsUrl) on a
 * host that is not private, loopback or a metadata address, with no character
 * that could break out of the sentence or attribute it is printed in. Anything
 * else is withheld (null), never rewritten: an http link is not upgraded to
 * https, because the https address may not be the same document.
 */
import { isBlockedHost, isPublicHttpsUrl } from "@/lib/safe-download";

export function offerableLinkUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw === "" || /[\\\s<>"']/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!isPublicHttpsUrl(raw) || isBlockedHost(url.hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}
