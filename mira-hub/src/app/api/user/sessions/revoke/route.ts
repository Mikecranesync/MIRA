import { NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { revokeUserSessions } from "@/lib/users";

export const dynamic = "force-dynamic";

/** Kill every Hub JWT for the signed-in user. The body is ignored so a
 *  caller cannot aim this at anyone else (#3831). */
export async function POST(req: Request) {
  void req;
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const result = await revokeUserSessions(ctx.userId);
  return NextResponse.json({
    ok: true,
    revoked: true,
    sessionVersion: result.sessionVersion,
  });
}
