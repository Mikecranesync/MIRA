import { NextResponse } from "next/server";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { buildMachineMemoryResponse, type MachineMemoryResponse } from "@/lib/machine-memory-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often we re-assemble the response and check for a live-tag/state change. */
const STREAM_TICK_MS = 350;
/** Force a full resend at least this often even with no live_tags/current_state
 * change, so runs/windows/anomalies (which don't touch live_tags) still refresh. */
const FORCE_RESEND_MS = 3000;
/** SSE comment heartbeat — keeps proxies from dropping an idle connection. */
const HEARTBEAT_MS = 15_000;
/** Hard cap on one connection's lifetime; the browser EventSource auto-reconnects. */
const STREAM_LIFETIME_MS = 10 * 60 * 1000;

/** The part of the payload that changes fast (live tags + derived state) — the
 * comparison key for "did anything worth an immediate push change". */
function changeKey(r: MachineMemoryResponse): string {
  return JSON.stringify({ live_tags: r.live_tags, current_state: r.current_state });
}

/**
 * GET /api/assets/[id]/machine-memory/stream
 *
 * SSE push companion to GET .../machine-memory (docs/perf/live-latency-budget.md
 * Tier 2 — collapses the browser's stage-5 poll to ~0 perceived latency). Holds
 * one connection open, re-assembles the identical MachineMemoryResponse (via
 * the shared `buildMachineMemoryResponse`) every STREAM_TICK_MS, and pushes the
 * FULL payload whenever live_tags/current_state changed or FORCE_RESEND_MS
 * elapsed since the last push. The card falls back to its polling GET on any
 * stream error (proxy that blocks SSE, network hiccup, etc).
 *
 * Lifecycle: each tick opens+releases its own pooled connection via
 * withTenantContext (never holds one across ticks). A transient per-tick DB
 * error is logged and skipped, not fatal to the stream. On `req.signal` abort
 * (client navigated away / EventSource closed), on the 10-minute lifetime cap,
 * or on any enqueue failure (controller already closed), every timer is
 * cleared and the controller is closed exactly once.
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
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let inFlight = false;
      let lastKey: string | null = null;
      let lastSentAt = 0;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          // Controller already closed underneath us (client gone) — stop.
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(tickTimer);
        clearInterval(heartbeatTimer);
        clearTimeout(lifetimeTimer);
        req.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const assembleAndMaybeSend = async (force: boolean) => {
        if (closed || inFlight) return;
        inFlight = true;
        try {
          const result = await withTenantContext(ctx.tenantId, (c) =>
            buildMachineMemoryResponse(c, ctx.tenantId, id),
          );
          const key = changeKey(result);
          const now = Date.now();
          if (force || key !== lastKey || now - lastSentAt >= FORCE_RESEND_MS) {
            safeEnqueue(`data: ${JSON.stringify(result)}\n\n`);
            lastKey = key;
            lastSentAt = now;
          }
        } catch (err) {
          // Transient DB error — skip this tick, keep the stream alive.
          console.error("[api/assets/[id]/machine-memory/stream GET] tick failed", err);
        } finally {
          inFlight = false;
        }
      };

      // Immediate full snapshot on connect.
      void assembleAndMaybeSend(true);

      const tickTimer = setInterval(() => {
        void assembleAndMaybeSend(false);
      }, STREAM_TICK_MS);

      const heartbeatTimer = setInterval(() => {
        safeEnqueue(": ping\n\n");
      }, HEARTBEAT_MS);

      const lifetimeTimer = setTimeout(cleanup, STREAM_LIFETIME_MS);

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
