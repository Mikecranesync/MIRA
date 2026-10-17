/**
 * #4371 — a selected notebook whose detail has not arrived must not render
 * HOME's general-knowledge line or "0 of 0 sources". The host is not mounted
 * here (precedent: hub-host-open-notebook.test.ts); the wiring is pinned
 * against source, the helper against hub-host-logic.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const host = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/(hub)/equipment/[id]/page.tsx", import.meta.url), "utf8");

describe("HubShellHost grounding line while a notebook's sources are unknown (#4371)", () => {
  it("passes sourcesKnown=false when a notebook is selected and detail has not loaded", () => {
    expect(host).toMatch(
      /groundingLineFor\(detail\?\.notebook \?\? null, docIds\.length, !\(selection && !detail\)\)/,
    );
  });
});

describe("classic equipment page source count while unknown (#4371)", () => {
  it("treats the count as known only for the id that just loaded", () => {
    expect(page).toMatch(/const sourcesKnown = loadedForId === id/);
    expect(page).toMatch(/setLoadedForId\(id\)/);
  });

  it("renders the loading-aware count helpers, never a raw 0 of 0 interpolation", () => {
    expect(page).toMatch(/notebookSourcesCountLine\(true,/);
    expect(page).toMatch(/notebookSourcesCountLine\(false,/);
    expect(page).toMatch(/notebookSourcesButtonCount\(sourcesKnown,/);
    expect(page).not.toMatch(/\$\{enabledDocIds\.length\} of \$\{usableCount\} sources/);
    expect(page).not.toMatch(/Sources · \{enabledDocIds\.length\}\/\{usableCount\}/);
  });

  it("the sources sheet does not show the empty-sources prompt until the GET has settled", () => {
    expect(page).toMatch(/!sourcesKnown \?/);
    expect(page).toMatch(/SOURCES_LOADING_LABEL/);
  });
});
