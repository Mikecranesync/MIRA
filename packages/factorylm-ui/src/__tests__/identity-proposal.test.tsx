/**
 * T2 (#4175, #4189) — the identity_proposal confirm card and the
 * manual_search_status progress line.
 *
 * Before this: `identity_proposal` and `manual_search_status` were not part
 * of the `InteractionPart` union, so a server frame of either kind fell
 * through `PartRenderer`'s `unknown` case and rendered as a raw
 * "Unrecognized part (preserved for inspection)" box — a technician has no
 * way to confirm a photographed part. See the `identity-proposal` fixture.
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/identity-proposal.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import { getFixture, IdentityAlreadyConfirmedError, type ConfirmIdentityResult, type IdentityProposal, type ShellFixture } from "@factorylm/interaction";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.cleanup()); });

function render(hooks: Record<string, unknown> = {}, transformFixture?: (f: ShellFixture) => ShellFixture): HarnessView {
  const view = renderHarness({ surface: "mobile", fixture: "identity-proposal", hooks, ...(transformFixture ? { transformFixture } : {}) });
  views.push(view);
  return view;
}

/** Light-review fix (PR #4195): stamp `priorOutcome` onto the fixture's
 *  `identity_proposal` part the same way a host adapter would, without
 *  adding a one-off named fixture to the shared catalog. */
function withPriorOutcome(outcome: "confirmed" | "superseded") {
  return (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: {
      ...f.thread,
      turns: f.thread.turns.map((t) => ({
        ...t,
        parts: t.parts.map((p) => (p.type === "identity_proposal" ? { ...p, priorOutcome: outcome } : p)),
      })),
    },
  });
}

describe("identity_proposal — the confirm card (#4175)", () => {
  it("asks whether this is the proposed machine, by name", () => {
    const view = render();
    expect(view.container.textContent).toContain("Is this a SMC SS5Y3-DUW01302?");
  });

  it("offers accessible ≥44px 'Use its manuals' / 'Not this' buttons", () => {
    const view = render({ onConfirmIdentity: async () => ({ manualReady: false }) });
    const use = view.buttonNamed("Use its manuals");
    const not = view.buttonNamed("Not this");
    expect(use).not.toBeNull();
    expect(not).not.toBeNull();
    // `.fl-shell button` sets min-block/inline-size: max(2.75rem, 44px) — proven
    // here by presence inside the shell rather than a computed-style read
    // (happy-dom does not apply CSS layout), matching this package's other
    // button-presence assertions (retry-capability.test.tsx).
    expect(use!.closest(".fl-shell")).not.toBeNull();
  });

  it("'Use its manuals' confirms via the host hook and shows the server's result", async () => {
    const calls: IdentityProposal[] = [];
    const result: ConfirmIdentityResult = { manualReady: true, message: "Confirmed — its manual is ready." };
    const view = render({
      onConfirmIdentity: async (p: IdentityProposal) => { calls.push(p); return result; },
    });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302" }]);
    expect(view.container.textContent).toContain("Confirmed — its manual is ready.");
    expect(view.buttonNamed("Use its manuals")).toBeNull();
    expect(view.buttonNamed("Not this")).toBeNull();
  });

  it("'Not this' rejects locally — no network call, no identity write (acceptance #2)", () => {
    let confirmCalls = 0;
    const view = render({ onConfirmIdentity: async () => { confirmCalls++; return { manualReady: false }; } });
    view.click(view.buttonNamed("Not this")!);
    expect(view.container.textContent).toContain("Not this machine.");
    expect(confirmCalls).toBe(0);
    expect(view.buttonNamed("Use its manuals")).toBeNull();
  });

  it("'Not this' works even with no host at all (always-available local dismiss)", () => {
    const view = render();
    expect(() => view.click(view.buttonNamed("Not this")!)).not.toThrow();
    expect(view.container.textContent).toContain("Not this machine.");
  });

  it("disables 'Use its manuals' honestly when no host can confirm (no dead button)", () => {
    const view = render();
    const use = view.buttonNamed("Use its manuals");
    expect(use).not.toBeNull();
    expect(use!.disabled).toBe(true);
  });

  it("shows a failure state when the host's confirm rejects", async () => {
    const view = render({ onConfirmIdentity: async () => { throw new Error("network"); } });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(view.container.textContent).toContain("Could not confirm. Try again.");
  });

  // Codex F2 (MEDIUM): a failed confirm used to remove BOTH buttons — the
  // technician had no way to retry or dismiss without remounting the card.
  it("keeps 'Use its manuals' and 'Not this' available after a failed confirm (retry)", async () => {
    const view = render({ onConfirmIdentity: async () => { throw new Error("network"); } });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(view.container.textContent).toContain("Could not confirm. Try again.");
    expect(view.buttonNamed("Use its manuals")).not.toBeNull();
    expect(view.buttonNamed("Not this")).not.toBeNull();
  });

  it("a retry after a failed confirm can succeed", async () => {
    let calls = 0;
    const view = render({
      onConfirmIdentity: async () => {
        calls += 1;
        if (calls === 1) throw new Error("network");
        return { manualReady: true, message: "Confirmed — its manual is ready." };
      },
    });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(view.container.textContent).toContain("Could not confirm. Try again.");
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toBe(2);
    expect(view.container.textContent).toContain("Confirmed — its manual is ready.");
    expect(view.buttonNamed("Use its manuals")).toBeNull();
    expect(view.buttonNamed("Not this")).toBeNull();
  });

  it("'Not this' still works (dismiss) after a failed confirm", async () => {
    const view = render({ onConfirmIdentity: async () => { throw new Error("network"); } });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    view.click(view.buttonNamed("Not this")!);
    expect(view.container.textContent).toContain("Not this machine.");
  });
});

