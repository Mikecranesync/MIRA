import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { endPilotTenant, isPilotApprovalRequired } from "@/capabilities/pilot-access";

export const dynamic = "force-dynamic";

/**
 * Ends a pilot tenant (#4878): `pilot_status='ended'` and every non-admin
 * user in the tenant moves to `expired`. Same gate as
 * `/api/admin/users/[id]` (platform.users.read — platformAdmin only). 404s
 * whenever MIRA_PILOT_APPROVAL_REQUIRED is off.
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
    const result = await endPilotTenant(tenantId);
    if (!result.ended) {
      return NextResponse.json({ error: "tenant is not an active pilot" }, { status: 409 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/admin/pilots/end]", err);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
