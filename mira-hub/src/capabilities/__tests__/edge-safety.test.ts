// #5265 edge profile — immediate-danger reports become a terminal STOP on the tablet.
import { describe, expect, it } from "vitest";

import { edgeDangerTrigger, edgeImmediateDanger, edgeImmediateDangerStop } from "../edge-safety";

describe("edgeImmediateDanger — reports of an active incident", () => {
  it.each([
    ["There is smoke coming out of the drive enclosure on CV-101. What should I check?", "smoke_fire"],
    ["the vfd is smoking", "smoke_fire"],
    ["I smell burning from the MCC bucket", "smoke_fire"],
    ["the motor caught fire", "smoke_fire"],
    ["melted insulation on the T1 lead, what now", "smoke_fire"],
    ["the contactor is arcing when it pulls in", "arc_explosion"],
    ["sparks coming from the drive terminals", "arc_explosion"],
    ["the capacitor just exploded", "arc_explosion"],
    ["my helper got shocked touching the panel", "shock"],
    ["the conveyor started by itself while we were clearing a jam", "uncontrolled_motion"],
    ["CV-101 moved unexpectedly during the changeover", "uncontrolled_motion"],
    ["the drive won't stop when I press stop", "uncontrolled_motion"],
    ["e-stop doesn't stop the motor", "uncontrolled_motion"],
  ])("%s → %s", (msg, kind) => {
    expect(edgeImmediateDanger(msg)?.kind).toBe(kind);
  });
});

describe("edgeImmediateDanger — questions ABOUT a hazard, and ordinary faults, are not incidents", () => {
  it.each([
    "What is arcing?",
    "Explain arc flash boundaries",
    "How does the drive prevent unexpected restart after a power loss?",
    "What does the fire mode parameter do?",
    "Is there a fire mode on the GS10?",
    "Where is the flame sensor on the burner?",
    "Which enclosure is explosion-proof?",
    "For the GS11N-20P2 drive, which parameter controls acceleration time?",
    "The drive trips on over-current during acceleration. What does the manual say?",
    "How do I lock out the conveyor before changing the belt?",
    "What is the torque spec for the gearbox coupling bolts?",
  ])("%s → null", (msg) => {
    expect(edgeImmediateDanger(msg)).toBeNull();
  });

  it("a definitional opener that still reports an incident stops", () => {
    expect(edgeImmediateDanger("What do I do, there is smoke from the drive")?.kind).toBe("smoke_fire");
    expect(edgeImmediateDanger("Explain why it's arcing right now")?.kind).toBe("arc_explosion");
  });
});

describe("edgeImmediateDangerStop", () => {
  const smoke = edgeImmediateDanger("there is smoke from the drive")!;

  it("says STOP / DO NOT OPERATE first, escalates, and gives no troubleshooting", () => {
    const text = edgeImmediateDangerStop(smoke);
    expect(text.startsWith("⛔ **STOP — DO NOT OPERATE this machine.**")).toBe(true);
    expect(text).toMatch(/emergency/);
    expect(text).toMatch(/supervisor/);
    expect(text).toMatch(/qualified person/);
    expect(text).toMatch(/does not give troubleshooting steps/);
    expect(text).not.toMatch(/\[\d+\]/);
    expect(text).not.toMatch(/\bP\d{2}\.\d{2}\b|\breset the drive by\b|\bcheck the\b/i);
  });

  it("names a closed trigger per kind", () => {
    expect(edgeDangerTrigger(smoke)).toBe("edge-immediate-danger:smoke_fire");
  });

  it.each(["smoke_fire", "arc_explosion", "shock", "uncontrolled_motion"] as const)("%s has its own first line and a call line", (kind) => {
    const text = edgeImmediateDangerStop({ kind, matched: "x" });
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(4);
  });
});
