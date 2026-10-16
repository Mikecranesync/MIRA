/**
 * What the Stranger Walk reads from a settled /v3 turn on top of the fidelity
 * harness's `extractTurn` (#4460). Shared by the live walk and the replay so
 * both score the same element.
 *
 * `extractTurn` returns citations sorted by id ("11" < "4"); the citation a
 * technician opens is the first chip in READING order. Markers are excerpt
 * indices (e.g. [6] then [5]), so the two differ — the walk scores this one.
 */
import type { Locator } from "@playwright/test";
import type { Observation } from "./score";

export async function firstChipOf(turn: Locator): Promise<Observation["firstChip"]> {
  const labels = await turn.getByRole("button", { name: /^Open citation / }).evaluateAll(
    (els) => els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  for (const l of labels) {
    const m = /^Open citation (\S+): (.*?)(?:, page (\S+))?$/.exec(l);
    if (m) return { n: m[1], title: m[2], page: m[3] ?? null };
  }
  return null;
}

export async function cardsOf(turn: Locator): Promise<Observation["cards"]> {
  return turn.locator('[data-part-type="source"]').evaluateAll((els) => els.map((e) => ({
    title: (e.querySelector(".fl-source__title")?.textContent ?? "").trim(),
    page: /\bp\.\s*(\d+)/.exec(e.querySelector(".fl-source__locator")?.textContent ?? "")?.[1] ?? null,
  })));
}

/** The opened source viewer's resolved target: `/api/namespace/files/<fileId>…#page=<n>`. */
export async function viewerTargetOf(frame: Locator): Promise<{ fileId: string | null; page: string | null }> {
  const src = (await frame.getAttribute("src")) ?? "";
  return {
    fileId: /\/files\/([0-9a-f-]{36})/.exec(src)?.[1] ?? null,
    page: /#page=(\d+)/.exec(src)?.[1] ?? null,
  };
}
