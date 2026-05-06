import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { resolveDeepLink } from "@/lib/cmms/deep-link";
import type { CMMSEntityType } from "@/lib/cmms/provider";

export const dynamic = "force-dynamic";

const VALID_ENTITY_TYPES = new Set<CMMSEntityType>(["work_order", "asset", "pm_schedule"]);

/**
 * GET /api/cmms/deep-link?entity_type=work_order&entity_id=ATLAS-EXT-ID
 *
 * `entity_id` is the EXTERNAL CMMS id (atlas_id, maintainx_id, etc.) — not
 * the hub's canonical id. Callers fetch the entity first and pass its
 * external id here. Empty/missing entity_id is allowed: it lets the client
 * discover whether the tenant has any CMMS configured at all (so it can
 * render the "Connect a CMMS" CTA when there's nothing to link to yet).
 *
 * Response shape mirrors DeepLinkResolution from lib/cmms/deep-link.ts:
 *   { state: "linked",       url, providerName, provider }
 *   { state: "unconfigured" }
 *   { state: "unlinked",     providerName, provider }
 */
export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(req.url);
  const entityType = url.searchParams.get("entity_type") as CMMSEntityType | null;
  const entityId = url.searchParams.get("entity_id");

  if (!entityType || !VALID_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json(
      { error: "Invalid or missing entity_type. Expected: work_order | asset | pm_schedule" },
      { status: 400 },
    );
  }

  try {
    const resolution = await resolveDeepLink({
      tenantId: ctx.tenantId,
      entityType,
      externalId: entityId,
    });
    return NextResponse.json(resolution);
  } catch (err) {
    console.error("[api/cmms/deep-link]", err);
    return NextResponse.json({ error: "Resolution failed" }, { status: 500 });
  }
}
