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


describe("saved photo with stale source scope", () => {
  it("keeps the warning even if the host knows it is saved, and retries only refresh", async () => {
    let writes = 0;
    let refreshes = 0;
    let saved = false;
    const view = render({
      onKeepPhoto: async () => { writes++; saved = true; return "refresh_pending"; },
      isPhotoKept: () => saved,
      onRefreshPhotoScope: async () => { refreshes++; return refreshes > 1; },
    });
    view.click(keepButton(photoCard(view))!);
    await settle();
    const retry = () => Array.from(photoCard(view).querySelectorAll("button")).find(b => b.textContent === "Refresh sources");
    expect(photoCard(view).querySelector('[role="alert"]')?.textContent).toContain("Photo saved");
    expect(photoCard(view).textContent).not.toContain("New conversations here can use it");
    expect(keepButton(photoCard(view))).toBeNull();
    expect(retry()).toBeTruthy();
    view.click(retry()!);
    await settle();
    expect(retry()).toBeTruthy();
    expect(photoCard(view).querySelector('[role="alert"]')).not.toBeNull();
    view.click(retry()!);
    await settle();
    expect(writes).toBe(1);
    expect(refreshes).toBe(2);
    expect(photoCard(view).querySelector('[role="alert"]')).toBeNull();
    expect(photoCard(view).textContent).toContain("New conversations here can use it");
  });

  it("retains partial success after a rejected refresh and disables in-flight retries", async () => {
    let reject!: (error: Error) => void;
    let refreshes = 0;
    const view = render({
      onKeepPhoto: async () => "refresh_pending",
      onRefreshPhotoScope: () => { refreshes++; return new Promise<boolean>((_, fail) => { reject = fail; }); },
    });
    view.click(keepButton(photoCard(view))!);
    await settle();
    const retry = () => Array.from(photoCard(view).querySelectorAll("button")).find(b => b.textContent === "Refresh sources");
    expect(retry()).toBeTruthy();
    view.click(retry()!);
    expect(retry()!.disabled).toBe(true);
    expect(refreshes).toBe(1);
    await act(async () => { reject(new Error("offline")); });
    expect(retry()!.disabled).toBe(false);
    expect(photoCard(view).querySelector('[role="alert"]')?.textContent).toContain("Photo saved");
  });
});

