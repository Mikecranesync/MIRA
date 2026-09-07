import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { FIXTURE_IDS, getFixture } from "@factorylm/interaction";
import { fakeAdapter, renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];

afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function render(...args: Parameters<typeof renderHarness>): HarnessView {
  const view = renderHarness(...args);
  views.push(view);
  return view;
}

function turnElement(view: HarnessView, turnId: string): HTMLElement {
  const turn = view.container.querySelector<HTMLElement>(`[data-turn-id="${turnId}"]`);
  if (!turn) throw new Error(`turn ${turnId} must render`);
  return turn;
}

describe("conversation parts", () => {
  it("renders every fixture on every surface with each turn and part in order", () => {
    for (const fixture of FIXTURE_IDS) {
      for (const surface of ["public", "web", "mobile", "hub"] as const) {
        const view = render({ surface, fixture });
        const expected = getFixture(fixture).thread.turns;
        const turns = Array.from(view.container.querySelectorAll<HTMLElement>("[data-turn-id]"));

        expect(turns.map((turn) => turn.dataset.turnId)).toEqual(expected.map((turn) => turn.id));
        turns.forEach((turn, index) => {
          const parts = Array.from(turn.querySelectorAll<HTMLElement>("[data-part-type]"));
          expect(parts.map((part) => part.dataset.partType)).toEqual(expected[index].parts.map((part) => part.type));
        });
        expect(view.container.querySelector('[aria-label="Conversation"]')).not.toBeNull();
      }
    }
  });

  it("renders a safety stop without success chrome", () => {
    const view = render({ fixture: "safety-stop", surface: "web" });
    const turn = turnElement(view, "turn-safety-stop");

    expect(turn.querySelector('[role="alert"]')?.textContent).toMatch(/stop/i);
    expect(view.container.textContent).not.toMatch(/verified finding/i);
    expect(turn.textContent).not.toMatch(/completed/i);
    expect(turn.querySelector('[data-part-type="followups"]')).toBeNull();
  });

  it("labels live and recorded evidence distinctly", () => {
    const view = render({ fixture: "machine-evidence", surface: "hub" });
    const evidence = Array.from(view.container.querySelectorAll('[data-part-type="machine_evidence"]'));

    expect(evidence).toHaveLength(2);
    expect(evidence[0].textContent).toContain("LIVE");
    expect(evidence[0].textContent).not.toContain("RECORDED");
    expect(evidence[1].textContent).toContain("RECORDED");
    expect(evidence[1].textContent).not.toContain("LIVE");
    expect(view.container.textContent).toContain("LIVE");
    expect(view.container.textContent).toContain("RECORDED");
  });

  it("preserves unknown parts as an inspectable disclosure without crashing the thread", () => {
    const view = render({ fixture: "long-history", surface: "web" });
    const unknown = view.container.querySelector('[data-part-type="unknown"]');

    expect(unknown?.tagName).toBe("DETAILS");
    expect(unknown?.textContent).toContain("future_part");
    expect(view.container.querySelectorAll("[data-turn-id]")).toHaveLength(3);
  });

  it("keeps each historical turn's captured context when the active context differs", () => {
    const view = render({ fixture: "long-history", surface: "web" });

    expect(view.activeContext().machineId).toBe("machine-drive-b");
    expect(turnElement(view, "turn-history-one").dataset.contextMachineId).toBe("machine-drive-a");
    expect(turnElement(view, "turn-history-two").dataset.contextMachineId).toBe("machine-drive-a");
    expect(turnElement(view, "turn-history-three").dataset.contextMachineId).toBe("machine-drive-b");
    expect(turnElement(view, "turn-history-one").textContent).toContain("Drive A");
  });

  it("shows the evidence basis and offers follow-ups into the shared composer", () => {
    const view = render({ fixture: "general-ask", surface: "public" });

    expect(view.container.querySelector('[data-part-type="evidence_basis"]')?.textContent).toContain("General industrial guidance");
    const followup = view.buttonNamed("How is preload measured?");
    if (!followup) throw new Error("follow-up suggestion must be a button");
    view.click(followup);
    expect(view.outputs().draft).toBe("How is preload measured?");
  });

  it("opens a citation in the source viewer and closes it through the reducer", () => {
    const view = render({ fixture: "grounded-answer", surface: "web" });
    const citation = view.container.querySelector<HTMLButtonElement>('[data-part-type="source"] button, button[data-part-type="source"]');
    if (!citation) throw new Error("citation must be a button");

    expect(view.container.querySelector('[aria-label="Source viewer"]')).toBeNull();
    view.click(citation);
    const viewer = view.container.querySelector('[aria-label="Source viewer"]');
    expect(viewer?.getAttribute("role")).toBe("dialog");
    expect(viewer?.textContent).toContain("SINAMICS G120 Operating Instructions");
    expect(viewer?.textContent).toContain("Chapter 8, F30001");
    const close = view.buttonNamed("Close source viewer");
    if (!close) throw new Error("source viewer must be closable");
    view.click(close);
    expect(view.container.querySelector('[aria-label="Source viewer"]')).toBeNull();
  });

  it("renders attachment kinds and sync status", () => {
    const view = render({ fixture: "attachments", surface: "mobile" });
    const attachments = Array.from(view.container.querySelectorAll<HTMLElement>('[data-part-type="attachment"]'));

    expect(attachments.map((item) => item.dataset.attachmentStatus)).toEqual(["ready", "ready", "queued"]);
    expect(attachments[0].textContent).toContain("drive-a-nameplate.jpg");
    expect(attachments[2].textContent).toMatch(/queued/i);
    expect(view.container.querySelector('[aria-label="Sync status"]')?.textContent).toMatch(/syncing/i);
  });

  it("offers retry only for a retryable failed turn and hands it to the host, which owns the re-send", () => {
    const calls: string[] = [];
    const hooks = { onRetry: (turnId: string) => calls.push(turnId) };
    const view = render({ fixture: "error-retry", surface: "web", hooks });
    const retry = view.buttonNamed("Retry");
    if (!retry) throw new Error("retryable error must offer Retry");

    view.click(retry);
    expect(calls).toEqual(["turn-error-retry"]);
    // Host-owned: the shell does not also mark a mock "Retry requested" state.
    expect(view.outputs().retryTarget).toBe("");
    expect(render({ fixture: "safety-stop", surface: "web", hooks }).buttonNamed("Retry")).toBeNull();
  });

  it("shows the offline state honestly", () => {
    const view = render({ fixture: "offline-sync", surface: "mobile" });
    const status = view.container.querySelector('[aria-label="Sync status"]');

    expect(status?.textContent).toMatch(/offline/i);
    expect(status?.textContent).toContain("1");
    expect(status?.textContent).toContain("retained locally");
  });
});

