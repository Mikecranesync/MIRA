import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import {
  PilotCohortCapError,
  PilotCohortRenewalError,
  PilotTenantNotFoundError,
  approvePilotTenant,
  isPilotApprovalRequired,
} from "@/capabilities/pilot-access";

export const dynamic = "force-dynamic";

/**
 * Admin approval into the pilot cohort (#4878). Same gate as
 * `/api/admin/users/[id]` (platform.users.read — platformAdmin only).
 * 404s whenever MIRA_PILOT_APPROVAL_REQUIRED is off, so the route has zero
 * surface with the flag at its default.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  if (!isPilotApprovalRequired()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const session = await requireSession();
    const denied = requireCapability(session, "platform.users.read");
    if (denied) return denied;

    const { tenantId } = await params;
    const result = await approvePilotTenant(tenantId, session.userId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof PilotTenantNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof PilotCohortRenewalError || err instanceof PilotCohortCapError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/admin/pilots/approve]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