// Light-review fix (PR #4195, "a stale proposal can overwrite a later
// confirmed identity"): a persisted card must settle itself against the
// notebook's CURRENT confirmed identity — never offering a live Confirm
// when it's stale.
describe("identity_proposal — settled against the notebook's CURRENT identity (#4195 light-review)", () => {
  it("renders already-confirmed, with no live buttons, when the adapter flags priorOutcome:'confirmed'", () => {
    const view = render({}, withPriorOutcome("confirmed"));
    expect(view.container.textContent).toContain("Confirmed.");
    expect(view.buttonNamed("Use its manuals")).toBeNull();
    expect(view.buttonNamed("Not this")).toBeNull();
  });

  it("renders settled/superseded, with no live Confirm or Reject, when the adapter flags priorOutcome:'superseded'", () => {
    const view = render({}, withPriorOutcome("superseded"));
    expect(view.container.textContent).toContain("A different machine is now confirmed for this notebook.");
    expect(view.buttonNamed("Use its manuals")).toBeNull();
    expect(view.buttonNamed("Not this")).toBeNull();
  });

  it("cheap-review r5 (#4195): a card already mounted settles when the adapter later flags priorOutcome:'superseded'", () => {
    // The same card stays mounted while the notebook's identity changes (a
    // second card in the same thread was confirmed). The host re-hydrates
    // with the new priorOutcome; the card must drop its live actions then,
    // not only on a fresh mount.
    const view = render();
    expect(view.buttonNamed("Use its manuals")).not.toBeNull();
    const base = getFixture("identity-proposal");
    view.dispatch({ type: "hydrate", data: { thread: withPriorOutcome("superseded")(base).thread } });
    expect(view.container.textContent).toContain("A different machine is now confirmed for this notebook.");
    expect(view.buttonNamed("Use its manuals")).toBeNull();
    expect(view.buttonNamed("Not this")).toBeNull();
  });

  it("a plain network failure still stays retryable (Codex F2 contract unchanged by this fix)", async () => {
    const view = render({ onConfirmIdentity: async () => { throw new Error("network"); } });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(view.container.textContent).toContain("Could not confirm. Try again.");
    expect(view.buttonNamed("Use its manuals")).not.toBeNull();
  });

  it("a live confirm refused with 409 (IdentityAlreadyConfirmedError) shows a terminal, named refusal — never the generic retryable failure", async () => {
    const view = render({
      onConfirmIdentity: async () => { throw new IdentityAlreadyConfirmedError("This machine is already confirmed as Rockwell Automation PowerFlex 525."); },
    });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(view.container.textContent).toContain("This machine is already confirmed as Rockwell Automation PowerFlex 525.");
    expect(view.container.textContent).not.toContain("Could not confirm. Try again.");
    expect(view.buttonNamed("Use its manuals")).toBeNull();
    expect(view.buttonNamed("Not this")).toBeNull();
  });

  it("a live 409 refusal with no host-supplied name falls back to a generic terminal message", async () => {
    const view = render({ onConfirmIdentity: async () => { throw new IdentityAlreadyConfirmedError(); } });
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(view.container.textContent).toContain("This machine is already confirmed.");
  });
});

describe("manual_search_status — searching progress (#4189)", () => {
  it('renders "Searching <maker>\'s documentation for <part>…" while running', () => {
    const view = render();
    expect(view.container.textContent).toContain("Searching SMC's documentation for SS5Y3-DUW01302…");
  });
});

describe("regression — an unknown frame still falls back to the inspection box (acceptance #4)", () => {
  it("still renders the preserved-for-inspection box for a kind this version doesn't know", () => {
    const view = render();
    expect(view.container.textContent).toContain("Unrecognized part (preserved for inspection)");
  });
});
