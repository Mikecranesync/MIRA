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

    // The stale-turn reconciler (093). `endRoot` closes every exit path the
    // request reaches; a container that is SIGKILLed or redeployed mid-turn
    // reaches none of them, so those start records can only be closed from
    // outside the request. This is that outside. Flag-gated and OFF by default
    // — it is the sole writer of `abandoned`, and it earns each environment.
    const { turnReconcilerEnabled, turnReconcilerIntervalMs, turnReconcilerStaleMs } =
      await import("./capabilities/observability/config");
    if (turnReconcilerEnabled()) {
      const { startTurnReconciler } = await import("./capabilities/observability/turn-lifecycle");
      const stop = startTurnReconciler({
        intervalMs: turnReconcilerIntervalMs(),
        staleAfterMs: turnReconcilerStaleMs(),
      });
      process.once("SIGTERM", stop);
      console.log(
        JSON.stringify({
          service: "mira-hub",
          component: "turn-reconciler",
          event: "reconciler.started",
          interval_ms: turnReconcilerIntervalMs(),
          stale_after_ms: turnReconcilerStaleMs(),
        }),
      );
    }
  }
}
