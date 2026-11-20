import { describe, expect, it } from "vitest";
import type { PersistedTurn } from "@/components/equipment/notebook-chat-utils";
import { persistedRetryTarget, withoutRetriedFailures } from "./persisted-retry";

const failed = (extra: object = {}): PersistedTurn => ({
  id: "turn-A", question: "What fuse?", answerStatus: "error", answerText: null,
  equipmentEntityId: "machine-A", evidence: [], ...extra,
});

describe("5669 accepted review regressions", () => {
  it("F1 withholds whole-machine Retry after A is rebound to B", () => {
    expect(persistedRetryTarget([failed()], null, "machine-B")).toBeNull();
    expect(persistedRetryTarget([failed()], null, "machine-A")).not.toBeNull();
  });
  it("F1 does not infer an unknown historical target from the current machine", () => {
    expect(persistedRetryTarget([failed({ equipmentEntityId: undefined })], null, "machine-A")).toBeNull();
  });
  it("F3 preserves an earlier same-text exchange with its distinct photo", () => {
    const first = failed({ evidence: [{ kind: "visual_observation", fileId: "photo-A" }] });
    const next = failed({ id: "turn-B", evidence: [{ kind: "visual_observation", fileId: "photo-B" }] });
    expect(withoutRetriedFailures([first, next])).toEqual([first, next]);
  });
  it("F3 preserves both original component attributions when the text repeats", () => {
    const first = failed({ evidence: [{ kind: "component_attribution", componentId: "A", label: "Drive A" }] });
    const next = failed({ id: "turn-B", evidence: [{ kind: "component_attribution", componentId: "B", label: "Drive B" }] });
    expect(withoutRetriedFailures([first, next])).toEqual([first, next]);
  });
});
