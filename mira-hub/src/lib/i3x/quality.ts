import type { I3xQuality } from "@/lib/i3x/types";

/**
 * Project MIRA's quality + freshness onto the i3X VQT quality enum.
 *
 * MIRA `latest_quality` ∈ {good, bad, stale, uncertain} (mira-relay tag_ingest)
 * plus `freshness_status` (Hub migration 036). i3X quality ∈ {Good, GoodNoData,
 * Bad, Uncertain}. See §4.1 of the architecture doc.
 *
 * Precedence: Bad dominates everything; an explicitly stale/uncertain reading is
 * Uncertain; a stale freshness_status downgrades an otherwise-good reading; a
 * good reading with no value is GoodNoData; unknown codes downgrade to Uncertain.
 */
export function qualityToI3x(input: {
  quality: string;
  freshness?: string;
  hasValue?: boolean;
}): I3xQuality {
  const quality = (input.quality ?? "").trim().toLowerCase();
  const freshness = (input.freshness ?? "live").trim().toLowerCase();
  const hasValue = input.hasValue ?? true;

  if (quality === "bad") return "Bad";
  if (quality === "uncertain" || quality === "stale") return "Uncertain";
  if (quality === "good") {
    if (freshness === "stale") return "Uncertain";
    return hasValue ? "Good" : "GoodNoData";
  }
  // Unknown/empty quality code → conservative downgrade.
  return "Uncertain";
}
