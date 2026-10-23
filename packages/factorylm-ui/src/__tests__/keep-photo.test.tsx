/**
 * "Keep on this machine" on the photo-observation card.
 *
 * A photo attached in one conversation was invisible to the next conversation
 * on the same machine: the technician had to send the print again. Keeping it
 * makes it one of the machine's sources. The button appears only when the host
 * can keep photos, and the card never claims the reading itself is confirmed.
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/keep-photo.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import { act } from "react";
import type { HostHooks } from "../parts";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.cleanup()); });

function render(hooks?: HostHooks): HarnessView {
  const view = renderHarness({ surface: "web", fixture: "machine-evidence", ...(hooks ? { hooks } : {}) });
  views.push(view);
  return view;
}

function photoCard(view: HarnessView): HTMLElement {
  const card = view.container.querySelector<HTMLElement>('[data-part-type="visual_observation"]');
  if (!card) throw new Error("no visual_observation card rendered");
  return card;
}

const keepButton = (card: HTMLElement) =>
  Array.from(card.querySelectorAll("button")).find((b) => b.textContent === "Keep on this machine") ?? null;

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("keep a photo on its machine", () => {
  it("offers nothing when the host cannot keep photos", () => {
    const card = photoCard(render());
    expect(keepButton(card)).toBeNull();
  });

  it("keeps the card's own photo and then says it is kept, with the reading still unconfirmed", async () => {
    const kept: string[] = [];
    const view = render({ onKeepPhoto: async (fileId) => { kept.push(fileId); } });
    const card = photoCard(view);
    const fileId = card.getAttribute("data-file-id");
    expect(fileId).toBeTruthy();

    view.click(keepButton(card)!);
    await settle();

    expect(kept).toEqual([fileId!]);
    expect(keepButton(photoCard(view))).toBeNull();
    const status = photoCard(view).querySelector('[role="status"]')?.textContent ?? "";
    expect(status).toContain("Kept on this machine");
    expect(status).toContain("still unconfirmed");
  });

  it("leaves the button in place to retry when keeping fails", async () => {
    const view = render({ onKeepPhoto: async () => { throw new Error("503"); } });
    view.click(keepButton(photoCard(view))!);
    await settle();

    const card = photoCard(view);
    expect(card.querySelector('[role="alert"]')?.textContent).toContain("Could not keep this photo");
    expect(keepButton(card)).not.toBeNull();
    expect(card.querySelector('[role="status"]')).toBeNull();
  });

  it("shows a photo the machine already keeps as kept, without a button", () => {
    const card = photoCard(render({ onKeepPhoto: async () => {}, isPhotoKept: () => true }));
    expect(keepButton(card)).toBeNull();
    expect(card.querySelector('[role="status"]')?.textContent).toContain("Kept on this machine");
  });
});
