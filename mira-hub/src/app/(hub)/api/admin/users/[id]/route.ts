import { NextResponse } from "next/server";
import { findUserById, updateUserStatus, type UserStatus } from "@/lib/users";
import { requireSession, UnauthorizedError } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { endPilotTenant, getPilotTenantStatus, isPilotApprovalRequired } from "@/capabilities/pilot-access";

export const dynamic = "force-dynamic";

const VALID_STATUSES: UserStatus[] = ["pending", "trial", "approved", "expired", "admin"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const denied = requireCapability(session, "platform.users.read");
    if (denied) return denied;
    const { id } = await params;
    const body = await req.json() as { status?: unknown };
    const { status } = body;
    if (!status || !VALID_STATUSES.includes(status as UserStatus)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    // F10 (Codex #4882 post-cap review): this mutation predates
    // approval-required pilot mode and knows nothing about the 5-org
    // cohort cap or the pilot window. With the flag on, a tenant that is
    // pilot-tracked (pending or active) must have 'approved'/'trial'
    // granted ONLY through approvePilotTenant (cohort cap + window +
    // owner-and-crew-to-trial) — never by a bare UPDATE here. Refuse
    // rather than silently delegate: this route has no "which tenant" UI
    // affordance of its own, so guessing which action the admin meant is
    // riskier than pointing them at the real one. 'expired' is different —
    // for a pilot tenant it can only coherently mean "end the pilot", so
    // it's safe to delegate directly. Flag off, or a tenant that was never
    // pilot-tracked (pilot_status null/ended), or status 'pending'/'admin'
    // (role/revocation administration, unrelated to the pilot funnel):
    // completely unchanged.
    if (isPilotApprovalRequired() && (status === "approved" || status === "trial" || status === "expired")) {
      const target = await findUserById(id);
      if (target) {
        const { pilotStatus } = await getPilotTenantStatus(target.tenantId);
        if (pilotStatus === "pending" || pilotStatus === "active") {
          if (status === "approved" || status === "trial") {
            return NextResponse.json(
              {
                error:
                  "This user's tenant is in the pilot program. Approve it with POST /api/admin/pilots/{tenantId}/approve, not this endpoint.",
              },
              { status: 409 },
            );
          }
          // status === "expired": the only coherent meaning for a
          // pilot-tracked tenant is "end the pilot" — delegate first (only
          // meaningful when there's an active window to close), then still
          // fall through to the direct row update below so the specific
          // targeted row matches what was requested even if endPilotTenant
          // excluded it (it never touches admins).
          if (pilotStatus === "active") {
            await endPilotTenant(target.tenantId);
          }
        }
      }
    }

    await updateUserStatus(id, status as UserStatus);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
