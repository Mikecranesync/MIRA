/**
 * F2 (fleet-001-review, 2026-09-06) — FAILING REGRESSION TESTS.
 *
 * The Retry affordance must reflect a capability the HOST actually provides.
 *
 * `parts.tsx` renders the Retry button on `error.retryable && turn.lifecycle
 * === "failed"` alone — it never consults whether a host hook exists. The
 * mobile host only passes `onRetry` when `canRetry` (`UnifiedChat.tsx:116`),
 * and `canRetry = Boolean(failedSend) && !busy` (`NotebookScreen.tsx:709/730`)
 * is SESSION state that is null after a reload.
 *
 * So a persisted failed turn, reopened on a fresh session, still renders a
 * Retry button. Clicking it fell through to the reducer's mock retry action
 * (since removed with its state field in Slice C), which was read nowhere
 * outside this package — so the label flipped to "Retry requested"
 * and NO request is ever sent. A dead control that reports success, on a real
 * failure.
 *
 * Fix (mira-97, Slice A #3643): render Retry only when `hooks?.onRetry` is a
 * function, so retry is a host-owned capability rather than a render-time
 * guess. Covers hooks omitted entirely as well as hooks without onRetry — the
 * omitted case is what a bare `<FactoryLMShell>` mount (the lab before it
 * supplied a host hook) produced: an enabled Retry that only set the reducer's
 * mock retry marker (Codex review, 2026-09-07).
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/retry-capability.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

const retryButton = (view: HarnessView) =>
  Array.from(view.container.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim().startsWith("Retry"),
  ) ?? null;

describe("F2 — Retry is a host capability, not a render-time guess", () => {
  it("renders Retry when the host DOES provide onRetry (the working case)", () => {
    const calls: string[] = [];
    const view = render({
      surface: "mobile",
      fixture: "error-retry",
      hooks: { onRetry: (turnId: string) => calls.push(`retry:${turnId}`), busy: false },
    });

    const button = retryButton(view);
    expect(button).not.toBeNull();
    view.click(button as HTMLButtonElement);
    expect(calls).toEqual(["retry:turn-error-retry"]);
  });

  it("does NOT render Retry when the host provides no onRetry", () => {
    // Exactly the post-reload state: the turn is persisted `failed`, but this
    // session has no failedSend, so the mobile host passes no onRetry.
    const view = render({ surface: "mobile", fixture: "error-retry", hooks: { busy: false } });
    expect(retryButton(view)).toBeNull();
  });

  it("does NOT render Retry when hooks are omitted entirely (no host at all)", () => {
    const view = render({ surface: "mobile", fixture: "error-retry" });
    expect(retryButton(view)).toBeNull();
  });

  it("never claims 'Retry requested' when no host hook can service the request", () => {
    // The honesty failure this is really about: if the button IS rendered
    // without a hook, clicking it must not report success to the technician.
    const view = render({ surface: "mobile", fixture: "error-retry", hooks: { busy: false } });
    const button = retryButton(view);
    if (button) {
      view.click(button);
      expect(button.textContent ?? "").not.toContain("Retry requested");
    }
    expect(button).toBeNull();
  });

});

/**
 * SEPARATE, and deliberately not folded into F2 above: the intended fix
 * ("render Retry only when `hooks?.onRetry` is present") will NOT turn this
 * one green, because here the host DOES supply onRetry — it is merely busy.
 *
 * Today the shell ignores `hooks.busy` for this control. The mobile host
 * compensates upstream (`canRetry = Boolean(failedSend) && !busy`), so this is
 * NOT a live defect for that host — it is missing defence-in-depth that would
 * bite a future host which forgets to gate. Flagged for a decision rather than
 * asserted as a bug; delete it if you'd rather keep the capability contract
 * purely host-owned.
 */
describe("F2b — OPTIONAL hardening, not closed by the intended fix", () => {
  it("does not offer Retry while the host reports busy", () => {
    const view = render({
      surface: "mobile",
      fixture: "error-retry",
      hooks: { onRetry: () => {}, busy: true },
    });
    const button = retryButton(view);
    expect(button === null || button.disabled).toBe(true);
  });
});
