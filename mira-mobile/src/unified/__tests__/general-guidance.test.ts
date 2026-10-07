// F004 M2/M3 (#4303): a "Get general guidance" tap resolves to the failed turn's own question.
// Run: cd mira-mobile && npx vitest run src/unified/__tests__/general-guidance
import { describe, expect, it } from "vitest";
import { generalGuidanceTarget } from "../general-guidance";

const ROW = "11111111-1111-4111-8111-111111111111";
const saved = [{ id: ROW, question: "What does F004 mean" }];
const live = [
  { q: "earlier live question", requestId: "aaaaaaaa-0000-4000-8000-000000000001" },
  { q: "What does F012 mean", requestId: "aaaaaaaa-0000-4000-8000-000000000002" },
];

describe("generalGuidanceTarget", () => {
  it("a saved answer links by its row id and re-asks its own question", () => {
    expect(generalGuidanceTarget(`${ROW}-a`, saved, live)).toEqual({ question: "What does F004 mean", fallbackOf: ROW });
  });
  it("a live answer links by the request id it was sent with, picked by its index", () => {
    expect(generalGuidanceTarget("live-1-a", saved, live)).toEqual({
      question: "What does F012 mean",
      fallbackOf: "aaaaaaaa-0000-4000-8000-000000000002",
    });
  });
  it("never guesses: an unknown row, a missing live turn, a live turn without a request id, or a question turn", () => {
    expect(generalGuidanceTarget("99999999-9999-4999-8999-999999999999-a", saved, live)).toBeNull();
    expect(generalGuidanceTarget("live-7-a", saved, live)).toBeNull();
    expect(generalGuidanceTarget("live-0-a", saved, [{ q: "no id" }])).toBeNull();
    expect(generalGuidanceTarget(`${ROW}-q`, saved, live)).toBeNull();
  });
});
