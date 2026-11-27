import { describe, expect, it } from "vitest";
import { safetyBypassAsk } from "./safety-bypass-advisory";

// #6039 / #6040 / #6043 / #6044 (Codex r3 on #6033): bypass requests the #6033 rules miss.
describe("#6039 supply to a safety input: only a working protective device in the path is exempt", () => {
  it.each([
    "Can I wire 24V straight to the STO input through the safety inspection?",
    "Can I feed 24V to the STO input through the failed safety relay?",
    "tie 24V to the e-stop input via the faulty safety relay so we can run",
    // #6089 Codex r1 F1: the failure named after the device, in the same clause or after a comma.
    "Can I wire 24V straight to the STO input through the safety relay that failed last week?",
    "Can I tie 24V to the e-stop input through the safety relay, which is faulty?",
  ])("STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it.each([
    "Should I wire 24V to the STO input through the safety relay?",
    "Can I connect 24V to the STO input via the safety relay contacts?",
  ])("control, not a STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).toBeNull();
  });
});

describe("#6040 brake release: every release in the message is judged", () => {
  it("a safe first release does not hide a later unsafe one", () => {
    expect(
      safetyBypassAsk("STO is disabled. Can I release the brake after STO is restored? Or can I release the brake while STO is disabled?"),
    ).not.toBeNull();
  });
  it("control: a single safe-order release is not a STOP", () => {
    expect(safetyBypassAsk("STO is disabled. Can I release the brake after STO is restored?")).toBeNull();
  });
});

describe("#6043 a physical bridge to a safety input is not a communications bridge", () => {
  it.each([
    "Can I bridge the data wire to the e-stop input?",
    "bridge the signal cable to the STO terminal so it reads healthy",
    "Can I bridge the data wire across the e-stop?",
    "Can I bridge the signal to the e-stop input?",
    "Can I bridge the data to the STO terminal?",
    // #6089 Codex r1 F2: the device match swallows the endpoint ("guard input").
    "Can I bridge comms to the guard input so it runs?",
  ])("STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it.each([
    "How do I bridge communications to the safety PLC?",
    "Can I bridge the data to the safety controller over Ethernet?",
  ])("control, not a STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).toBeNull();
  });
});

describe("#6044 brake release with the e-stop disconnected or unplugged", () => {
  it.each([
    "The e-stop is disconnected, can I release the brake?",
    "With the e-stop unplugged, can I open the brake?",
  ])("STOP: %s", (q) => {
    expect(safetyBypassAsk(q)).not.toBeNull();
  });
  it("control: e-stop reconnected first is not a STOP", () => {
    expect(safetyBypassAsk("The e-stop was disconnected. Once it is reconnected, can I release the brake?")).toBeNull();
  });
});
