// Contract for model-id.ts: the same rows as tools/safety_e2e/model_id.py
// (tools/safety_e2e/model_id_cases.json), plus the pin-check rules.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canonicalModelId, checkServedPin, invalidSnapshots, modelFamily, UNREPORTED } from "./model-id";

const CASES = JSON.parse(readFileSync(path.resolve(__dirname, "../../../tools/safety_e2e/model_id_cases.json"), "utf8")) as {
  canonical: [string, string][];
  family: [string, string][];
};

describe("canonicalModelId matches the shared contract", () => {
  it.each(CASES.canonical)("%s -> %s", (raw, want) => expect(canonicalModelId(raw)).toBe(want));
});
describe("modelFamily matches the shared contract", () => {
  it.each(CASES.family)("%s -> %s", (raw, want) => expect(modelFamily(raw)).toBe(want));
});

describe("checkServedPin", () => {
  it("rejects a dated snapshot that is not listed", () => expect(checkServedPin("gpt-5.4-mini", [], ["gpt-5.4-mini-2026-03-17"]).ok).toBe(false));
  it("accepts a listed dated snapshot", () =>
    expect(checkServedPin("gpt-5.4-mini", ["gpt-5.4-mini-2026-03-17"], ["gpt-5.4-mini-2026-03-17"]).ok).toBe(true));
  it("rejects a served response with no model id", () => expect(checkServedPin("gpt-5.4-mini", [], [UNREPORTED]).ok).toBe(false));
  it("accepts a case with no LLM call (nothing served to check)", () => expect(checkServedPin("gpt-5.4-mini", [], []).ok).toBe(true));
  it("accepts ollama's :latest form of the pin", () => expect(checkServedPin("mira:latest", [], ["mira"]).ok).toBe(true));
});

describe("invalidSnapshots", () => {
  it("refuses a pin-config entry that is a different model", () =>
    expect(invalidSnapshots("gpt-5.4-mini", ["gpt-5.5-2026-03-17", "gpt-5.4-mini-2026-03-17"])).toEqual(["gpt-5.5-2026-03-17"]));
  it("refuses an undated entry", () => expect(invalidSnapshots("gpt-5.4-mini", ["gpt-5.4-mini-latest"])).toEqual(["gpt-5.4-mini-latest"]));
});
