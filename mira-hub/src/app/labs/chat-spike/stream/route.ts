import { NextResponse } from "next/server";
import { ANSWERED_TRANSCRIPT } from "@/lib/chat-adapter/__fixtures__/transcripts";

/**
 * DEV-ONLY SSE probe for the ChatGPT-class UI compatibility spike
 * (PRD §8.3 criteria 3/5 transport halves + the device-pass "cannot be
 * proven on web" items in docs/plans/2026-08-30-chatgpt-class-ui-spike-plan.md).
 *
 * Why this exists: the spike page's fixture transport is a setInterval — it
 * proves the adapter fold, not the TRANSPORT. This route serves the same
 * contract-shaped frames over a real HTTP response stream so the spike can
 * observe, per platform, (a) incremental vs buffered delivery and (b) whether
 * a client abort actually reaches the server. GET reports the last run's
 * server-side truth (frames sent, cancelled or not) so the web Stop proof is
 * asserted against the SERVER, not the UI.
 *
 * NEVER ships: 404s in production builds, touches no DB, no auth (the
 * middleware matcher already excludes labs/chat-spike — remove with the spike).
 */
export const dynamic = "force-dynamic";

type ProbeRun = {
  startedAt: string;
  framesSent: number;
  totalFrames: number;
  /** True when the client's abort/disconnect reached this server. */
  cancelled: boolean;
  finishedAt: string | null;
};

const state: { runs: number; last: ProbeRun | null } = { runs: 0, last: null };

const FRAME_DELAY_MS = 250;

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ runs: state.runs, last: state.last });
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const events = ANSWERED_TRANSCRIPT.split("\n\n")
    .filter((l) => l.trim())
    .map((l) => l + "\n\n");
  const run: ProbeRun = {
    startedAt: new Date().toISOString(),
    framesSent: 0,
    totalFrames: events.length,
    cancelled: false,
    finishedAt: null,
  };
  state.runs += 1;
  state.last = run;

  const enc = new TextEncoder();
  const markCancelled = () => {
    run.cancelled = true;
    if (!run.finishedAt) run.finishedAt = new Date().toISOString();
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      req.signal.addEventListener("abort", markCancelled, { once: true });
      try {
        for (const ev of events) {
          if (req.signal.aborted) {
            markCancelled();
            break;
          }
          controller.enqueue(enc.encode(ev));
          run.framesSent += 1;
          await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
        }
      } catch {
        // enqueue after the client went away — same truth as an abort.
        markCancelled();
      }
      if (!run.finishedAt) run.finishedAt = new Date().toISOString();
      try {
        controller.close();
      } catch {
        /* already cancelled */
      }
    },
    cancel() {
      // fetch-abort surfaces here (undici cancels the body stream).
      markCancelled();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