describe("Ask and Work share one shell", () => {
  it("renders the Diagnostic Run as a structured card inside the same conversation", () => {
    const view = render({ fixture: "work-run", surface: "web" });
    const run = view.container.querySelector('[aria-label="Diagnostic Run"]');
    if (!run) throw new Error("Work mode must render the run card");

    expect(view.outputs().mode).toBe("work");
    expect(run.textContent).toContain("Determine whether Drive A's F30001 is caused by supply or braking conditions.");
    expect(run.textContent).toContain("Verify drive identity");
    expect(run.textContent).toContain("Inspect supply and braking conditions");
    expect(run.textContent).toContain("Record observed conditions");
    expect(view.container.querySelectorAll('[aria-label="Conversation"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[aria-label="Composer"]')).toHaveLength(1);
    expect(view.container.querySelector('[data-part-type="finding"]')?.textContent).toMatch(/candidate/i);
    expect(view.container.querySelector('[data-part-type="finding"]')?.textContent).not.toMatch(/verified finding/i);
    expect(view.container.querySelector('[data-part-type="tool_call"]')?.textContent).toContain("Inspect recorded evidence");
    expect(view.container.querySelector('[data-part-type="artifact"]')?.textContent).toContain("Shift handoff");
  });

  it("switches Ask and Work through the reducer without a second chat tree", () => {
    const view = render({ fixture: "machine-ask", surface: "mobile" });
    const work = view.buttonNamed("Work");
    const ask = view.buttonNamed("Ask");
    if (!work || !ask) throw new Error("mode switch must render on every surface");

    expect(ask.getAttribute("aria-pressed")).toBe("true");
    expect(view.container.querySelector('[aria-label="Diagnostic Run"]')).toBeNull();
    view.click(work);
    expect(view.outputs().mode).toBe("work");
    expect(work.getAttribute("aria-pressed")).toBe("true");
    expect(view.container.querySelectorAll('[aria-label="Conversation"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[aria-label="Composer"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-turn-id]')).toHaveLength(2);
    expect(view.container.querySelector('[aria-label="Diagnostic Run"]')).toBeNull();
    expect(view.container.textContent).toMatch(/no diagnostic run/i);
  });

  it("shares an artifact through the platform adapter", async () => {
    const adapter = fakeAdapter({ share: "shared" });
    const view = render({ fixture: "work-run", surface: "mobile", adapter });
    const share = view.buttonNamed("Share Shift handoff");
    if (!share) throw new Error("artifact must offer share");

    view.click(share);
    await view.flush();
    expect(adapter.calls).toEqual(["shareArtifact:artifact-handoff"]);
    expect(view.container.querySelector('[data-part-type="artifact"]')?.textContent).toMatch(/shared/i);
  });

  it("reports a failed artifact share and keeps the control retryable", async () => {
    const adapter = fakeAdapter({ reject: new Error("share sheet unavailable") });
    const view = render({ fixture: "work-run", surface: "mobile", adapter });
    const share = view.buttonNamed("Share Shift handoff");
    if (!share) throw new Error("artifact must offer share");

    view.click(share);
    expect(share.disabled).toBe(true);
    await view.flush();
    const artifact = view.container.querySelector('[data-part-type="artifact"]');
    expect(artifact?.querySelector('[role="alert"]')?.textContent).toMatch(/share failed/i);
    expect(share.disabled).toBe(false);
    view.click(share);
    await view.flush();
    expect(adapter.calls).toEqual(["shareArtifact:artifact-handoff", "shareArtifact:artifact-handoff"]);
  });

  it("hydrates live thread data without resetting the shell's UI state", () => {
    const view = render({ fixture: "grounded-answer", surface: "mobile" });
    const shell = view.container.querySelector<HTMLElement>(".fl-shell");
    if (!shell) throw new Error("shell is required");
    view.click(view.buttonNamed("Close navigation") ?? new Error("Close navigation is required") as never);
    view.type(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask MIRA"]') ?? new Error("Ask MIRA is required") as never, "keep me");
    const base = getFixture("grounded-answer").thread;
    const live = {
      ...base,
      turns: [...base.turns, { ...base.turns[0], id: "turn-live-2", parts: [{ type: "identity_dispute" as const }, { type: "text" as const, text: "Live answer." }] }],
    };

    view.dispatch({ type: "hydrate", data: { thread: live } });
    expect(view.container.querySelectorAll("[data-turn-id]")).toHaveLength(2);
    expect(view.container.querySelector('[data-part-type="identity_dispute"]')?.getAttribute("role")).toBe("status");
    expect(view.container.querySelector('[data-part-type="identity_dispute"]')?.textContent).toMatch(/identity not confirmed/i);
    expect(view.outputs().draft).toBe("keep me");
    expect(shell.dataset.navigationVisible).toBe("false");

    view.dispatch({ type: "hydrate", data: { thread: { ...live, id: "thread-other", turns: [] } } });
    expect(view.outputs().draft).toBe("");
    expect(view.container.querySelectorAll("[data-turn-id]")).toHaveLength(0);
  });

  it("uses theme tokens only in the conversation stylesheet", () => {
    const css = readFileSync(new URL("../conversation.css", import.meta.url), "utf8");

    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgba?\(/i);
    expect(css).toMatch(/--fl-workspace-/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
