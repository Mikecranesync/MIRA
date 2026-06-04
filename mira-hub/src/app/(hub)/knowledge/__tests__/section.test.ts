import { describe, it, expect, vi, beforeEach } from "vitest";

// redirect() normally throws NEXT_REDIRECT; we just record the target.
const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import KnowledgeIndexRedirect from "@/app/(hub)/knowledge/page";
import GraphRedirect from "@/app/(hub)/graph/page";
import ProposalsRedirect from "@/app/(hub)/proposals/page";
import { NAV_ITEMS } from "@/providers/access-control";

beforeEach(() => redirectMock.mockClear());

describe("Knowledge section — legacy route redirects", () => {
  it("/knowledge opens the Map sub-tab", () => {
    KnowledgeIndexRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/knowledge/map");
  });

  it("/proposals → Suggestions sub-tab", () => {
    ProposalsRedirect();
    expect(redirectMock).toHaveBeenCalledWith("/knowledge/suggestions");
  });

  it("/graph → Map sub-tab with no params", async () => {
    await GraphRedirect({ searchParams: Promise.resolve({}) });
    expect(redirectMock).toHaveBeenCalledWith("/knowledge/map");
  });

  it("/graph preserves the reasoning-trace deep link (?session=…&turn=…)", async () => {
    await GraphRedirect({
      searchParams: Promise.resolve({ session: "abc", turn: "2" }),
    });
    expect(redirectMock).toHaveBeenCalledWith(
      "/knowledge/map?session=abc&turn=2",
    );
  });
});

describe("Knowledge nav consolidation", () => {
  const keys = NAV_ITEMS.map((i) => i.key);

  it("keeps a single Knowledge primary item", () => {
    expect(keys).toContain("knowledge");
  });

  it("no longer lists graph or proposals as their own sidebar items", () => {
    expect(keys).not.toContain("graph");
    expect(keys).not.toContain("proposals");
  });
});
