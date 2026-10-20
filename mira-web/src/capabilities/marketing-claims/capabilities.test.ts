import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHome } from "../../views/home.js";
import {
  generateJsonLd,
  generateLlmsFullTxt,
  generateLlmsTxt,
  loadCapabilities,
  provenClaims,
} from "./index.js";

const PUBLIC = join(import.meta.dir, "../../../public");

describe("capabilities.json schema", () => {
  const data = loadCapabilities();

  test("loads with unique ids and required fields", () => {
    expect(data.version).toBe(1);
    expect(data.claims.length).toBeGreaterThan(0);
    const ids = data.claims.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(provenClaims(data).length).toBeGreaterThan(0);
  });

  test("positioning leads with the equipment notebook", () => {
    expect(data.positioning.title).toMatch(/equipment notebook/i);
    expect(data.positioning.headline).toMatch(/equipment notebook/i);
    expect(data.positioning.meta_description).toMatch(/equipment notebook|manual passage/i);
    expect(data.positioning.meta_description).toMatch(/Talk to Mike/);
    expect(data.positioning.meta_description).not.toMatch(/\$\d/);
  });
});

describe("generated artifacts stay in lockstep with capabilities.json", () => {
  const data = loadCapabilities();

  test("public/llms.txt matches generateLlmsTxt()", () => {
    const committed = readFileSync(join(PUBLIC, "llms.txt"), "utf-8");
    expect(committed).toBe(generateLlmsTxt(data));
  });

  test("public/llms-full.txt matches generateLlmsFullTxt()", () => {
    const committed = readFileSync(join(PUBLIC, "llms-full.txt"), "utf-8");
    expect(committed).toBe(generateLlmsFullTxt(data));
  });

  test("homepage JSON-LD matches generateJsonLd()", () => {
    const html = renderHome("https://factorylm.com/");
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1])).toEqual(generateJsonLd(data));
  });

  test("homepage renders every proven claim and none of the deferred texts", () => {
    const html = renderHome("https://factorylm.com/");
    for (const claim of provenClaims(data)) {
      expect(html, `missing proven claim ${claim.id}`).toContain(claim.text);
    }
    for (const claim of data.claims.filter((c) => c.status !== "proven")) {
      expect(html, `homepage leaked deferred claim ${claim.id}`).not.toContain(claim.text);
    }
  });

  test("JSON-LD and llms files carry no prices or Offer blocks", () => {
    const jsonLd = JSON.stringify(generateJsonLd(data));
    expect(jsonLd).not.toMatch(/"@type":"Offer"/);
    expect(jsonLd).not.toMatch(/"price"/);
    expect(jsonLd).not.toMatch(/\$\d/);
    expect(generateLlmsTxt(data)).not.toMatch(/\$\d/);
    expect(generateLlmsFullTxt(data)).not.toMatch(/\$\d/);
    expect(generateLlmsTxt(data)).not.toContain("Pricing");
  });
});
