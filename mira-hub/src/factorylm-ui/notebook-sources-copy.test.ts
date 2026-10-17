import { describe, expect, it } from "vitest";
import {
  SOURCES_LOADING_BUTTON,
  SOURCES_LOADING_LABEL,
  notebookSourcesButtonCount,
  notebookSourcesCountLine,
} from "./notebook-sources-copy";

describe("notebookSourcesCountLine — #4371 never flashes 0 of 0", () => {
  it("is a loading line while sources are unknown, even at 0/0", () => {
    expect(notebookSourcesCountLine(false, 0, 0)).toBe(SOURCES_LOADING_LABEL);
    expect(notebookSourcesCountLine(false, 0, 0)).not.toMatch(/0 of 0/);
    expect(notebookSourcesCountLine(false, 2, 3)).toBe(SOURCES_LOADING_LABEL);
  });

  it("reports a real empty notebook only after the count is known", () => {
    expect(notebookSourcesCountLine(true, 0, 0)).toBe("0 of 0 sources");
  });

  it("reports a loaded count", () => {
    expect(notebookSourcesCountLine(true, 1, 1)).toBe("1 of 1 sources");
    expect(notebookSourcesCountLine(true, 2, 3)).toBe("2 of 3 sources");
  });
});

describe("notebookSourcesButtonCount", () => {
  it("does not show 0/0 while unknown", () => {
    expect(notebookSourcesButtonCount(false, 0, 0)).toBe(SOURCES_LOADING_BUTTON);
    expect(notebookSourcesButtonCount(false, 0, 0)).not.toBe("0/0");
  });

  it("shows N/M once known, including a genuine empty notebook", () => {
    expect(notebookSourcesButtonCount(true, 0, 0)).toBe("0/0");
    expect(notebookSourcesButtonCount(true, 2, 2)).toBe("2/2");
  });
});
