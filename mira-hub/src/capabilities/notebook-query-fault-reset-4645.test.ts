/**
 * #4645 defects 2+3 — fault-reset questions must classify as `fault`,
 * expand technician ACK vocabulary to the manual's acknowledge wording,
 * and demote factory-restore / OS-wipe chunks under fault intent.
 *
 * These fail on main: FAULT_ACTION misses acknowledge/alarm/ACK, ACK is not
 * in the synonym table, and rerank treats factory-reset pages as procedure
 * material. Opposite-direction controls pin a true factory-reset question
 * (procedure intent) and existing param-lookup behavior.
 *
 * procedureScore is shared by fault AND procedure intent. Acknowledge
 * vocabulary therefore lives in SYNONYMS, FAULT_ACTION, and the fault-intent
 * rerank boost — not in PROC_SIGNALS. Putting it there lets Comfort p.74
 * beat factory-restore under a true factory-reset how-to.
 *
 * Lives in capabilities/ (open) rather than src/lib/__tests__/ (guarded).
 * Run: cd mira-hub && npx vitest run src/capabilities/notebook-query-fault-reset-4645
 */
import { describe, expect, it } from "vitest";
import {
  classifyIntent,
  expandIndustrialQuery,
  isFactoryResetMaterial,
  rerankChunks,
} from "@/lib/notebook-query";

const ACKNOWLEDGE_PAGE_74 =
  "The acknowledge key acknowledges the currently displayed fault or all alarms of an alarm group as group acknowledgment. A lit LED indicates unacknowledged faults.";

const FACTORY_RESET_PAGE_171 =
  "Updating the operating system deletes all data on the HMI device. A reset to the factory settings also deletes the license keys.";

const mk = (content: string, rank: number, page: number) => ({
  content,
  rank,
  sourcePage: page,
  docId: "comfort-manual",
});

describe("#4645 classifyIntent — acknowledge / alarm / ACK are fault-clear", () => {
  it.each([
    "How do I acknowledge an alarm?",
    "What does the ACK key do?",
    "How do I reset an alarm on this panel?",
    "How do I clear an alarm message on the TP700?",
    "How do I clear a fault on the panel?",
    "The machine faulted and stopped. How do I reset the fault and get it running again?",
    "What is the procedure to reset a fault?",
  ])("classifies %s as fault", (q) => {
    expect(classifyIntent(q)).toBe("fault");
  });

  it("does not classify a true factory-reset how-to as fault", () => {
    expect(classifyIntent("how do I factory reset the panel?")).toBe("procedure");
  });

  it("preserves param-ID vs spec (opposite direction)", () => {
    expect(classifyIntent("what's the maximum frequency parameter?")).toBe("param_lookup");
    expect(classifyIntent("what's the maximum?")).toBe("spec");
  });
});

describe("#4645 expandIndustrialQuery — ACK / fault-clear → acknowledge vocabulary", () => {
  it("bridges ACK key to the manual's acknowledge wording", () => {
    const e = expandIndustrialQuery("What does the ACK key do?");
    const blob = e.variants.join(" ").toLowerCase();
    expect(blob).toMatch(/acknowledge/);
    expect(blob).toMatch(/group acknowledgment|fault clear/);
  });

  it("bridges 'clear a fault' to acknowledge so p.74 is retrievable", () => {
    const e = expandIndustrialQuery("How do I clear a fault on the panel?");
    expect(e.variants.join(" ").toLowerCase()).toMatch(/acknowledge/);
  });

  it("does not flood a parameter-reset question with acknowledge pages", () => {
    const e = expandIndustrialQuery("reset the deceleration time");
    expect(e.variants.join(" ").toLowerCase()).not.toMatch(/acknowledge/);
  });
});

describe("#4645 isFactoryResetMaterial — content signature, not a question list", () => {
  it("recognizes the Siemens Comfort factory-restore / OS-wipe pages", () => {
    expect(isFactoryResetMaterial(FACTORY_RESET_PAGE_171)).toBe(true);
  });

  it("does not flag an acknowledge / fault-clear procedure", () => {
    expect(isFactoryResetMaterial(ACKNOWLEDGE_PAGE_74)).toBe(false);
  });
});

describe("#4645 rerankChunks — factory-restore loses under fault intent", () => {
  const factory = mk(FACTORY_RESET_PAGE_171, 0.95, 171);
  const acknowledge = mk(ACKNOWLEDGE_PAGE_74, 0.25, 74);

  it("floats the acknowledge page above factory-restore for a fault-reset ask", () => {
    const e = expandIndustrialQuery("The machine faulted. Reset the fault and get it running again.");
    const out = rerankChunks(e, [factory, acknowledge], { intent: "fault" });
    expect(out[0]).toBe(acknowledge);
  });

  it("does not demote factory-restore under procedure intent (true factory-reset ask)", () => {
    const e = expandIndustrialQuery("how do I factory reset the panel?");
    const out = rerankChunks(e, [factory, acknowledge], { intent: "procedure" });
    expect(out[0]).toBe(factory);
  });
});
