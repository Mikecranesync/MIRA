import { isOemDocumentationHost, type DiscoveryIdentity } from "@/lib/manual-discovery";
import { manufacturerInGroup } from "@/lib/manufacturerNormalize";
import { isPublicHttpsUrl } from "@/lib/safe-download";
import catalog from "./reviewed-manual-library.json";

/** Reviewed manufacturer publications. The digest binds the coverage claim to
 * the exact bytes, so a silent revision cannot inherit the old approval. */
export function reviewedManualFor(identity: DiscoveryIdentity) {
  const part = (identity.catalogNumber?.trim() || identity.model?.trim() || "").toUpperCase();
  const matches = catalog.filter((entry) =>
    entry.models.includes(part) && manufacturerInGroup(identity.manufacturer, entry.manufacturer) &&
    isPublicHttpsUrl(entry.url) && isOemDocumentationHost(identity.manufacturer, new URL(entry.url).hostname),
  );
  return matches.length === 1 ? matches[0] : null;
}
