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

const base: GroundingStatus = { outcome: "abstained_no_passages", manualSearched: true, searchScope: "selected_manual", passagesFrom: "selected_manual", fallbackOffered: false, isGeneralFallback: false };
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
    expect(line({ outcome: "refused_without_passages", manualSearched: false, searchScope: "none", passagesFrom: null })).toBeNull();
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

describe("groundingStatusLine — never claims a search that did not happen (Codex #4303 r1 F1)", () => {
  const noSearch = { manualSearched: false, searchScope: "none", passagesFrom: null } as const;
  it("an abstention with no retrieval at all (the service decline) says nothing about a search", () => {
    expect(line({ outcome: "abstained_no_passages", ...noSearch })).toBeNull();
    expect(line({ outcome: "refused_without_passages", ...noSearch })).toBeNull();
  });
  it("a shared-library search that found nothing names the library, not a selected manual", () => {
    const l = line({ outcome: "abstained_no_passages", searchScope: "shared_library", passagesFrom: null })!;
    expect(l).toContain("shared manual library");
    expect(l).not.toContain("selected manual");
    expect(l).toContain("doesn't mean");
  });
  it("passages read from the shared library are attributed to it", () => {
    const refused = line({ outcome: "refused_with_passages", searchScope: "selected_manual", passagesFrom: "shared_library" })!;
    expect(refused).toContain("shared manual library");
    expect(refused).not.toContain("selected manual");
    const uncited = line({ outcome: "answered_uncited_with_passages", searchScope: "shared_library", passagesFrom: "shared_library" })!;
    expect(uncited).toContain("shared manual library");
    expect(uncited).not.toContain("selected manual");
  });
  it("control: a selected-manual search keeps the selected-manual wording", () => {
    expect(line({ outcome: "abstained_no_passages" })).toContain("selected manual");
    expect(line({ outcome: "refused_with_passages" })).toContain("selected manual");
  });
});

describe("general-guidance action settles when the request finishes (Codex #4303 r1 F2)", () => {
  const ASKING = "Asking for general guidance";
  it("a completed request replaces 'Asking…' with a settled line and no live action", async () => {
    let finish: (ok: boolean) => void = () => {};
    const view = render({ onRequestGeneralGuidance: () => new Promise<boolean>((r) => { finish = r; }) });
    view.click(view.buttonNamed(ACTION)!);
    expect(view.container.textContent).toContain(ASKING);
    expect(view.buttonNamed(ACTION)).toBeNull(); // no double send while in flight
    finish(true); await view.flush();
    expect(view.container.textContent).not.toContain(ASKING);
    expect(view.container.textContent).toContain("General guidance was requested below");
    expect(view.buttonNamed(ACTION)).toBeNull();
  });
  it("a failed request drops 'Asking…', says so, and offers the action again", async () => {
    let finish: (ok: boolean) => void = () => {};
    const view = render({ onRequestGeneralGuidance: () => new Promise<boolean>((r) => { finish = r; }) });
    view.click(view.buttonNamed(ACTION)!);
    finish(false); await view.flush();
    expect(view.container.textContent).not.toContain(ASKING);
    expect(view.container.textContent).toContain("Couldn't get general guidance");
    expect(view.buttonNamed(ACTION)).not.toBeNull();
  });
  it("a rejected request is treated as a failure, never left 'Asking…'", async () => {
    let fail: (e: unknown) => void = () => {};
    const view = render({ onRequestGeneralGuidance: () => new Promise<boolean>((_r, j) => { fail = j; }) });
    view.click(view.buttonNamed(ACTION)!);
    fail(new Error("network")); await view.flush();
    expect(view.container.textContent).not.toContain(ASKING);
    expect(view.buttonNamed(ACTION)).not.toBeNull();
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
