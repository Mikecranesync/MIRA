import { NextResponse } from "next/server";

import { embedderStatus } from "@/capabilities/embed-retry-sweep";

export const dynamic = "force-dynamic";

/**
 * Can uploads get vectors right now? The last cached embedder probe (at most one
 * a minute) — status and model only, never the embedder's URL or host. Always
 * 200: a down embedder degrades retrieval, it does not make the Hub unhealthy.
 *
 * The embedding-coverage canary reads this so a dead embedder fails it even on a
 * day with no uploads (2026-10-05 outage: zero fresh chunks meant zero fresh dark
 * chunks, and the canary passed while every upload went BM25-only).
 */
export function GET() {
  return NextResponse.json({ service: "mira-hub", embedder: embedderStatus(), ts: Date.now() });
}
