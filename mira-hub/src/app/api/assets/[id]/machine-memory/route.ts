import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { buildMachineMemoryResponse } from "@/lib/machine-memory-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/assets/[id]/machine-memory
 *
 * The minimal Hub surface for persisted machine memory (docs/discovery/
 * 2026-07-03-machine-memory-buildout.md D7): the latest machine run, the
 * latest state window, and the latest diffs/anomalies (with next-check +
 * evidence pointers) for one asset. Read-only.
 *
 * Empty state is first-class — most assets have no machine_run/window/diff
 * rows yet, and that is not an error.
 *
 * The response assembly lives in `@/lib/machine-memory-response`
 * (buildMachineMemoryResponse), shared with the SSE push route
 * (`./stream/route.ts`) so both surfaces return the byte-identical shape.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }
  const ctx = await sessionOrDemo(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  try {
    const result = await withTenantContext(ctx.tenantId, (c) =>
      buildMachineMemoryResponse(c, ctx.tenantId, id),
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/assets/[id]/machine-memory GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
