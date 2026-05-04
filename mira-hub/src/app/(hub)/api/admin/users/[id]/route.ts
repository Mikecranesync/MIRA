import { NextResponse } from "next/server";
import { updateUserStatus, type UserStatus } from "@/lib/users";
import { requireSession, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

const VALID_STATUSES: UserStatus[] = ["pending", "trial", "approved", "expired", "admin"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (session.status !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json() as { status?: unknown };
    const { status } = body;
    if (!status || !VALID_STATUSES.includes(status as UserStatus)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
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
