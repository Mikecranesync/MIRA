import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import {
  clampSpan,
  DEFAULT_POST_SECONDS,
  DEFAULT_PRE_SECONDS,
  fetchMachineHistory,
  historyResponseBody,
  parseAnchor,
} from "@/lib/machine-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/assets/[id]/history?at=<iso>&pre=<s>&post=<s>
 *
 * Sensor REPLAY (contract §4.3, D1: the wire name is `history`; "Replay" is UI
 * copy). Chronological reconstruction of what Machine Memory actually observed
 * around a fault: tag_events + tag_event_diffs in `[at-pre, at+post]`
 * (defaults 5 s / 2 s, capped at 120 s), every row with BOTH clocks and its
 * quality, plus the existing Machine Memory header and freshness roll-up.
 *
 *   - anchor: `at` if given, else the latest faulted/estopped
 *     machine_state_window; none → 404 `no_fault_window` with the latest
 *     window's state/time. Never a synthesized anchor.
 *   - missing tables → 200 `{rows: [], reason: "unavailable"}` — distinct from
 *     a real empty window. Never a fake timeline.
 *   - read-only; all logic lives in @/lib/machine-history (shared with the
 *     notebook chat route's `machineEvidence` grounding, §4.4).
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
  const url = new URL(req.url);
  const rawAt = url.searchParams.get("at");
  const at = parseAnchor(rawAt);
  if (rawAt && !at) {
    return NextResponse.json({ error: "invalid_at", message: "`at` must be an ISO-8601 timestamp." }, { status: 400 });
  }
  const pre = clampSpan(url.searchParams.get("pre"), DEFAULT_PRE_SECONDS);
  const post = clampSpan(url.searchParams.get("post"), DEFAULT_POST_SECONDS);

  try {
    const result = await withTenantContext(ctx.tenantId, (c) =>
      fetchMachineHistory(c, ctx.tenantId, id, { at, pre, post }),
    );
    if (!result.ok) {
      if (result.error === "no_uns_path") {
        return NextResponse.json(
          { error: "no_uns_path", message: "This asset has no machine memory (no UNS path)." },
          { status: 404 },
        );
      }
      return NextResponse.json(
        {
          error: "no_fault_window",
          message: result.windowsAvailable
            ? "No recorded fault or e-stop window for this asset."
            : "Machine state windows are not available in this environment.",
          latestWindow: result.latestWindow,
          windowsAvailable: result.windowsAvailable,
        },
        { status: 404 },
      );
    }
    return NextResponse.json(historyResponseBody(result.history));
  } catch (err) {
    console.error("[api/assets/[id]/history GET]", err);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
