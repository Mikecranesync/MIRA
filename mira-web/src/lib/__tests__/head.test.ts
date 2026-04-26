import { describe, expect, it } from "bun:test";
import { head } from "../head.js";

describe("head()", () => {
  it("includes title and description", () => {
    const out = head({ title: "Test Page", description: "A test description" });
    expect(out).toContain("<title>Test Page</title>");
    expect(out).toContain('content="A test description"');
  });

  it("truncates description to 160 chars", () => {
    const long = "x".repeat(200);
    const out = head({ title: "T", description: long });
    const match = out.match(/name="description" content="([^"]*)"/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThanOrEqual(160);
    expect(match![1].endsWith("…")).toBe(true);
  });

  it("uses provided canonical", () => {
    const out = head({ title: "T", description: "D", canonical: "https://factorylm.com/pricing" });
    expect(out).toContain('href="https://factorylm.com/pricing"');
  });

  it("derives canonical from reqUrl when not provided", () => {
    const out = head({ title: "T", description: "D" }, "https://factorylm.com/limitations");
    expect(out).toContain('href="https://factorylm.com/limitations"');
  });

  it("injects JSON-LD when provided", () => {
    const jsonLd = { "@context": "https://schema.org", "@type": "Organization", name: "FactoryLM" };
    const out = head({ title: "T", description: "D", jsonLd });
    expect(out).toContain('type="application/ld+json"');
    expect(out).toContain('"@type":"Organization"');
  });

  it("omits JSON-LD script when not provided", () => {
    const out = head({ title: "T", description: "D" });
    expect(out).not.toContain('type="application/ld+json"');
  });

  it("includes token and component stylesheets", () => {
    const out = head({ title: "T", description: "D" });
    expect(out).toContain('href="/_tokens.css"');
    expect(out).toContain('href="/_components.css"');
  });

  it("includes anti-FOUC sun-mode script", () => {
    const out = head({ title: "T", description: "D" });
    expect(out).toContain("fl_sun_mode");
    expect(out).toContain("sun-pre");
  });
});
