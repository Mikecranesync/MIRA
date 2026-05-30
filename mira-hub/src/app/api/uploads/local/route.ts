import { NextResponse, type NextRequest } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { handleLocalUpload } from "@/lib/local-upload";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  return handleLocalUpload(req, { tenantId: ctx.tenantId, userId: ctx.userId });
}
