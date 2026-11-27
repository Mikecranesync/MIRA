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

describe("manual download handoff", () => {
  it.each(["javascript:alert(1)", "http://example.com/manual", "https://example.com/\\manual"])("does not render an unsafe manual link: %s", (manualUrl) => {
    const view = render({}, (f) => ({ ...f, thread: { ...f.thread, turns: f.thread.turns.map(t => ({ ...t, parts: t.parts.map(p => p.type === "manual_search_status" ? { ...p, running: false, manualUrl } : p) })) } }));
    expect(view.container.querySelector('[data-part-type="manual_search_status"] a')).toBeNull();
  });
  it("offers a tappable download page without making it a citation", () => {
    const url = "https://www.keyence.com/download/download/confirmation/?dlAssetId=AS_164319";
    const view = render({}, (f) => ({ ...f, thread: { ...f.thread, turns: f.thread.turns.map(t => ({ ...t, parts: t.parts.map(p => p.type === "manual_search_status" ? { ...p, running: false, message: "I couldn't download it. Upload it after downloading.", manualUrl: url } : p) })) } }));
    const link = view.container.querySelector('[data-part-type="manual_search_status"] a');
    expect(link?.getAttribute("href")).toBe(url);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.textContent).toContain("Open website to find the manual");
  });
});

describe("regression — an unknown frame still falls back to the inspection box (acceptance #4)", () => {
  it("still renders the preserved-for-inspection box for a kind this version doesn't know", () => {
    const view = render();
    expect(view.container.textContent).toContain("Unrecognized part (preserved for inspection)");
  });
});

function withOfferedNumber(offeredNumber: string, outcome?: "confirmed" | "superseded") {
  return (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: {
      ...f.thread,
      turns: f.thread.turns.map((t) => ({
        ...t,
        parts: t.parts.map((p) => (p.type === "identity_proposal" ? { ...p, offeredNumber, ...(outcome ? { priorOutcome: outcome } : {}) } : p)),
      })),
    },
  });
}
const box = (view: HarnessView) => view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');

describe("identity_proposal — the offered order number (#6085)", () => {
  it("shows the offered number beside a box that starts unticked", () => {
    const view = render({ onConfirmIdentity: async () => ({ manualReady: false }) }, withOfferedNumber("SS5Y3-DUW01302-A"));
    expect(view.container.textContent).toContain("SS5Y3-DUW01302-A is this machine's number");
    expect(box(view)).not.toBeNull();
    expect(box(view)!.checked).toBe(false);
  });

  it("an unticked confirm sends no number", async () => {
    const calls: IdentityProposal[] = [];
    const view = render({ onConfirmIdentity: async (p: IdentityProposal) => { calls.push(p); return { manualReady: false }; } }, withOfferedNumber("SS5Y3-DUW01302-A"));
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302" }]);
  });

  it("a ticked confirm sends the number", async () => {
    const calls: IdentityProposal[] = [];
    const view = render({ onConfirmIdentity: async (p: IdentityProposal) => { calls.push(p); return { manualReady: false }; } }, withOfferedNumber("SS5Y3-DUW01302-A"));
    view.click(box(view)!);
    await view.flush();
    expect(box(view)!.checked).toBe(true);
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302", confirmedNumber: "SS5Y3-DUW01302-A" }]);
  });

  it("a settled card shows no box", () => {
    const view = render({}, withOfferedNumber("SS5Y3-DUW01302-A", "confirmed"));
    expect(box(view)).toBeNull();
    expect(view.container.textContent).not.toContain("is this machine's number");
  });

  it("control: a card without an offered number renders exactly as before", () => {
    const view = render({ onConfirmIdentity: async () => ({ manualReady: false }) });
    expect(box(view)).toBeNull();
    expect(view.container.textContent).not.toContain("is this machine's number");
  });
});

