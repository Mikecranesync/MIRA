import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NOTICE_MS, NoticeLine, addNotice, dropNotice, liveNotices, nextExpiry, type Notice } from "./expiring-notices";

describe("expiring notices (#5488 follow-up: a confirmation never stays over the conversation)", () => {
  const T = 1_000_000;
  const one = addNotice([], { id: "a", text: "a.pdf" }, T);

  it("a notice is live until its time is up, then gone", () => {
    expect(liveNotices(one, T).map((n) => n.id)).toEqual(["a"]);
    expect(liveNotices(one, T + NOTICE_MS - 1).map((n) => n.id)).toEqual(["a"]);
    expect(liveNotices(one, T + NOTICE_MS)).toEqual([]);
  });

  it("stays up long enough to read, and not for minutes", () => {
    expect(NOTICE_MS).toBeGreaterThanOrEqual(5000);
    expect(NOTICE_MS).toBeLessThanOrEqual(15000);
  });

  it("adding the same id again restarts its time and never lists it twice", () => {
    const again = addNotice(one, { id: "a", text: "a.pdf" }, T + 5000);
    expect(again).toHaveLength(1);
    expect(liveNotices(again, T + NOTICE_MS + 1).map((n) => n.id)).toEqual(["a"]);
    expect(liveNotices(again, T + 5000 + NOTICE_MS)).toEqual([]);
  });

  it("dismiss removes that notice only", () => {
    const two = addNotice(one, { id: "b", text: "b.pdf" }, T);
    expect(dropNotice(two, "a").map((n) => n.id)).toEqual(["b"]);
    expect(dropNotice(two, "zzz")).toHaveLength(2);
  });

  it("the next expiry is the earliest live one; none when nothing is live", () => {
    const two = addNotice(one, { id: "b", text: "b.pdf" }, T + 3000);
    expect(nextExpiry(two, T + 3000)).toBe(T + NOTICE_MS);
    expect(nextExpiry(two, T + NOTICE_MS)).toBe(T + 3000 + NOTICE_MS);
    expect(nextExpiry(two, T + 3000 + NOTICE_MS)).toBeNull();
    expect(nextExpiry([] as Notice[], T)).toBeNull();
  });

  it("renders as a status line with a Dismiss control a gloved thumb can hit", () => {
    const html = renderToStaticMarkup(<NoticeLine onDismiss={vi.fn()}>a.pdf is now used.</NoticeLine>);
    expect(html).toMatch(/<p[^>]*role="status"/);
    expect(html).toContain("a.pdf is now used.");
    expect(html).toMatch(/<button[^>]*style="[^"]*min-height:44px[^"]*"[^>]*>Dismiss<\/button>/);
  });
});
