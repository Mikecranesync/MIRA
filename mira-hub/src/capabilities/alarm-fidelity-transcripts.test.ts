import { describe, expect, it } from "vitest";

import { scoreScreen } from "./alarm-fidelity-score";
import { photoFromTranscript, transcriptToLines } from "./alarm-fidelity-transcripts";
import { SCREEN_FAIL_SAFE } from "./alarm-screens.fixture";

// What a general AI chat typically returns: the list in a code block, with blank lines.
const asChatReply = (lines: readonly string[]) =>
  ["Here is the alarm list, transcribed exactly:", "", "```", ...lines, "```", ""].join("\n");

describe("alarm fidelity — scoring any reader's transcript (#4404)", () => {
  it("a faithful transcript keeps every screen line and passes on all three measures", () => {
    const lines = transcriptToLines(asChatReply(SCREEN_FAIL_SAFE).replace(/^Here is.*\n/, ""));
    expect(lines).toEqual([...SCREEN_FAIL_SAFE]);
    const s = scoreScreen(SCREEN_FAIL_SAFE, lines);
    expect(s.inventedInCutFields).toBe(0);
    expect(s.designationExact).toBe(s.designationTotal);
    expect(s.recordsCorrect).toBe(s.recordsTotal);
  });

  it("a filled-in cut-off time (08:14:3… → 08:14:35) is caught as invented", () => {
    const text = SCREEN_FAIL_SAFE.join("\n").replace("08:14:3…", "08:14:35");
    const s = scoreScreen(SCREEN_FAIL_SAFE, transcriptToLines(text));
    expect(s.inventedInCutFields).toBeGreaterThan(0);
  });

  it("an alarm whose wrapped line is dropped lowers the grouping score", () => {
    const dropped = SCREEN_FAIL_SAFE.filter((_, i) => i !== 2); // the first entry's tag line
    const s = scoreScreen(SCREEN_FAIL_SAFE, transcriptToLines(dropped.join("\n")));
    expect(s.recordsCorrect).toBeLessThan(s.recordsTotal);
    expect(s.recordsCorrect).toBeGreaterThan(0); // the rest of the list still groups
  });

  it("reads <id>.<screen>.txt into a run photo and ignores any other file", () => {
    expect(photoFromTranscript("chatgpt-1.rtd.txt", "a\n\nb  \n")).toEqual({
      id: "chatgpt-1",
      screen: "rtd",
      lines: ["a", "b"],
    });
    expect(photoFromTranscript("notes.txt", "x")).toBeNull();
    expect(photoFromTranscript("p1.panel.txt", "x")).toBeNull();
  });
});
