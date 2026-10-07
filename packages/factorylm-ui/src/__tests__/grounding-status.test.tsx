/**
 * F004 (PR #4303) — the `grounding_status` part: one honest line about what a
 * turn's evidence was, and the explicit "Get general guidance (not from the
 * manual)" action that replaces any silent switch to general mode.
 *
 * The status line describes the ATTEMPT (searched / didn't find / couldn't
 * answer from it), never the manual's content: "the manual doesn't cover it"
 * is never claimed. The action is offered only where the server said so.
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/grounding-status.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { GroundingStatus, ShellFixture } from "@factorylm/interaction";
import { groundingStatusLine } from "../grounding-status";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.cleanup()); });

const ACTION = "Get general guidance (not from the manual)";

function render(hooks: Record<string, unknown> = {}, transformFixture?: (f: ShellFixture) => ShellFixture): HarnessView {
  const view = renderHarness({ surface: "mobile", fixture: "manual-limitation", hooks, ...(transformFixture ? { transformFixture } : {}) });
  views.push(view);
  return view;
}

/** Stamp fields onto the fixture's FIRST grounding_status part, as a host adapter would. */
function withStatus(patch: Partial<GroundingStatus>) {
  let done = false;
  return (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: {
      ...f.thread,
      turns: f.thread.turns.map((t) => ({
        ...t,
        parts: t.parts.map((p) => {
          if (p.type !== "grounding_status" || done) return p;
          done = true;
          return { ...p, ...patch };
        }),
      })),
    },
  });
}

const base: GroundingStatus = { outcome: "abstained_no_passages", manualSearched: true, fallbackOffered: false, isGeneralFallback: false };
const line = (patch: Partial<GroundingStatus>) => groundingStatusLine({ ...base, ...patch });

describe("groundingStatusLine — honest copy per outcome", () => {
  it("no-passage abstain says the SEARCH found nothing, never that the manual lacks it", () => {
    const l = line({ outcome: "abstained_no_passages" })!;
    expect(l).toContain("didn't find a passage in the selected manual");
    expect(l).toContain("doesn't mean the manual doesn't cover it");
  });
  it("refusal with passages says the passages were read but couldn't answer it", () => {
    const l = line({ outcome: "refused_with_passages" })!;
    expect(l).toContain("read passages from the selected manual");
    expect(l).toContain("doesn't mean the manual doesn't cover it");
  });
  it("refusal without passages after a real search reads like the no-passage abstain", () => {
    expect(line({ outcome: "refused_without_passages", manualSearched: true })).toBe(line({ outcome: "abstained_no_passages" }));
  });
  it("a refusal where no manual was searched (general mode) adds no manual claim", () => {
    expect(line({ outcome: "refused_without_passages", manualSearched: false })).toBeNull();
  });
  it("uncited answer with passages is labelled as not pointing at the manual", () => {
    expect(line({ outcome: "answered_uncited_with_passages" })).toContain("doesn't point to a passage in the selected manual");
  });
  it("library unavailable says it couldn't be reached — not that nothing matched", () => {
    const l = line({ outcome: "abstained_retrieval_unavailable" })!;
    expect(l).toContain("couldn't be reached");
    expect(l).not.toContain("didn't find");
  });
  it("a general answer requested from a failed turn says it is not from the manual", () => {
    expect(line({ outcome: "answered_without_manual", isGeneralFallback: true })).toBe("General guidance — not from your manual.");
  });
  it("controls: a cited answer, a plain general answer, a stop, a safety stop and a provider error add no line", () => {
    for (const outcome of ["answered_citation_linked", "answered_without_manual", "stopped", "safety_stop", "provider_error"] as const) {
      expect(line({ outcome })).toBeNull();
    }
  });
  it("no line ever claims the manual doesn't cover something", () => {
    const outcomes = [
      "safety_stop", "stopped", "provider_error", "abstained_no_passages", "abstained_retrieval_unavailable",
      "refused_with_passages", "refused_without_passages", "answered_citation_linked",
      "answered_uncited_with_passages", "answered_without_manual",
    ] as const;
    for (const outcome of outcomes) {
      for (const manualSearched of [true, false]) {
        const l = line({ outcome, manualSearched }) ?? "";
        expect(l.replace("doesn't mean the manual doesn't cover it", "")).not.toMatch(/manual (doesn't|does not) (cover|contain|have)/i);
      }
    }
  });
});

describe("grounding_status part — rendering and the explicit action", () => {
  it("renders the status line for an abstained turn", () => {
    const view = render();
    expect(view.container.querySelector("[data-part-type='grounding_status']")?.textContent)
      .toContain("didn't find a passage in the selected manual");
  });

  it("offers the action only where the server offered it, and calls the host with the turn id", () => {
    const calls: string[] = [];
    const view = render({ onRequestGeneralGuidance: (turnId: string) => { calls.push(turnId); } });
    const buttons = [...view.container.querySelectorAll("button")].filter((b) => b.textContent === ACTION);
    // The fixture has one offered turn and one not-offered turn.
    expect(buttons).toHaveLength(1);
    view.click(buttons[0]!);
    expect(calls).toEqual(["turn-manual-abstained"]);
    // Asked once: the button settles so a double tap cannot send twice.
    expect(view.buttonNamed(ACTION)).toBeNull();
    expect(view.container.textContent).toContain("Asking for general guidance");
  });

  it("control: without the server's offer there is no action, even with a host hook", () => {
    const view = render({ onRequestGeneralGuidance: () => {} }, withStatus({ fallbackOffered: false }));
    expect(view.buttonNamed(ACTION)).toBeNull();
  });

  it("an offer already used by a later turn shows no live action after reload", () => {
    const view = render({ onRequestGeneralGuidance: () => {} }, withStatus({ fallbackUsed: true }));
    expect(view.buttonNamed(ACTION)).toBeNull();
    expect(view.container.textContent).toContain("General guidance was requested below");
  });

  it("without a host hook the action is visibly unavailable, never a dead button", () => {
    const view = render();
    const b = view.buttonNamed(ACTION);
    expect(b).not.toBeNull();
    expect(b!.disabled).toBe(true);
    expect(b!.title).toContain("isn't available");
  });

  it("is disabled while the host is busy", () => {
    const view = render({ onRequestGeneralGuidance: () => {}, busy: true });
    expect(view.buttonNamed(ACTION)!.disabled).toBe(true);
  });

  it("the general answer requested from it is labelled as not from the manual", () => {
    const view = render();
    expect(view.container.textContent).toContain("General guidance — not from your manual.");
  });

  it("never renders the raw entry as an 'Unrecognized part'", () => {
    const view = render();
    expect(view.container.querySelector("[data-part-type='grounding_status']")).not.toBeNull();
    expect(view.container.textContent).not.toContain("Unrecognized part");
  });
});