describe("review before keeping a print", () => {
  it.each(["offline", "other-writer", "unreviewed"])("does not write over an unresolved recovery: %s", async (failure) => {
    let reads = 0;
    let writes = 0;
    const view = render({
      onReviewPhoto: async () => {
        if (++reads === 1) return { observationId: "old", text: "F53", reviewed: false };
        if (failure === "offline") throw new Error("offline");
        return { observationId: "someone-else", text: failure === "unreviewed" ? "F55" : "different technician reading", reviewed: failure !== "unreviewed" };
      },
      onKeepPhoto: async () => { writes++; throw new Error("response lost"); },
    });
    view.click(keepButton(photoCard(view))!); await settle();
    const text = photoCard(view).querySelector<HTMLTextAreaElement>("textarea")!;
    const ack = () => photoCard(view).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const save = () => Array.from(photoCard(view).querySelectorAll("button")).find(b => b.textContent === "Save reviewed reading")!;
    view.type(text, "F55"); view.click(ack()); view.click(save()); await settle();
    view.type(text, "F55 /15.0"); view.click(ack()); view.click(save()); await settle();
    expect(writes).toBe(1);
    expect(text.value).toBe("F55 /15.0");
    expect(photoCard(view).querySelector('[role="alert"]')).not.toBeNull();
  });

  it("recovers the committed observation before publishing an edited retry", async () => {
    let reading = { observationId: "original", text: "F53", reviewed: false };
    const writes: unknown[] = [];
    const view = render({
      onReviewPhoto: async () => reading,
      onKeepPhoto: async (_file, reviewed) => {
        writes.push(reviewed);
        if (writes.length === 1) {
          reading = { observationId: "committed-A", text: reviewed!.text, reviewed: true };
          throw new Error("ingestion failed after correction committed");
        }
        if (reviewed!.observationId !== reading.observationId) throw new Error("photo_review_conflict");
      },
    });
    view.click(keepButton(photoCard(view))!); await settle();
    const text = photoCard(view).querySelector<HTMLTextAreaElement>("textarea")!;
    const ack = () => photoCard(view).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const save = () => Array.from(photoCard(view).querySelectorAll("button")).find(b => b.textContent === "Save reviewed reading")!;
    view.type(text, "F55 /150"); view.click(ack()); view.click(save()); await settle();
    view.type(text, "F55 /15.0"); view.click(ack()); view.click(save()); await settle();
    expect(text.value).toBe("F55 /15.0");
    expect(writes).toHaveLength(1);
    expect(ack().checked).toBe(false);
    view.click(ack()); view.click(save()); await settle();
    expect(writes[1]).toEqual({ observationId: "committed-A", text: "F55 /15.0", confirmed: true });
    expect(photoCard(view).textContent).toContain("Technician-reviewed reading");
  });

  it("loads exact text, requires acknowledgement, and retains corrections through a failed save", async () => {
    const writes: unknown[] = [];
    const view = render({
      onReviewPhoto: async () => ({ observationId: "reading-1", text: "-F53.3 /150", reviewed: false }),
      onKeepPhoto: async (_file, reviewed) => { writes.push(reviewed); if (writes.length === 1) throw new Error("offline"); },
    });
    view.click(keepButton(photoCard(view))!);
    await settle();
    expect(writes).toHaveLength(0);
    const text = photoCard(view).querySelector<HTMLTextAreaElement>('textarea[aria-label="Photo reading"]')!;
    expect(text?.value).toBe("-F53.3 /150");
    view.type(text, "-F55.3 /15.0");
    const save = () => Array.from(photoCard(view).querySelectorAll("button")).find(b => b.textContent === "Save reviewed reading")!;
    expect(save().disabled).toBe(true);
    view.click(photoCard(view).querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    view.click(save());
    await settle();
    expect(text.value).toBe("-F55.3 /15.0");
    expect(photoCard(view).querySelector('[role="alert"]')).not.toBeNull();
    view.click(save());
    await settle();
    expect(writes).toEqual([{ observationId: "reading-1", text: "-F55.3 /15.0", confirmed: true }, { observationId: "reading-1", text: "-F55.3 /15.0", confirmed: true }]);
    expect(photoCard(view).textContent).toContain("Technician-reviewed reading");
  });
});

describe("review original photo from a native host", () => {
  it("renders the host's authenticated original beside the review text", async () => {
    const seen: string[] = [];
    const view = render({onKeepPhoto:async()=>{},onReviewPhoto:async()=>({observationId:"obs",text:"-F53.3",reviewed:false}),
      renderPhoto: (fileId) => { seen.push(fileId); return <span>Authenticated original photo</span>; }});
    view.click(keepButton(photoCard(view))!);
    await settle();
    expect(photoCard(view).textContent).toContain("Authenticated original photo");
    expect(seen).toContain("file-nameplate");
  });
});

describe("failed replacement does not claim an old source is still current", () => {
  it("returns to an unsaved state when cancelling a failed review", async () => {
    const view = render({isPhotoKept:()=>true,onReviewPhoto:async()=>({observationId:"obs",text:"-F55.3",reviewed:true}),onKeepPhoto:async()=>{throw Error("ingest failed");}});
    view.click(Array.from(photoCard(view).querySelectorAll("button")).find(b=>b.textContent==="Review reading")!);
    await settle();
    view.click(photoCard(view).querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    view.click(Array.from(photoCard(view).querySelectorAll("button")).find(b=>b.textContent==="Save reviewed reading")!);
    await settle();
    view.click(Array.from(photoCard(view).querySelectorAll("button")).find(b=>b.textContent==="Cancel review")!);
    await settle();
    expect(photoCard(view).querySelector('[role="status"]')).toBeNull();
    expect(keepButton(photoCard(view))).not.toBeNull();
  });
});
