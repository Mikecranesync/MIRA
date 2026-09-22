/**
 * Next.js instrumentation hook (App Router). Runs once per runtime instance
 * before the app starts serving. See
 * docs/architecture/observability/2026-09-22-turn-flight-recorder.md §6-7.
 *
 * OTel's Node SDK only makes sense in the Node runtime — the edge runtime
 * has no `process`/net stack for it to instrument — so the Node-only
 * bootstrap is a dynamic import gated on `NEXT_RUNTIME`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { shutdownTelemetry } = await import("./instrumentation.node");
    // Flush any queued spans before the container is killed on redeploy.
    process.once("SIGTERM", () => {
      void shutdownTelemetry();
    });
  }
}
