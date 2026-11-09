/** #5323: Upload again is a real button; the file input is out of the layout and the tab order. Static render (no jsdom here). */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UploadAgain } from "./PendingManuals";

describe("#5323 Upload again control", () => {
  const html = renderToStaticMarkup(<UploadAgain filename="manual.pdf" onPick={vi.fn()} />);
  it("is a button named for the file it re-sends", () => {
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Upload manual.pdf again"[^>]*>Upload again<\/button>/);
  });
  it("the file input is hidden and not tabbable; no label wraps it", () => {
    const input = html.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('accept="application/pdf"');
    expect(input).toContain("hidden");
    expect(input).toContain('tabindex="-1"');
    expect(html).not.toContain("<label");
  });
});
