/**
 * Photo thumbnails and openable references (owner ask, 2026-10-05).
 *
 * Before this: a photo the technician took rendered as a table of its file
 * UUID, and tapping a citation opened a panel that said "Document content is
 * not connected". A host that knows where the bytes live now says so on the
 * part (`previewUrl` on a visual observation, `href` on a source) and the
 * shell renders it the way any site does: a thumbnail that opens the full
 * photo, and a document that opens at the cited page.
 *
 * Run: cd apps/factorylm-ui-lab && bun test ../../packages/factorylm-ui/src/__tests__/media-previews.test.tsx
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { InteractionPart, ShellFixture } from "@factorylm/interaction";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => { views.splice(0).forEach((v) => v.cleanup()); });

function withParts(map: (p: InteractionPart) => InteractionPart) {
  return (f: ShellFixture): ShellFixture => ({
    ...f,
    thread: { ...f.thread, turns: f.thread.turns.map((t) => ({ ...t, parts: t.parts.map(map) })) },
  });
}

function render(fixture: "machine-evidence" | "grounded-answer", map?: (p: InteractionPart) => InteractionPart): HarnessView {
  const view = renderHarness({ surface: "web", fixture, ...(map ? { transformFixture: withParts(map) } : {}) });
  views.push(view);
  return view;
}

const PHOTO = "/api/namespace/files/file-nameplate/";
const photoWithPreview = (p: InteractionPart): InteractionPart =>
  p.type === "visual_observation" ? { ...p, observation: { ...p.observation, previewUrl: PHOTO } } : p;
const sourceWith = (href: string) => (p: InteractionPart): InteractionPart =>
  p.type === "source" ? { ...p, source: { ...p.source, href } } : p;

function photoCard(view: HarnessView): HTMLElement {
  const card = view.container.querySelector<HTMLElement>('[data-part-type="visual_observation"]');
  if (!card) throw new Error("no visual_observation card rendered");
  return card;
}

function openFirstSource(view: HarnessView): HTMLElement {
  const chip = view.container.querySelector<HTMLButtonElement>('[data-part-type="source"]');
  if (!chip) throw new Error("no source chip rendered");
  view.click(chip);
  const viewer = document.querySelector<HTMLElement>('[aria-label="Source viewer"]');
  if (!viewer) throw new Error("source viewer did not open");
  return viewer;
}

describe("photo observation", () => {
  it("shows a thumbnail of the photo that opens the full-size image", () => {
    const card = photoCard(render("machine-evidence", photoWithPreview));
    const img = card.querySelector("img");
    expect(img?.getAttribute("src")).toBe(PHOTO);
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("alt")).toContain("Photo");
    const link = img?.closest("a");
    expect(link?.getAttribute("href")).toBe(PHOTO);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("does not print the raw file id once the photo itself is shown", () => {
    const card = photoCard(render("machine-evidence", photoWithPreview));
    expect(card.textContent).not.toContain("file-nameplate");
    expect(card.getAttribute("data-file-id")).toBe("file-nameplate");
  });

  it("control — without a preview address the card stays facts-only, file id included", () => {
    const card = photoCard(render("machine-evidence"));
    expect(card.querySelector("img")).toBeNull();
    expect(card.textContent).toContain("file-nameplate");
  });

  it("refuses an address that is not a web or same-site path", () => {
    const card = photoCard(render("machine-evidence", (p) =>
      p.type === "visual_observation" ? { ...p, observation: { ...p.observation, previewUrl: "javascript:alert(1)" } } : p));
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("a")).toBeNull();
  });
});

describe("source viewer", () => {
  it("opens a same-site document inline at the cited page, with a link to open it in a new tab", () => {
    const href = "/api/namespace/files/doc-1/#page=47";
    const viewer = openFirstSource(render("grounded-answer", sourceWith(href)));
    const frame = viewer.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe(href);
    const open = Array.from(viewer.querySelectorAll("a")).find((a) => a.textContent?.includes("Open document"));
    expect(open?.getAttribute("href")).toBe(href);
    expect(open?.getAttribute("target")).toBe("_blank");
    expect(viewer.textContent).not.toContain("not connected");
  });

  it("links an off-site manual without embedding it (other sites refuse to be framed)", () => {
    const href = "https://literature.example.com/manual.pdf#page=12";
    const viewer = openFirstSource(render("grounded-answer", sourceWith(href)));
    expect(viewer.querySelector("iframe")).toBeNull();
    const open = Array.from(viewer.querySelectorAll("a")).find((a) => a.textContent?.includes("Open document"));
    expect(open?.getAttribute("href")).toBe(href);
  });

  it("control — without an address it says the original isn't available, and links nothing", () => {
    const viewer = openFirstSource(render("grounded-answer"));
    expect(viewer.querySelector("iframe")).toBeNull();
    expect(viewer.querySelector("a")).toBeNull();
    expect(viewer.textContent).toContain("isn't available");
  });

  it("refuses an address that is not a web or same-site path", () => {
    const viewer = openFirstSource(render("grounded-answer", sourceWith("javascript:alert(1)")));
    expect(viewer.querySelector("iframe")).toBeNull();
    expect(viewer.querySelector("a")).toBeNull();
  });
});
