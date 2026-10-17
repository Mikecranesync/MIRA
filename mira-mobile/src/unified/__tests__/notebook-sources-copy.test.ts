import { describe, expect, it } from "vitest";
import {
  SOURCES_LOADING_DRAWER,
  SOURCES_LOADING_GROUNDING,
  notebookGroundingLine,
  sourcesDrawerLabel,
} from "../notebook-sources-copy";

describe("sourcesDrawerLabel — #4371 never flashes Sources (0) while unknown", () => {
  it("is a loading row while the count is unknown", () => {
    expect(sourcesDrawerLabel(null)).toBe(SOURCES_LOADING_DRAWER);
    expect(sourcesDrawerLabel(null)).not.toBe("Sources (0)");
  });

  it("reports a real empty notebook only after the count is known", () => {
    expect(sourcesDrawerLabel(0)).toBe("Sources (0)");
  });

  it("reports a loaded count", () => {
    expect(sourcesDrawerLabel(2)).toBe("Sources (2)");
  });
});

describe("notebookGroundingLine", () => {
  it("does not claim empty sources while they are still loading", () => {
    const line = notebookGroundingLine({ sourcesKnown: false, enabledCount: 0 });
    expect(line).toBe(SOURCES_LOADING_GROUNDING);
    expect(line).not.toMatch(/no selected sources|Ask general questions|0 of 0/i);
  });

  it("the empty-sources line is only for a loaded notebook with none selected", () => {
    expect(notebookGroundingLine({ sourcesKnown: true, enabledCount: 0 })).toMatch(
      /Ask general questions now/,
    );
  });

  it("a loaded notebook with sources claims they are cited", () => {
    expect(notebookGroundingLine({ sourcesKnown: true, enabledCount: 2 })).toBe(
      "Answers cite this notebook's selected manuals.",
    );
  });
});
