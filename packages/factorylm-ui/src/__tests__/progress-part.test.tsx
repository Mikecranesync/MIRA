/**
 * #4687 — the `progress` part: what a technician sees while the server is still working.
 *
 * The server reports a stage only when it really starts (mira-hub capabilities/chat-progress.ts);
 * this part renders it as plain language. It must never show the wire identifier
 * ("searching_documentation") and must be announced as a live status.
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/progress-part.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import { PROGRESS_STAGES, type ProgressStage, type ShellFixture } from "@factorylm/interaction";
import { progressLabel } from "../parts";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.cleanup()); });

function withProgress(stage: ProgressStage) {
  return (f: ShellFixture): ShellFixture => {
    const last = f.thread.turns.at(-1)!;
    return {
      ...f,
      thread: {
        ...f.thread,
        turns: [...f.thread.turns, { ...last, id: "progress-turn", role: "assistant", lifecycle: "running", parts: [{ type: "progress", stage }] }],
      },
    };
  };
}

describe("progressLabel", () => {
  it("has technician wording for every stage, never a raw identifier", () => {
    for (const s of PROGRESS_STAGES) {
      const label = progressLabel(s);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("_");
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });
  it("says what is happening in plain words", () => {
    expect(progressLabel("searching_documentation")).toBe("Searching the manuals…");
    expect(progressLabel("checking_answer")).toBe("Checking the answer…");
  });
  it("claims nothing a stage does not guarantee (live staging 2026-10-25: a general turn read 'against your manuals')", () => {
    // Every stage runs on general turns too (no machine, no uploaded manuals), and the search may be the
    // manufacturer library rather than the technician's own files. No label may assert ownership or a source.
    for (const s of PROGRESS_STAGES) {
      expect(progressLabel(s)).not.toMatch(/\byour\b|against/i);
    }
  });
});

for (const surface of ["classic", "assistant"] as const) {
  describe(`progress part — ${surface} renderer`, () => {
    it("renders the stage as a live status line in plain words", () => {
      const view = renderHarness({ surface: "mobile", fixture: "identity-proposal", conversationSurface: surface, transformFixture: withProgress("searching_documentation") });
      views.push(view);
      const el = view.container.querySelector('[data-part-type="progress"]');
      expect(el).not.toBeNull();
      expect(el!.getAttribute("role")).toBe("status");
      expect(el!.textContent).toBe("Searching the manuals…");
      expect(view.container.textContent).not.toContain("searching_documentation");
      // The fixture carries a deliberate future-kind part elsewhere; the progress turn itself
      // must not fall through to the "unknown" box.
      const turn = el!.closest("[data-turn-id], article, li") ?? el!.parentElement!;
      expect(turn.textContent).not.toContain("Unrecognized part");
    });
  });
}
