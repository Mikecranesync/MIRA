import { NextResponse } from "next/server";
import { findUserById, updateUserStatus, type UserStatus } from "@/lib/users";
import { requireSession, UnauthorizedError } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { applyLegacyUserStatusChange, isPilotApprovalRequired } from "@/capabilities/pilot-access";

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

    // F10/F12 (Codex #4882 review): this mutation predates approval-required
    // pilot mode and knows nothing about the 5-org cohort cap or the pilot
    // window. With the flag on, granting 'approved'/'trial' to a user whose
    // tenant is pilot-tracked (pending or active) must go ONLY through
    // approvePilotTenant (cohort cap + window + owner-and-crew-to-trial) —
    // never a bare UPDATE here. Refuse (409) rather than silently delegate:
    // this route has no "which tenant" UI affordance of its own, so guessing
    // which action the admin meant is riskier than pointing them at the real
    // one. The check AND the eventual row write happen inside ONE
    // transaction in applyLegacyUserStatusChange, under the same
    // tenant-scoped advisory lock approvePilotTenant/endPilotTenant take
    // (F12 — closes the race where activation could land between an
    // unlocked read here and this route's unconditional write).
    //
    // 'expired' is intentionally UNCHANGED from pre-pilot behavior (F11,
    // Codex #4882 review round 3): it affects ONLY the targeted user via a
    // plain updateUserStatus, exactly like 'pending'/'admin'. It must never
    // consult or mutate tenant-level pilot state — ending an organization's
    // pilot happens exclusively via the dedicated
    // POST /api/admin/pilots/{tenantId}/end. A single crew member's expiry
    // bypassing that and cascading to the whole org (every other member,
    // including the owner, losing access) was the F11 defect.
    if (isPilotApprovalRequired() && (status === "approved" || status === "trial")) {
      const target = await findUserById(id);
      if (target) {
        const result = await applyLegacyUserStatusChange(id, target.tenantId, status);
        if (result.outcome === "refused") {
          return NextResponse.json(
            {
              error:
                "This user's tenant is in the pilot program. Approve it with POST /api/admin/pilots/{tenantId}/approve, not this endpoint.",
            },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true });
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
