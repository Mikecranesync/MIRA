/**
 * GET /api/observability/coverage — is the recorder actually capturing?
 *
 * Measured from the LEDGER, not from anything the recorder reports about
 * itself. `started` counts accepted turns; `closed` counts the ones that
 * reached an outcome; `orphaned` is the difference old enough to be a real
 * loss. A recorder that silently stopped writing shows up here as orphans and
 * as a `with_packet` count below `closed` — neither of which the recorder can
 * fake, because both come from rows it failed to write.
 *
 * Also returns the ENVIRONMENT FINGERPRINT as `copy_text`: one plain-text block
 * a technician can copy out of a browser and paste into an issue. The whole
 * class of "which backend was I even on" confusion (the missing relay-photo
 * turn, 2026-09-22) is answered by that block.
 *
 * Tenant-scoped through the session. No question text, no answer text, no
 * credentials — ids, counts and config flags only.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import {
  lifecycleCoverage,
  lifecycleFailureCounters,
  listUnfinishedTurns,
} from "@/capabilities/observability/turn-lifecycle";
import {
  captureContentEnabled,
  environmentName,
  gitSha,
  serviceVersion,
} from "@/capabilities/observability/config";
import {
  ingressFailureCounters,
  ingressReconciliation,
} from "@/capabilities/observability/turn-ingress";

export const dynamic = "force-dynamic";

/** Behind nginx, `req.nextUrl.origin` is the internal bind address. */
function publicOrigin(req: NextRequest): string | null {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return req.nextUrl?.origin ?? null;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** A rate we could not compute is "n/a", never 0% — a missing measurement and
 *  a total failure must not read the same on a diagnostics card. */
function pct(v: number | null): string {
  return v === null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

function num(sp: URLSearchParams, key: string, dflt: number, max: number): number {
  const raw = Number.parseInt(sp.get(key) ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, max) : dflt;
}

export async function GET(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;

  const sp = req.nextUrl?.searchParams ?? new URL(req.url ?? "http://x/").searchParams;
  const windowMs = num(sp, "window_min", 60, 24 * 60) * 60_000;
  const staleMs = num(sp, "stale_min", 5, 120) * 60_000;

  const exporterConfigured = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const env = {
    environment: environmentName(),
    git_sha: gitSha(),
    service_version: serviceVersion(),
    // The PUBLIC origin, not the container's bind address. The first live
    // window printed `https://0.0.0.0:3000`, which is worse than useless in a
    // "which backend am I on" block — it is the one field a technician would
    // read to answer exactly that question.
    origin: publicOrigin(req),
    tenant_id: ctx.tenantId,
    recorder: {
      // The recorder writes the durable ledger row regardless of the exporter.
      // These are SEPARATE failures and the block says so, because an exporter
      // outage must never be read as "capture stopped".
      ledger: "on",
      exporter_configured: exporterConfigured,
      content_capture: captureContentEnabled(),
    },
  };

  let coverage: Awaited<ReturnType<typeof lifecycleCoverage>> | null = null;
  let unfinished: Awaited<ReturnType<typeof listUnfinishedTurns>> = [];
  // The INDEPENDENT count (093). `coverage` above is computed from the ledger,
  // so it can only describe turns the recorder wrote a start for; a turn whose
  // start never landed is absent from both its numerator and its denominator
  // and coverage reads 100%. `reconciliation` counts arrivals in a different
  // table, written before any of that machinery ran, so a lost start is a
  // NUMBER here instead of a silence there.
  let reconciliation: Awaited<ReturnType<typeof ingressReconciliation>> | null = null;
  let readError: string | null = null;
  try {
    coverage = await lifecycleCoverage({ tenantId: ctx.tenantId, windowMs, staleAfterMs: staleMs });
    unfinished = await listUnfinishedTurns({ tenantId: ctx.tenantId, staleAfterMs: staleMs, limit: 25 });
    reconciliation = await ingressReconciliation({
      tenantId: ctx.tenantId,
      windowMs,
      staleAfterMs: staleMs,
    });
  } catch (err) {
    // A coverage read that fails is itself a coverage fact — report it rather
    // than 500ing, so the caller can tell "no data" from "the query broke".
    readError = err instanceof Error ? err.message : String(err);
  }

  const copy_text = [
    "FactoryLM diagnostics",
    `environment   : ${env.environment}`,
    `origin        : ${env.origin ?? "unknown"}`,
    `build (sha)   : ${env.git_sha}`,
    `version       : ${env.service_version}`,
    `tenant        : ${env.tenant_id}`,
    `recorder      : ledger=on exporter=${exporterConfigured ? "configured" : "OFF"} content_capture=${env.recorder.content_capture}`,
    coverage
      ? `capture ${windowMs / 60000}m : started=${coverage.started} closed=${coverage.closed} orphaned=${coverage.orphaned} with_packet=${coverage.with_packet}`
      : `capture      : UNREADABLE (${readError})`,
    reconciliation
      ? `ingress ${windowMs / 60000}m: arrived=${reconciliation.arrived} accepted=${reconciliation.accepted} pre_accept_rejected=${reconciliation.pre_accept_rejections} LOST_STARTS=${reconciliation.lost_starts} no_response=${reconciliation.no_response_recorded}`
      : `ingress      : UNREADABLE (${readError})`,
    reconciliation
      ? `capture rate : starts=${pct(reconciliation.start_capture_rate)} closes=${pct(reconciliation.close_rate)}`
      : "capture rate : unknown",
    unfinished.length > 0
      ? `unfinished   : ${unfinished.map((u) => `${u.attemptId}@${u.ageMs}ms`).join(", ")}`
      : "unfinished   : none",
    `generated_at  : ${new Date().toISOString()}`,
  ].join("\n");

  return NextResponse.json({
    ...env,
    window_ms: windowMs,
    stale_after_ms: staleMs,
    coverage,
    // Coverage measured against something that is NOT the recorder (#3939).
    reconciliation,
    coverage_read_error: readError,
    unfinished,
    failure_counters: { ...lifecycleFailureCounters(), ...ingressFailureCounters() },
    copy_text,
  });
}
