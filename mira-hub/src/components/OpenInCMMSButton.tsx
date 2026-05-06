"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CMMSEntityType } from "@/lib/cmms/provider";

interface Props {
  entityType: CMMSEntityType;
  /**
   * External CMMS id on the entity (e.g. atlas_id). Pass null/undefined when
   * the entity hasn't been synced yet — the button will hide itself.
   */
  atlasId?: string | null;
  /** Optional className appended to the rendered button. */
  className?: string;
  /** Override visual variant. Defaults to outline (matches existing CMMS link buttons). */
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

type Resolution =
  | { state: "linked"; url: string; providerName: string; provider: string }
  | { state: "unconfigured" }
  | { state: "unlinked"; providerName: string; provider: string };

interface ResolutionCacheEntry {
  promise: Promise<Resolution | null>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, ResolutionCacheEntry>();

function fetchResolution(entityType: CMMSEntityType, atlasId: string | null | undefined): Promise<Resolution | null> {
  const key = `${entityType}::${atlasId ?? ""}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.promise;

  const params = new URLSearchParams({ entity_type: entityType });
  if (atlasId) params.set("entity_id", atlasId);

  const promise = fetch(`/hub/api/cmms/deep-link?${params.toString()}`)
    .then(async (r) => {
      if (!r.ok) return null;
      return (await r.json()) as Resolution;
    })
    .catch(() => null);

  cache.set(key, { promise, fetchedAt: Date.now() });
  return promise;
}

/**
 * Renders one of three states:
 *   - tenant has CMMS + entity has atlas_id  → "Open in {ProviderName}" linking out
 *   - tenant has no CMMS configured          → "Connect a CMMS →" linking to /cmms
 *   - tenant has CMMS but entity has no id   → renders nothing (sync hasn't run)
 *
 * Lazy: doesn't render anything until the resolution returns. Cache is per
 * (entityType, atlasId) for 60s so repeated mounts don't refetch.
 */
export function OpenInCMMSButton({
  entityType,
  atlasId,
  className,
  variant = "outline",
  size = "default",
}: Props) {
  const [resolution, setResolution] = useState<Resolution | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchResolution(entityType, atlasId).then((r) => {
      if (!cancelled) setResolution(r);
    });
    return () => {
      cancelled = true;
    };
  }, [entityType, atlasId]);

  if (!resolution) return null;

  if (resolution.state === "linked") {
    return (
      <a href={resolution.url} target="_blank" rel="noopener noreferrer" className={className}>
        <Button variant={variant} size={size} className="gap-1.5">
          <ExternalLink className="w-4 h-4" />
          Open in {resolution.providerName}
        </Button>
      </a>
    );
  }

  if (resolution.state === "unconfigured") {
    return (
      <Link href="/cmms" className={className}>
        <Button variant={variant} size={size} className="gap-1.5">
          <Link2 className="w-4 h-4" />
          Connect a CMMS →
        </Button>
      </Link>
    );
  }

  // resolution.state === "unlinked": tenant has CMMS but this entity hasn't synced.
  return null;
}
