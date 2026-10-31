// Codex #4931 r3 F1: lockout and restore are ordered events within one step.
import { it, expect } from "vitest";
import { sequentialEnergizeThenMeasure } from "@/capabilities/step-energy";

it("a removal written before the energize allows the warn path", () => {
  expect(
    sequentialEnergizeThenMeasure("With the circuit locked out, remove the lockout, then energize the circuit and measure the output voltage."),
  ).toBe(true);
});

it("a lockout written after the last restore keeps the block", () => {
  expect(
    sequentialEnergizeThenMeasure("Restore power, then lock out the circuit, energize the circuit and measure the output voltage."),
  ).toBe(false);
});
