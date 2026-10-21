import { describe, expect, it } from "bun:test";
import { head } from "../head.js";
import { serializeJsonLd } from "../html.js";

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

  it("defaults og:image and twitter:image to the served og-image.png", () => {
    const out = head({ title: "T", description: "D" });
    // The default must be a path the server actually serves (server.ts → /og-image.png),
    // not the old og-default.png which 404'd and broke social/LLM preview cards.
    expect(out).toContain('property="og:image" content="https://factorylm.com/og-image.png"');
    expect(out).toContain('name="twitter:image" content="https://factorylm.com/og-image.png"');
    expect(out).not.toContain("og-default.png");
  });

  it("uses an explicit ogImage when provided", () => {
    const out = head({ title: "T", description: "D", ogImage: "https://factorylm.com/blog/x.png" });
    expect(out).toContain('property="og:image" content="https://factorylm.com/blog/x.png"');
  });

  it("includes token and component stylesheets", () => {
    const out = head({ title: "T", description: "D" });
    expect(out).toContain('href="/_tokens.css"');
    expect(out).toContain('href="/_components.css"');
  });

  it("escapes <, >, &, U+2028, and U+2029 in JSON-LD", () => {
    const jsonLd = {
      "@type": "SoftwareApplication",
      name: "a > b & c",
      description: "x < y\u2028z\u2029",
    };
    const out = head({ title: "T", description: "D", jsonLd });
    const match = out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const raw = match![1];
    expect(raw).toBe(serializeJsonLd(jsonLd));
    expect(raw).toContain("\\u003c");
    expect(raw).toContain("\\u003e");
    expect(raw).toContain("\\u0026");
    expect(raw).toContain("\\u2028");
    expect(raw).toContain("\\u2029");
    expect(raw).not.toContain("<");
    expect(raw).not.toContain(">");
    expect(raw).not.toContain("&");
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe("a > b & c");
    expect(parsed.description).toBe("x < y\u2028z\u2029");
  });

  it("includes anti-FOUC sun-mode script", () => {
    const out = head({ title: "T", description: "D" });
    expect(out).toContain("fl_sun_mode");
    expect(out).toContain("sun-pre");
  });
});
