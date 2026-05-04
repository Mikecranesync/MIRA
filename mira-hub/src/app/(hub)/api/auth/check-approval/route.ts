import { NextResponse } from "next/server";
import { findUserById } from "@/lib/users";
import { requireSession, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const user = await findUserById(session.userId);
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404 });
    return NextResponse.json({ status: user.status, trialExpiresAt: user.trialExpiresAt?.toISOString() ?? null });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
