import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

describe("signup copy — leftover overclaims (2026-11-02)", () => {
  it("replaces the OEM-library bullet with the uploaded-manuals cited-page line", () => {
    expect(pageSource).toContain(
      "MIRA answers from your own uploaded manuals and shows the cited page.",
    );
    expect(pageSource).not.toContain("OEM manual library");
    expect(pageSource).not.toContain("not guesses");
  });

  it("drops the work-order / CMMS-like sub-line", () => {
    expect(pageSource).not.toContain("Track faults, work orders");
  });

  it("replaces the 7-day trial line with Talk to Mike", () => {
    expect(pageSource).toContain("Talk to Mike:");
    expect(pageSource).toContain("mailto:mike@factorylm.com");
    expect(pageSource).not.toContain("7-day free trial");
    expect(pageSource).not.toContain("no credit card");
  });

  it("cuts the never-train promise and keeps the Security link", () => {
    expect(pageSource).not.toContain("never used to train");
    expect(pageSource).not.toContain("never used to train external models");
    expect(pageSource).toContain("LEGAL.security");
    expect(pageSource).toContain("Security &amp; data handling");
  });
});
