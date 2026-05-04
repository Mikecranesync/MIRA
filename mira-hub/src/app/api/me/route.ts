import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  try {
    const user = await findUserById(ctx.userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const initials = (user.name ?? user.email)
      .split(/\s+/)
      .slice(0, 2)
      .map((w: string) => w[0]?.toUpperCase() ?? "")
      .join("");
    return NextResponse.json({
      id: user.id,
      name: user.name ?? user.email,
      email: user.email,
      role: user.role,
      status: user.status,
      tenantId: user.tenantId,
      initials,
    });
  } catch (err) {
    console.error("[api/me]", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
