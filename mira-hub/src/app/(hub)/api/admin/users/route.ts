import { NextResponse } from "next/server";
import { listAllUsers, isSystemAccount } from "@/lib/users";
import { requireSession, UnauthorizedError } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    // platform.users.read maps to the same status==="admin" gate this route
    // always used — behavior-identical, now via the shared guard (#1932).
    const denied = requireCapability(session, "platform.users.read");
    if (denied) return denied;
    const includeSystem = new URL(req.url).searchParams.get("includeSystem") === "1";
    const all = await listAllUsers();
    const users = includeSystem ? all : all.filter(u => !isSystemAccount(u));
    return NextResponse.json({
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        name: u.name,
        status: u.status,
        plan: u.plan,
        trialExpiresAt: u.trialExpiresAt?.toISOString() ?? null,
        role: u.role,
      })),
      systemHidden: all.length - users.length,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
