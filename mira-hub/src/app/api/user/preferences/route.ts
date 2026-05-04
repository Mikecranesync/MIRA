import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getUserPreferences, setUserPreferences } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const prefs = await getUserPreferences(session.user.id);
  return NextResponse.json(prefs);
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let patch: unknown;
  try {
    patch = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: 400 });
  }
  const updated = await setUserPreferences(session.user.id, patch as Record<string, unknown>);
  return NextResponse.json(updated);
}
