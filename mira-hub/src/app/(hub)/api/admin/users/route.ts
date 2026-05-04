import { NextResponse } from "next/server";
import { listAllUsers } from "@/lib/users";
import { requireSession, UnauthorizedError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    if (session.status !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const users = await listAllUsers();
    return NextResponse.json({ users: users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      status: u.status,
      plan: u.plan,
      trialExpiresAt: u.trialExpiresAt?.toISOString() ?? null,
      role: u.role,
    }))});
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
