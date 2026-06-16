"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Deep-link API response shape — must mirror DeepLinkResult in src/lib/cmms/deep-link.ts.
type ApiResult =
  | { status: "ready"; url: string; provider: string; providerSlug: string }
  | { status: "syncing" }
  | { status: "unconfigured" };

export interface OpenInCMMSButtonProps extends Pick<ButtonProps, "variant" | "size" | "className"> {
  kind: "work_order" | "asset" | "pm";
  /** Internal NeonDB UUID. The endpoint joins this to fetch the external CMMS ID. */
  recordId: string;
  /** When true, suppress the "Connect a CMMS →" CTA and render nothing instead. */
  hideWhenUnconfigured?: boolean;
}

/**
 * Renders one of three states based on the tenant's CMMS config + record sync state:
 *
 *   ready        — `<a target="_blank">Open in {provider.name}</a>` (e.g. "Open in Atlas")
 *   syncing      — disabled `<button>` "Syncing to CMMS…"
 *   unconfigured — `<Link href="/cmms">Connect a CMMS →</Link>` (or hidden if hideWhenUnconfigured)
 *
 * Spec: docs/specs/cmms-deep-link-multi-provider-spec.md §4.5
 */
export function OpenInCMMSButton({
  kind,
  recordId,
  variant = "outline",
  size = "default",
  className,
  hideWhenUnconfigured = false,
}: OpenInCMMSButtonProps) {
  const t = useTranslations("cmmsLink");
  const [result, setResult] = useState<ApiResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/hub/api/cmms/deep-link?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(recordId)}`,
        );
        if (!res.ok) {
          if (!cancelled) setResult({ status: "unconfigured" });
          return;
        }
        const data = (await res.json()) as ApiResult;
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setResult({ status: "unconfigured" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, recordId]);

  // Loading: render a skeleton button so layout doesn't shift when the
  // resolved state arrives.
  if (result === null) {
    return (
      <Button variant={variant} size={size} className={cn(className)} disabled>
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("loading")}
      </Button>
    );
  }

  if (result.status === "ready") {
    // Dynamic label: "Open in Atlas", "Open in Maximo", etc. Falls back to
    // "Open in CMMS" only when provider name is unknown/blank (defensive).
    const label = result.provider
      ? t("openIn", { provider: result.provider })
      : t("openCmms");
    return (
      <Button variant={variant} size={size} className={cn(className)} asChild>
        <a href={result.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="w-4 h-4" />
          {label}
        </a>
      </Button>
    );
  }

  if (result.status === "syncing") {
    return (
      <Button
        variant={variant}
        size={size}
        className={cn(className)}
        disabled
        title={t("syncingTooltip")}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("syncing")}
      </Button>
    );
  }

  // unconfigured
  if (hideWhenUnconfigured) return null;

  return (
    <Button variant={variant} size={size} className={cn(className)} asChild>
      <Link href="/cmms">
        <Link2 className="w-4 h-4" />
        {t("connectCmms")}
      </Link>
    </Button>
  );
}
