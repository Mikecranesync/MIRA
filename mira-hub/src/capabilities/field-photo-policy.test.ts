import { describe, expect, it } from "vitest";
import { INSPECTION_PROMPT } from "../app/api/equipment-notebooks/[id]/look/route";
import { isOemDocumentationHost } from "@/lib/manual-discovery";
describe("field photo observation policy", () => {
 it("separates readouts and preserves unknown states", () => {
  expect(INSPECTION_PROMPT).toContain("mode labels, read/write markers, selected address, and displayed value separately");
  expect(INSPECTION_PROMPT).toContain("Do not infer flashing or a transition from a still photograph");
  expect(INSPECTION_PROMPT).toContain('A blank or "--" is not a measured zero');
  expect(INSPECTION_PROMPT).toContain("obscured indicator is unknown, not unlit");
 });
 it.each([
  ["Bihl+Wiedemann", "www.bihl-wiedemann.de"],
  ["Bihl + Wiedemann", "bihl-wiedemann.de"],
  ["Bihl-Wiedemann", "www.bihl-wiedemann.de"],
  ["Pepperl+Fuchs", "files.pepperl-fuchs.com"],
  ["Pepperl + Fuchs", "www.pepperl-fuchs.com"],
 ])("permits verified OEM documentation for %s, not misleading hosts", (maker, host) => {
  expect(isOemDocumentationHost(maker, host)).toBe(true);
  expect(isOemDocumentationHost(maker, `${host}.evil.example`)).toBe(false);
  expect(isOemDocumentationHost(maker, `not${host.replace(/^(?:www|files)\./, "")}`)).toBe(false);
  expect(isOemDocumentationHost(maker, "unrelated.example")).toBe(false);
 });
});
