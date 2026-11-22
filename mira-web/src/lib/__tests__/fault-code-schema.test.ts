import { describe, expect, test } from "bun:test";
import { renderFaultCodePage } from "../blog-renderer.js";
import { FAULT_CODES } from "../../data/fault-codes.js";

// Google Search Console (2026-11-05) flagged factorylm.com with a critical
// Product-snippet issue: a Product needs offers, review or aggregateRating.
// Fault-code pages describe equipment we do not sell, so they must not
// declare any Product at all.

function jsonLdBlocks(html: string): unknown[] {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  return [...html.matchAll(re)].map((m) => JSON.parse(m[1]));
}

function collectTypes(node: unknown, out: string[]): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectTypes(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "@type") out.push(...(Array.isArray(v) ? v : [v]).map(String));
      else collectTypes(v, out);
    }
  }
  return out;
}

describe("fault-code page structured data", () => {
  test("no fault-code page declares a Product", () => {
    expect(FAULT_CODES.length).toBeGreaterThan(0);
    for (const fc of FAULT_CODES) {
      const blocks = jsonLdBlocks(renderFaultCodePage(fc, FAULT_CODES));
      expect(blocks.length).toBeGreaterThan(0);
      expect(collectTypes(blocks, [])).not.toContain("Product");
    }
  });

  test("the guide still names the equipment it is about", () => {
    const fc = FAULT_CODES[0];
    const html = renderFaultCodePage(fc, FAULT_CODES);
    const graph = (jsonLdBlocks(html)[0] as { "@graph": Array<Record<string, any>> })["@graph"];
    const guide = graph.find((n) => String(n["@id"]).endsWith("#guide"));
    expect(guide?.about).toEqual({
      "@type": "Thing",
      name: fc.equipment,
      description: `Equipment by ${fc.manufacturer}`,
    });
  });

  test("the manufacturer stays a machine-readable Organization", () => {
    for (const fc of FAULT_CODES) {
      const html = renderFaultCodePage(fc, FAULT_CODES);
      const graph = (jsonLdBlocks(html)[0] as { "@graph": Array<Record<string, any>> })["@graph"];
      const guide = graph.find((n) => String(n["@id"]).endsWith("#guide"));
      expect(guide?.mentions).toEqual({ "@type": "Organization", name: fc.manufacturer });
    }
  });
});
