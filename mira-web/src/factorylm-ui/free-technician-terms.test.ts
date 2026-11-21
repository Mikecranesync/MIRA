import { afterEach, expect, test } from "bun:test";
import { withFreeTechnicianTerms } from "./free-technician-terms";

const originalFree = process.env.MIRA_FREE_TECHNICIANS;
const originalPilot = process.env.MIRA_PILOT_APPROVAL_REQUIRED;
const contract = await Bun.file(new URL("../../public/terms.html", import.meta.url)).text();
afterEach(() => {
  if (originalFree === undefined) delete process.env.MIRA_FREE_TECHNICIANS; else process.env.MIRA_FREE_TECHNICIANS = originalFree;
  if (originalPilot === undefined) delete process.env.MIRA_PILOT_APPROVAL_REQUIRED; else process.env.MIRA_PILOT_APPROVAL_REQUIRED = originalPilot;
});
test("keeps the current contract byte-identical when free access is not enabled", () => {
  delete process.env.MIRA_FREE_TECHNICIANS;
  expect(withFreeTechnicianTerms(contract)).toBe(contract);
});
test("adds the free-account scope to the actual contract without removing paid-service terms", () => {
  process.env.MIRA_FREE_TECHNICIANS = "true";
  process.env.MIRA_PILOT_APPROVAL_REQUIRED = "0";
  const result = withFreeTechnicianTerms(contract);
  expect(result).toContain('id="free-technician-access"');
  expect(result).toContain("no trial deadline");
  expect(result).toContain("not require a credit card");
  expect(result.replace(/\n        <p id="free-technician-access">.*?<\/p>/, "")).toBe(contract);
});
test("describes free personal accounts independently of the plant-pilot admission flag", () => {
  process.env.MIRA_FREE_TECHNICIANS = "true";
  process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
  expect(withFreeTechnicianTerms(contract)).toContain('id="free-technician-access"');
});
test("requires review if the insertion point in the source contract changes", () => {
  process.env.MIRA_FREE_TECHNICIANS = "true";
  process.env.MIRA_PILOT_APPROVAL_REQUIRED = "0";
  expect(() => withFreeTechnicianTerms("changed contract")).toThrow("needs review");
});
