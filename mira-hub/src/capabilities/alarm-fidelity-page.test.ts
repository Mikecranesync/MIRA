// The fidelity page (tools/alarm-fidelity/alarm-page.html) is what Mike photographs; the
// fixture screens are what the photos are scored against. If they drift apart, every
// transcription is scored against the wrong truth, so pin them line for line.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { SCREEN_FAIL_SAFE, SCREEN_HISTORY, SCREEN_RTD } from "./alarm-screens.fixture";

const PAGE = readFileSync(new URL("../../../tools/alarm-fidelity/alarm-page.html", import.meta.url), "utf8");

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();

/** The visual lines a screen shows: header, then per row the columns + first text line, then continuations. */
function pageLines(sectionId: string): string[] {
  const section = PAGE.match(new RegExp(`<section class="screen" id="${sectionId}">([\\s\\S]*?)</section>`));
  if (!section) throw new Error(`section ${sectionId} missing from alarm-page.html`);
  const body = section[1];
  const header = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1])).join(" ");
  const lines = [header];
  for (const row of body.matchAll(/<tr class="alarm[^"]*">([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const textLines = [...cells[4].matchAll(/<div>([\s\S]*?)<\/div>/g)].map((m) => text(m[1]));
    lines.push([...cells.slice(0, 4).map(text), textLines[0]].join(" "));
    lines.push(...textLines.slice(1));
  }
  return lines;
}

/** The alarm-history layout: one line per row, every cell on it (Event Time · Display Path · Name · Label). */
function historyLines(sectionId: string): string[] {
  const section = PAGE.match(new RegExp(`<section class="screen" id="${sectionId}">([\\s\\S]*?)</section>`));
  if (!section) throw new Error(`section ${sectionId} missing from alarm-page.html`);
  const body = section[1];
  const header = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1])).join(" ");
  const rows = [...body.matchAll(/<tr class="[^"]*">([\s\S]*?)<\/tr>/g)].map((row) =>
    [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1])).join(" "),
  );
  return [header, ...rows];
}

describe("fidelity page matches the fixture screens", () => {
  it("fail-safe screen", () => expect(pageLines("failsafe")).toEqual([...SCREEN_FAIL_SAFE]));
  it("RTD screen", () => expect(pageLines("rtd")).toEqual([...SCREEN_RTD]));
  it("alarm-history screen", () => expect(historyLines("history")).toEqual([...SCREEN_HISTORY]));
});
