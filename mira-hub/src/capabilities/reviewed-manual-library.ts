import { isOemDocumentationHost } from "@/lib/manual-discovery";
import { manufacturerInGroup } from "@/lib/manufacturerNormalize";
import { isPublicHttpsUrl } from "@/lib/safe-download";
import { catalogIdentifierView } from "./catalog-identifier";
import catalog from "./reviewed-manual-library.json";

type ManualIdentity = {
  manufacturer?: string | null;
  model?: string | null;
  catalogNumber?: string | null;
};

function lookupLabel(value: string | null | undefined): string {
  return catalogIdentifierView(value?.trim() ?? "").text.toUpperCase();
}

/** One lookup identifier across photo, typed model and explicit catalog inputs. */
export function manualLookupPart(identity: Pick<ManualIdentity, "model" | "catalogNumber">): string | null {
  return lookupLabel(identity.catalogNumber) || lookupLabel(identity.model) || null;
}

/** Reviewed manufacturer publications. The digest binds the coverage claim to
 * the exact bytes, so a silent revision cannot inherit the old approval. */
export function reviewedManualFor(identity: ManualIdentity) {
  const part = manualLookupPart(identity);
  if (!part) return null;
  const model = lookupLabel(identity.model);
  const matches = catalog.filter((entry) =>
    entry.models.includes(part) && manufacturerInGroup(identity.manufacturer, entry.manufacturer) &&
    (!model || model === part || entry.families?.includes(model)) &&
    isPublicHttpsUrl(entry.url) && isOemDocumentationHost(identity.manufacturer, new URL(entry.url).hostname),
  );
  return matches.length === 1 ? matches[0] : null;
}