// #6104 r1 F2: the host replaces the streamed card with its saved copy under a new turn id, which
// mounts a new card. The tick is kept by the host's tickKey (the send's request id) together with
// the card's identity and offered number; without a key the card starts unticked, as before.
function withCard(fields: { offeredNumber: string; tickKey?: string }) {
  return (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: {
      ...f.thread,
      turns: f.thread.turns.map((t) => ({ ...t, parts: t.parts.map((p) => (p.type === "identity_proposal" ? { ...p, ...fields } : p)) })),
    },
  });
}
const confirmHooks = (calls: IdentityProposal[]) => ({ onConfirmIdentity: async (p: IdentityProposal) => { calls.push(p); return { manualReady: false }; } });
async function tickAndReplace(first: { offeredNumber: string; tickKey?: string }, second: { offeredNumber: string; tickKey?: string }) {
  const firstView = render(confirmHooks([]), withCard(first));
  firstView.click(box(firstView)!);
  await firstView.flush();
  expect(box(firstView)!.checked).toBe(true); // precondition: the first card was ticked
  firstView.cleanup();
  views.splice(views.indexOf(firstView), 1);
  const calls: IdentityProposal[] = [];
  return { view: render(confirmHooks(calls), withCard(second)), calls };
}

describe("identity_proposal: a tick survives the saved card replacing the streamed one (#6104 r1 F2)", () => {
  it("the saved copy of a ticked card is ticked, and its confirm sends the number", async () => {
    const card = { offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-f2-same" };
    const { view, calls } = await tickAndReplace(card, card);
    expect(box(view)!.checked).toBe(true);
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302", confirmedNumber: "SS5Y3-DUW01302-A" }]);
  });

  it("control: a card from another send starts unticked", async () => {
    const { view } = await tickAndReplace({ offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-f2-a" }, { offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-f2-b" });
    expect(box(view)!.checked).toBe(false);
  });

  it("control: the same send offering another number starts unticked", async () => {
    const { view } = await tickAndReplace({ offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-f2-c" }, { offeredNumber: "SS5Y3-DUW01302-B", tickKey: "req-f2-c" });
    expect(box(view)!.checked).toBe(false);
  });

  it("control: without a tick key a new card starts unticked, as before", async () => {
    const { view } = await tickAndReplace({ offeredNumber: "SS5Y3-DUW01302-A" }, { offeredNumber: "SS5Y3-DUW01302-A" });
    expect(box(view)!.checked).toBe(false);
  });

  it("unticking is kept too", async () => {
    const card = { offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-f2-untick" };
    const firstView = render(confirmHooks([]), withCard(card));
    firstView.click(box(firstView)!);
    await firstView.flush();
    firstView.click(box(firstView)!);
    await firstView.flush();
    expect(box(firstView)!.checked).toBe(false); // precondition
    firstView.cleanup();
    views.splice(views.indexOf(firstView), 1);
    expect(box(render(confirmHooks([]), withCard(card)))!.checked).toBe(false);
  });

  // Codex r1 F2 remediation: the choice is for one offer; a card whose offer changes in place
  // (same turn, re-delivered by the host) starts that offer unticked.
  const redeliver = (view: HarnessView, fields: { offeredNumber: string; tickKey?: string }) =>
    view.dispatch({ type: "hydrate", data: { thread: withCard(fields)(getFixture("identity-proposal")).thread } });

  it("the same card offering another number in place is unticked, and its confirm sends no number", async () => {
    const calls: IdentityProposal[] = [];
    const card = { offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-f2-inplace" };
    const view = render(confirmHooks(calls), withCard(card));
    view.click(box(view)!);
    await view.flush();
    expect(box(view)!.checked).toBe(true); // precondition
    redeliver(view, { ...card, offeredNumber: "SS5Y3-DUW01302-B" });
    await view.flush();
    expect(box(view)!.checked).toBe(false);
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302" }]);
  });

  it("without a tick key, the same card offering another number in place is unticked", async () => {
    const view = render(confirmHooks([]), withCard({ offeredNumber: "SS5Y3-DUW01302-A" }));
    view.click(box(view)!);
    await view.flush();
    expect(box(view)!.checked).toBe(true); // precondition
    redeliver(view, { offeredNumber: "SS5Y3-DUW01302-B" });
    await view.flush();
    expect(box(view)!.checked).toBe(false);
  });

  it("control: the same card re-delivered with the same offer stays ticked", async () => {
    const card = { offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-f2-redeliver" };
    const view = render(confirmHooks([]), withCard(card));
    view.click(box(view)!);
    await view.flush();
    redeliver(view, card);
    await view.flush();
    expect(box(view)!.checked).toBe(true);
  });
});

// #6104 r1 F2 on the surface the Hub and mobile render ("assistant"): assistant-ui keeps
// components by position, so the saved copy usually lands in the streamed card's slot. The tick
// must follow the send, not the slot: kept when the card moves, dropped when another send's card
// takes the slot.
describe("identity_proposal on the assistant surface: the tick follows the send (#6104 r1 F2)", () => {
  type CardFields = { offeredNumber: string; tickKey?: string };
  const isCardTurn = (t: ShellFixture["thread"]["turns"][number]) => t.parts.some((p) => p.type === "identity_proposal");
  const threadWith = (fields: CardFields, opts: { cardTurnId?: string; before?: number } = {}) => {
    const base = withCard(fields)(getFixture("identity-proposal")).thread;
    const turns = base.turns.map((t) => (isCardTurn(t) && opts.cardTurnId ? { ...t, id: opts.cardTurnId } : t));
    const filler = Array.from({ length: opts.before ?? 0 }, (_, i) => ({
      ...turns[0]!, id: `filler-${i}`, role: (i % 2 ? "assistant" : "user") as "assistant" | "user", parts: [{ type: "text" as const, text: `Earlier message ${i}` }],
    }));
    return { ...base, turns: [...filler, ...turns] };
  };
  function renderAssistant(fields: CardFields, calls: IdentityProposal[] = []) {
    const view = renderHarness({ surface: "mobile", fixture: "identity-proposal", conversationSurface: "assistant", hooks: confirmHooks(calls), transformFixture: withCard(fields) });
    views.push(view);
    return view;
  }
  async function tick(view: HarnessView) {
    view.click(box(view)!);
    await view.flush();
    expect(box(view)!.checked).toBe(true); // precondition
  }
  const swap = async (view: HarnessView, thread: ShellFixture["thread"]) => {
    view.dispatch({ type: "hydrate", data: { thread } });
    await view.flush();
  };

  it("control: the saved copy in the same slot under a new turn id stays ticked", async () => {
    const card = { offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-as-same" };
    const view = renderAssistant(card);
    await tick(view);
    await swap(view, threadWith(card, { cardTurnId: "row-saved-a" }));
    expect(box(view)!.checked).toBe(true);
  });

  it("the saved copy moved to a new slot stays ticked, and its confirm sends the number", async () => {
    const calls: IdentityProposal[] = [];
    const card = { offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-as-moved" };
    const view = renderAssistant(card, calls);
    await tick(view);
    await swap(view, threadWith(card, { cardTurnId: "row-moved-a", before: 2 }));
    expect(box(view)!.checked).toBe(true);
    view.click(view.buttonNamed("Use its manuals")!);
    await view.flush();
    expect(calls).toEqual([{ manufacturer: "SMC", model: "SS5Y3-DUW01302", confirmedNumber: "SS5Y3-DUW01302-A" }]);
  });

  it("another send's card taking the slot starts unticked", async () => {
    const view = renderAssistant({ offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-as-first" });
    await tick(view);
    await swap(view, threadWith({ offeredNumber: "SS5Y3-DUW01302-A", tickKey: "req-as-other" }, { cardTurnId: "row-other-a" }));
    expect(box(view)!.checked).toBe(false);
  });
});

